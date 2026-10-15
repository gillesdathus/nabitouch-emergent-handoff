"""Financial reports from the invoice ledger, gift-card ledger and claims. JSON, CSV and branded PDF."""
import csv
import io
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response

from billing import public_invoice
from pdfbrand import report_pdf

KINDS = {
    "revenue": "Revenue report",
    "collections": "Payment collections",
    "outstanding": "Outstanding balances",
    "insurance": "Insurance receivables",
    "giftcards": "Gift-card liability",
    "earnings": "Practitioner earnings",
}


def cad(cents):
    cents = int(cents or 0)
    return f"{'-' if cents < 0 else ''}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def _day(value):
    return str(value or "")[:10]


def aging_bucket(due, today):
    if not due or due >= today:
        return "Current"
    days = (date.fromisoformat(today) - date.fromisoformat(due[:10])).days
    return "1–30 days" if days <= 30 else "31–60 days" if days <= 60 else "61–90 days" if days <= 90 else "90+ days"


def build_finance_router(db, user_from, settings_doc):
    r = APIRouter(prefix="/api/finance")

    async def actor(request, kind, practitioner_id):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] == "owner":
            return user, practitioner_id
        if user["role"] == "practitioner" and kind == "earnings":
            return user, user.get("subject")
        raise HTTPException(403, "Reports are limited to the owner")

    async def views(start, end, practitioner_id=""):
        query = {"state": {"$ne": "draft"}, "countsAsRevenue": {"$ne": False}}
        if practitioner_id:
            query["practitionerId"] = practitioner_id
        invoices = await db.nt_invoices.find(query, {"_id": 0}).to_list(10000)
        invoices = [i for i in invoices if start <= _day(i.get("serviceDate") or i.get("issueDate")) <= end]
        ids = [i["id"] for i in invoices]
        ledger = await db.nt_ledger.find({"invoiceId": {"$in": ids}}, {"_id": 0}).sort("at", 1).to_list(100000) if ids else []
        claims = await db.nt_claims.find({"invoiceId": {"$in": ids}}, {"_id": 0}).to_list(20000) if ids else []
        by_inv, by_claim = {}, {}
        for line in ledger:
            by_inv.setdefault(line["invoiceId"], []).append(line)
        for claim in claims:
            by_claim.setdefault(claim["invoiceId"], []).append({"claimed": {"cents": claim.get("claimedCents") or 0}, "approved": {"cents": claim.get("approvedCents") or 0}})
        return [(public_invoice(i, by_inv.get(i["id"], []), by_claim.get(i["id"], [])), i) for i in invoices]

    async def revenue(start, end, pid):
        rows, by_service, by_pro = [], {}, {}
        totals = {"net": 0, "discount": 0, "tax": 0, "total": 0, "voided": 0}
        for v, raw in await views(start, end, pid):
            if v["state"] == "voided":
                totals["voided"] += v["total"]["cents"]
                continue
            net = sum(int(l.get("netCents") or 0) for l in v["lines"])
            disc = -sum(int(l.get("netCents") or 0) for l in v["lines"] if int(l.get("netCents") or 0) < 0)
            totals["net"] += net
            totals["discount"] += disc
            totals["tax"] += v["tax"]["cents"]
            totals["total"] += v["total"]["cents"]
            by_service[v["service"] or "—"] = by_service.get(v["service"] or "—", 0) + v["total"]["cents"]
            by_pro[v["practitionerName"] or "—"] = by_pro.get(v["practitionerName"] or "—", 0) + v["total"]["cents"]
            rows.append([_day(v["serviceDate"]), v["number"], v["clientName"], v["practitionerName"], v["service"], cad(net), cad(v["tax"]["cents"]), cad(v["total"]["cents"])])
        rows.sort(key=lambda x: x[0])
        kpis = [("Invoiced revenue", cad(totals["total"])), ("Net of GST", cad(totals["net"])), ("GST", cad(totals["tax"])), ("Discounts", cad(totals["discount"])), ("Invoices", str(len(rows))), ("Voided (excluded)", cad(totals["voided"]))]
        groups = [("By service", ["Service", "Revenue"], sorted([[k, cad(c)] for k, c in by_service.items()], key=lambda x: x[0]), [3, 1]),
                  ("By practitioner", ["Practitioner", "Revenue"], sorted([[k, cad(c)] for k, c in by_pro.items()], key=lambda x: x[0]), [3, 1])]
        return kpis, ["Date", "Invoice", "Client", "Practitioner", "Service", "Net", "GST", "Total"], rows, groups

    async def collections(start, end, pid):
        query = {"type": {"$in": ["client_payment", "insurance_receipt", "refund", "reversal"]}}
        lines = [l for l in await db.nt_ledger.find(query, {"_id": 0}).sort("at", 1).to_list(100000) if start <= _day(l.get("at")) <= end]
        inv_ids = list({l["invoiceId"] for l in lines})
        invs = {i["id"]: i for i in await db.nt_invoices.find({"id": {"$in": inv_ids}}, {"_id": 0}).to_list(20000)} if inv_ids else {}
        if pid:
            lines = [l for l in lines if (invs.get(l["invoiceId"]) or {}).get("practitionerId") == pid]
        rows, by_method, net = [], {}, 0
        for l in lines:
            sign = -1 if l["type"] in ("refund", "reversal") else 1
            amount = sign * int(l["amountCents"])
            net += amount
            method = "insurance" if l["type"] == "insurance_receipt" else (l.get("method") or "other")
            by_method[method] = by_method.get(method, 0) + amount
            inv = invs.get(l["invoiceId"]) or {}
            rows.append([_day(l["at"]), inv.get("number") or "", inv.get("clientName") or "", l["type"].replace("_", " "), method, (l.get("reference") or "")[:24], cad(amount)])
        refunds = sum(int(l["amountCents"]) for l in lines if l["type"] in ("refund", "reversal"))
        kpis = [("Net collected", cad(net)), ("Client payments", cad(sum(int(l["amountCents"]) for l in lines if l["type"] == "client_payment"))),
                ("Insurance received", cad(sum(int(l["amountCents"]) for l in lines if l["type"] == "insurance_receipt"))), ("Refunds & reversals", cad(refunds)), ("Transactions", str(len(rows)))]
        groups = [("By method", ["Method", "Net"], sorted([[k, cad(c)] for k, c in by_method.items()]), [3, 1])]
        return kpis, ["Date", "Invoice", "Client", "Type", "Method", "Reference", "Amount"], rows, groups

    async def outstanding(start, end, pid):
        today = datetime.now(timezone.utc).date().isoformat()
        rows, buckets, total, expected = [], {}, 0, 0
        for v, _raw in await views(start, end, pid):
            if v["balance"]["cents"] <= 0 or v["state"] == "voided":
                continue
            bucket = aging_bucket(_day(v["dueDate"]), today)
            buckets[bucket] = buckets.get(bucket, 0) + v["balance"]["cents"]
            total += v["balance"]["cents"]
            expected += v["expectedInsurance"]["cents"]
            rows.append([_day(v["serviceDate"]), v["number"], v["clientName"], _day(v["dueDate"]), bucket, cad(v["total"]["cents"]), cad(v["expectedInsurance"]["cents"]), cad(v["balance"]["cents"])])
        rows.sort(key=lambda x: x[3] or "")
        order = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"]
        kpis = [("Outstanding", cad(total)), ("Insurance expected (not received)", cad(expected)), ("Client share est.", cad(total - expected)), ("Open invoices", str(len(rows)))]
        groups = [("Aging", ["Bucket", "Balance"], [[b, cad(buckets.get(b, 0))] for b in order], [3, 1])]
        return kpis, ["Service date", "Invoice", "Client", "Due", "Aging", "Total", "Ins. expected", "Balance"], rows, groups

    async def insurance(start, end, pid):
        rows, t = [], {"claimed": 0, "approved": 0, "received": 0, "expected": 0}
        for v, _raw in await views(start, end, pid):
            if not (v["claimed"]["cents"] or v["insuranceReceived"]["cents"] or v["expectedInsurance"]["cents"]):
                continue
            for k, src in (("claimed", "claimed"), ("approved", "approved"), ("received", "insuranceReceived"), ("expected", "expectedInsurance")):
                t[k] += v[src]["cents"]
            rows.append([_day(v["serviceDate"]), v["number"], v["clientName"], cad(v["claimed"]["cents"]), cad(v["approved"]["cents"]), cad(v["insuranceReceived"]["cents"]), cad(v["expectedInsurance"]["cents"])])
        kpis = [("Insurance receivable", cad(t["expected"])), ("Claimed", cad(t["claimed"])), ("Approved (not a payment)", cad(t["approved"])), ("Received", cad(t["received"])), ("Invoices", str(len(rows)))]
        return kpis, ["Date", "Invoice", "Client", "Claimed", "Approved", "Received", "Pending"], rows, []

    async def giftcards(start, end, _pid):
        cards = await db.nt_giftcards.find({}, {"_id": 0}).to_list(20000)
        txs = [t for t in await db.nt_gc_ledger.find({"status": "completed"}, {"_id": 0}).sort("at", 1).to_list(100000) if start <= _day(t.get("at")) <= end]
        live = [c for c in cards if c["status"] in ("active", "redeemed")]
        by_card = {c["id"]: c for c in cards}
        rows = [[_day(t["at"]), f"••{by_card.get(t['cardId'], {}).get('code', '')[-4:]}", t["type"], (t.get("reference") or "")[:24], cad(int(t["amountCents"]) * (-1 if t["type"] == "redemption" else 1))] for t in txs]
        kpis = [("Outstanding liability (now)", cad(sum(c["balanceCents"] for c in live if c["status"] == "active"))),
                ("Issued in period", cad(sum(int(t["amountCents"]) for t in txs if t["type"] == "issue"))), ("Redeemed in period", cad(sum(int(t["amountCents"]) for t in txs if t["type"] == "redemption"))),
                ("Voided / refunded in period", cad(sum(int(t["amountCents"]) for t in txs if t["type"] in ("void", "refund")))), ("Active cards", str(sum(1 for c in cards if c["status"] == "active"))),
                ("Awaiting payment", str(sum(1 for c in cards if c["status"] == "pending_payment")))]
        return kpis, ["Date", "Card", "Type", "Reference", "Amount"], rows, []

    async def earnings(start, end, pid):
        per, rows = {}, []
        for v, _raw in await views(start, end, pid):
            if v["state"] == "voided":
                continue
            key = v["practitionerName"] or "Unassigned"
            net = sum(int(l.get("netCents") or 0) for l in v["lines"])
            collected = v["received"]["cents"] - v["refunded"]["cents"]
            p = per.setdefault(key, {"visits": 0, "net": 0, "total": 0, "collected": 0, "outstanding": 0, "insPending": 0})
            p["visits"] += 1
            p["net"] += net
            p["total"] += v["total"]["cents"]
            p["collected"] += collected
            p["outstanding"] += v["balance"]["cents"]
            p["insPending"] += v["expectedInsurance"]["cents"]
            rows.append([_day(v["serviceDate"]), v["number"], v["service"], key, cad(net), cad(v["total"]["cents"]), cad(collected), cad(v["balance"]["cents"])])
        rows.sort(key=lambda x: x[0])
        t = {k: sum(p[k] for p in per.values()) for k in ("visits", "net", "total", "collected", "outstanding", "insPending")}
        kpis = [("Treatment revenue (net of GST)", cad(t["net"])), ("Visits", str(t["visits"])), ("Invoiced incl. GST", cad(t["total"])), ("Collected", cad(t["collected"])), ("Outstanding", cad(t["outstanding"])), ("Insurance pending", cad(t["insPending"]))]
        groups = [("By practitioner", ["Practitioner", "Visits", "Net revenue", "Collected", "Outstanding"], [[k, p["visits"], cad(p["net"]), cad(p["collected"]), cad(p["outstanding"])] for k, p in sorted(per.items())], [3, 1, 2, 2, 2])]
        return kpis, ["Date", "Invoice", "Service", "Practitioner", "Net", "Total", "Collected", "Balance"], rows, groups

    BUILDERS = {"revenue": revenue, "collections": collections, "outstanding": outstanding, "insurance": insurance, "giftcards": giftcards, "earnings": earnings}

    def period(start, end):
        today = datetime.now(timezone.utc).date()
        start = start or today.replace(day=1).isoformat()
        end = end or today.isoformat()
        try:
            date.fromisoformat(start)
            date.fromisoformat(end)
        except ValueError as exc:
            raise HTTPException(400, "Use YYYY-MM-DD dates") from exc
        if end < start:
            raise HTTPException(400, "The end date must be on or after the start date")
        return start, end

    @r.get("/reports")
    async def catalog(request: Request):
        user = await user_from(request)
        if not user or user["role"] not in ("owner", "practitioner"):
            raise HTTPException(403, "Reports are limited to the owner")
        return [{"kind": k, "title": v} for k, v in KINDS.items() if user["role"] == "owner" or k == "earnings"]

    @r.get("/reports/{kind}")
    async def report(kind: str, request: Request, start: str = "", end: str = "", practitionerId: str = "", format: str = "json", page: int = 1, limit: int = 50):
        if kind not in BUILDERS:
            raise HTTPException(404, "Unknown report")
        _user, pid = await actor(request, kind, practitionerId)
        start, end = period(start, end)
        kpis, headers, rows, groups = await BUILDERS[kind](start, end, pid)
        title = KINDS[kind]
        stamp = f"{start} to {end}"
        fname = f"nabitouch-{kind}-{start}-{end}"
        if format == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow([title, stamp])
            for k, v in kpis:
                w.writerow([k, v])
            w.writerow([])
            w.writerow(headers)
            w.writerows(rows)
            return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'})
        if format == "pdf":
            widths = [2] * len(headers)
            sections = [*groups, ("Detail", headers, rows, widths)]
            pdf = report_pdf(title, stamp, kpis, sections, await settings_doc())
            return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'})
        limit = max(1, min(int(limit), 200))
        page = max(1, int(page))
        return {"kind": kind, "title": title, "start": start, "end": end, "kpis": [{"label": k, "value": v} for k, v in kpis],
                "groups": [{"title": g[0], "headers": g[1], "rows": g[2]} for g in groups], "headers": headers,
                "rows": rows[(page - 1) * limit: page * limit], "total": len(rows), "page": page, "limit": limit,
                "basis": "Figures come from issued invoices and confirmed ledger entries. Insurance counts only when received."}

    return r
