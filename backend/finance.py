"""Financial reports from the invoice ledger, gift-card ledger and claims. JSON, CSV and branded PDF."""
import csv
import io
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response

from billing import public_invoice
from pdfbrand import report_pdf
from config import statement_email_enabled

KINDS = {
    "revenue": "Revenue report",
    "collections": "Payment collections",
    "outstanding": "Outstanding balances",
    "insurance": "Insurance receivables",
    "giftcards": "Gift-card liability",
    "earnings": "Practitioner earnings",
    "retention": "Client retention",
    "services": "Service performance",
    "refunds": "Refunds & discounts",
}

DEFAULT_RULES = {"default": {"type": "commission", "practitionerPct": 70}, "includeTravel": False, "overrides": {}}
PAY_LINES = ("Treatment", "Enhancements")


def pay_base(view, include_travel):
    """Commission base: treatment, enhancements and discounts, before GST. Travel only when configured."""
    base = 0
    for line in view["lines"]:
        cents = int(line.get("netCents") or 0)
        desc = line.get("description") or ""
        if desc in PAY_LINES or cents < 0 and line.get("taxCode") != "adjustment" or (include_travel and desc == "Travel"):
            base += cents
    return max(0, base)


def rule_for(rules, pid):
    return (rules.get("overrides") or {}).get(pid) or rules.get("default") or DEFAULT_RULES["default"]


def visit_pay(view, rule, include_travel):
    if rule.get("type") == "hourly":
        return round(int(rule.get("hourlyCents") or 0) * int(view.get("duration") or 0) / 60)
    return round(pay_base(view, include_travel) * float(rule.get("practitionerPct") or 0) / 100)


def rule_label(rule):
    return f"Hourly {cad(rule.get('hourlyCents'))}/h" if rule.get("type") == "hourly" else f"{rule.get('practitionerPct')}/{100 - float(rule.get('practitionerPct') or 0):g} split"


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

    async def rules():
        doc = await db.nt_pay_rules.find_one({"id": "rules"}, {"_id": 0}) or {}
        return {**DEFAULT_RULES, **{k: v for k, v in doc.items() if k != "id"}}

    async def earnings(start, end, pid):
        per, rows = {}, []
        pay_rules = await rules()
        for v, _raw in await views(start, end, pid):
            if v["state"] == "voided":
                continue
            key = v["practitionerName"] or "Unassigned"
            net = sum(int(l.get("netCents") or 0) for l in v["lines"])
            collected = v["received"]["cents"] - v["refunded"]["cents"]
            rule = rule_for(pay_rules, v.get("practitionerId") or "")
            pay = visit_pay(v, rule, pay_rules.get("includeTravel"))
            p = per.setdefault(key, {"visits": 0, "net": 0, "total": 0, "collected": 0, "outstanding": 0, "insPending": 0, "pay": 0, "rule": rule_label(rule)})
            p["pay"] += pay
            p["visits"] += 1
            p["net"] += net
            p["total"] += v["total"]["cents"]
            p["collected"] += collected
            p["outstanding"] += v["balance"]["cents"]
            p["insPending"] += v["expectedInsurance"]["cents"]
            rows.append([_day(v["serviceDate"]), v["number"], v["service"], key, cad(net), cad(collected), cad(v["balance"]["cents"]), cad(pay)])
        rows.sort(key=lambda x: x[0])
        t = {k: sum(p[k] for p in per.values()) for k in ("visits", "net", "total", "collected", "outstanding", "insPending", "pay")}
        kpis = [("Practitioner pay (per rules)", cad(t["pay"])), ("Treatment revenue (net of GST)", cad(t["net"])), ("Visits", str(t["visits"])), ("Invoiced incl. GST", cad(t["total"])), ("Collected", cad(t["collected"])), ("Outstanding", cad(t["outstanding"])), ("Insurance pending", cad(t["insPending"]))]
        groups = [("By practitioner", ["Practitioner", "Rule", "Pay", "Visits", "Net revenue"], [[k, p["rule"], cad(p["pay"]), p["visits"], cad(p["net"])] for k, p in sorted(per.items())], [3, 2, 2, 1, 2])]
        return kpis, ["Date", "Invoice", "Service", "Practitioner", "Net", "Collected", "Balance", "Pay"], rows, groups

    async def retention(start, end, pid):
        span = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        prev_end = (date.fromisoformat(start).toordinal() - 1)
        prev_start = date.fromordinal(prev_end - span + 1).isoformat()
        prev_end = date.fromordinal(prev_end).isoformat()
        everything = [v for v, _ in await views("0000-01-01", "9999-12-31", pid) if v["state"] != "voided"]
        first = {}
        for v in everything:
            cid = v.get("clientId") or v.get("clientName")
            first[cid] = min(first.get(cid, "9999"), _day(v["serviceDate"]))
        def active(a, b):
            out = {}
            for v in everything:
                if a <= _day(v["serviceDate"]) <= b:
                    out.setdefault(v.get("clientId") or v.get("clientName"), []).append(v)
            return out
        now_set, prev_set = active(start, end), active(prev_start, prev_end)
        lifetime = {}
        for v in everything:
            lifetime[v.get("clientId") or v.get("clientName")] = lifetime.get(v.get("clientId") or v.get("clientName"), 0) + 1
        rows = []
        for cid, vs in now_set.items():
            status = "New" if start <= first[cid] <= end else "Returning"
            rows.append([vs[0]["clientName"], status, len(vs), lifetime[cid], first[cid], max(_day(x["serviceDate"]) for x in vs), cad(sum(x["total"]["cents"] for x in vs))])
        rows.sort(key=lambda r: r[0] or "")
        kept = len(set(prev_set) & set(now_set))
        rate = f"{round(100 * kept / len(prev_set))}%" if prev_set else "—"
        new = sum(1 for r in rows if r[1] == "New")
        kpis = [("Retention vs previous period", rate), ("Active clients", str(len(rows))), ("New clients", str(new)), ("Returning clients", str(len(rows) - new)),
                ("Visits per client", f"{(sum(r[2] for r in rows) / len(rows)):.1f}" if rows else "—"), ("Previous period clients", str(len(prev_set)))]
        groups = [("Mix", ["Segment", "Clients"], [["New", new], ["Returning", len(rows) - new]], [3, 1])]
        return kpis, ["Client", "Status", "Visits", "Lifetime", "First visit", "Last visit", "Revenue"], rows, groups

    async def services(start, end, pid):
        per = {}
        for v, _raw in await views(start, end, pid):
            if v["state"] == "voided":
                continue
            p = per.setdefault(v["service"] or "—", {"visits": 0, "net": 0, "minutes": 0, "discount": 0})
            p["visits"] += 1
            p["net"] += sum(int(l.get("netCents") or 0) for l in v["lines"])
            p["minutes"] += int(v.get("duration") or 0)
            p["discount"] += -sum(int(l.get("netCents") or 0) for l in v["lines"] if int(l.get("netCents") or 0) < 0)
        total = sum(p["net"] for p in per.values()) or 1
        rows = sorted([[k, p["visits"], f"{round(100 * p['net'] / total)}%", f"{round(p['minutes'] / p['visits'])} min", cad(p["discount"]), cad(round(p["net"] / p["visits"])), cad(p["net"])] for k, p in per.items()], key=lambda r: -int(r[1]))
        visits = sum(p["visits"] for p in per.values())
        kpis = [("Service revenue (net)", cad(sum(p["net"] for p in per.values()))), ("Visits", str(visits)), ("Services booked", str(len(per))),
                ("Average ticket", cad(round(sum(p["net"] for p in per.values()) / visits)) if visits else "—"), ("Top service", rows[0][0] if rows else "—")]
        groups = [("Revenue by service", ["Service", "Revenue"], [[r[0], r[6]] for r in rows], [3, 1])]
        return kpis, ["Service", "Visits", "Share", "Avg length", "Discounts", "Avg ticket", "Net revenue"], rows, groups

    async def refunds(start, end, pid):
        rows, ref_total, disc_total = [], 0, 0
        lines = [l for l in await db.nt_ledger.find({"type": {"$in": ["refund", "reversal"]}}, {"_id": 0}).to_list(50000) if start <= _day(l.get("at")) <= end]
        invs = {i["id"]: i for i in await db.nt_invoices.find({"id": {"$in": list({l["invoiceId"] for l in lines})}}, {"_id": 0}).to_list(20000)} if lines else {}
        for l in lines:
            inv = invs.get(l["invoiceId"]) or {}
            if pid and inv.get("practitionerId") != pid:
                continue
            ref_total += int(l["amountCents"])
            rows.append([_day(l["at"]), inv.get("number") or "", inv.get("clientName") or "", l["type"], (l.get("reference") or l.get("method") or "")[:28], cad(-int(l["amountCents"]))])
        by_label = {}
        for v, _raw in await views(start, end, pid):
            if v["state"] == "voided":
                continue
            for line in v["lines"]:
                cents = int(line.get("netCents") or 0)
                if cents < 0 and line.get("taxCode") != "adjustment":
                    disc_total += -cents
                    by_label[line.get("description") or "Discount"] = by_label.get(line.get("description") or "Discount", 0) - cents
                    rows.append([_day(v["serviceDate"]), v["number"], v["clientName"], "discount", line.get("description") or "", cad(cents)])
        rows.sort(key=lambda r: r[0])
        kpis = [("Refunds & discounts", cad(ref_total + disc_total)), ("Refunds & reversals", cad(ref_total)), ("Discounts given", cad(disc_total)), ("Entries", str(len(rows)))]
        groups = [("Discounts by promotion", ["Promotion", "Amount"], sorted([[k, cad(c)] for k, c in by_label.items()]), [3, 1])]
        return kpis, ["Date", "Invoice", "Client", "Type", "Detail", "Amount"], rows, groups

    BUILDERS = {"revenue": revenue, "collections": collections, "outstanding": outstanding, "insurance": insurance, "giftcards": giftcards, "earnings": earnings,
                "retention": retention, "services": services, "refunds": refunds}

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

    async def owner(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can do that")
        return user

    def clean_rule(rule):
        if not isinstance(rule, dict):
            raise HTTPException(400, "Invalid pay rule")
        if rule.get("type") == "hourly":
            cents = rule.get("hourlyCents")
            if not isinstance(cents, int) or not 0 < cents <= 100000:
                raise HTTPException(400, "Hourly rate must be between $0.01 and $1,000")
            return {"type": "hourly", "hourlyCents": cents}
        pct = rule.get("practitionerPct")
        if not isinstance(pct, (int, float)) or not 0 <= pct <= 100:
            raise HTTPException(400, "The practitioner share must be 0 to 100%")
        return {"type": "commission", "practitionerPct": round(float(pct), 2)}

    @r.get("/pay-rules")
    async def get_rules(request: Request):
        await owner(request)
        return await rules()

    @r.put("/pay-rules")
    async def put_rules(request: Request):
        user = await owner(request)
        body = await request.json()
        saved = {"default": clean_rule(body.get("default") or {}), "includeTravel": bool(body.get("includeTravel")),
                 "overrides": {str(k)[:40]: clean_rule(v) for k, v in (body.get("overrides") or {}).items() if v}}
        await db.nt_pay_rules.update_one({"id": "rules"}, {"$set": {**saved, "updatedBy": user.get("name"), "updatedAt": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return {**saved}

    def statement_view(row, full=True):
        out = {k: row.get(k) for k in ("id", "practitionerId", "practitionerName", "start", "end", "status", "createdAt", "approvedAt", "approvedBy", "rule")}
        out["kpis"] = row["kpis"]
        if full:
            out["headers"], out["rows"] = row["headers"], row["rows"]
        return out

    @r.post("/statements")
    async def create_statements(request: Request):
        user = await owner(request)
        body = await request.json()
        start, end = period(body.get("start"), body.get("end"))
        target = str(body.get("practitionerId") or "all")
        pay_rules = await rules()
        grouped = {}
        for v, _raw in await views(start, end, "" if target == "all" else target):
            if v["state"] != "voided" and v.get("practitionerId"):
                grouped.setdefault(v["practitionerId"], []).append(v)
        created = []
        for pid, vs in grouped.items():
            rule = rule_for(pay_rules, pid)
            rows, pay, net = [], 0, 0
            for v in sorted(vs, key=lambda x: _day(x["serviceDate"])):
                amount = visit_pay(v, rule, pay_rules.get("includeTravel"))
                base = pay_base(v, pay_rules.get("includeTravel"))
                pay += amount
                net += base
                rows.append([_day(v["serviceDate"]), v["number"], v["service"], f"{v.get('duration') or ''} min", cad(base), cad(amount)])
            tips = [t for t in await db.nt_tips.find({"practitionerId": pid}, {"_id": 0}).to_list(5000) if start <= _day(t.get("at")) <= end]
            tip_total = sum(int(t["amountCents"]) for t in tips)
            for t in tips:
                rows.append([_day(t["at"]), "Tip", f"{t.get('method') or ''} · 100% to you", "", "", cad(t["amountCents"])])
            commission = pay
            pay += tip_total
            doc = {"id": "pst-" + uuid.uuid4().hex[:10], "practitionerId": pid, "practitionerName": vs[0].get("practitionerName"), "start": start, "end": end,
                   "status": "draft", "rule": rule_label(rule), "createdAt": datetime.now(timezone.utc).isoformat(), "createdBy": user.get("name"),
                   "kpis": [["Practitioner pay", cad(pay)], ["Visits", str(len(vs))], ["Visit pay", cad(commission)], ["Tips (100%)", cad(tip_total)], ["Commission base", cad(net)], ["Pay rule", rule_label(rule)]],
                   "headers": ["Date", "Invoice", "Service", "Length", "Base", "Pay"], "rows": rows, "payCents": pay}
            await db.nt_pay_statements.insert_one(dict(doc))
            created.append(statement_view(doc, False))
        if not created:
            raise HTTPException(404, "No invoiced visits for that period")
        return created

    @r.get("/statements")
    async def list_statements(request: Request):
        user = await user_from(request)
        if not user or user["role"] not in ("owner", "practitioner"):
            raise HTTPException(403, "Not permitted")
        query = {} if user["role"] == "owner" else {"practitionerId": user.get("subject"), "status": "approved"}
        rows = await db.nt_pay_statements.find(query, {"_id": 0}).sort([("end", -1), ("createdAt", -1)]).to_list(300)
        return [statement_view(x, False) for x in rows]

    async def statement_for(request, sid):
        user = await user_from(request)
        row = await db.nt_pay_statements.find_one({"id": sid}, {"_id": 0})
        if not user or not row:
            raise HTTPException(404, "Statement not found")
        if user["role"] == "owner" or (user["role"] == "practitioner" and row["practitionerId"] == user.get("subject") and row["status"] == "approved"):
            return user, row
        raise HTTPException(404, "Statement not found")

    @r.post("/statements/{sid}/approve")
    async def approve_statement(sid: str, request: Request):
        user = await owner(request)
        saved = await db.nt_pay_statements.find_one_and_update({"id": sid, "status": "draft"}, {"$set": {"status": "approved", "approvedBy": user.get("name"), "approvedAt": datetime.now(timezone.utc).isoformat()}}, projection={"_id": 0}, return_document=True)
        if not saved:
            raise HTTPException(409, "Only a draft statement can be approved")
        if statement_email_enabled():
            now = datetime.now(timezone.utc).isoformat()
            try:
                await db.nt_notifications.insert_one({"id": "ntf-" + uuid.uuid4().hex[:16], "dedupeKey": f"statement:{sid}", "kind": "statement", "statementId": sid,
                                                      "status": "pending", "attempts": 0, "maxAttempts": 5, "nextAttemptAt": now, "leaseUntil": None, "leaseOwner": None,
                                                      "providerId": None, "deliveredAt": None, "lastError": None, "createdAt": now, "updatedAt": now})
            except Exception:
                pass
        return statement_view(saved, False)

    @r.delete("/statements/{sid}")
    async def delete_statement(sid: str, request: Request):
        await owner(request)
        res = await db.nt_pay_statements.delete_one({"id": sid, "status": "draft"})
        if not res.deleted_count:
            raise HTTPException(409, "Only a draft statement can be deleted")
        return {"deleted": True}

    @r.get("/statements/{sid}/pdf")
    async def statement_pdf(sid: str, request: Request):
        _user, row = await statement_for(request, sid)
        title = "Practitioner statement" if row["status"] == "approved" else "Statement (DRAFT)"
        pdf = report_pdf(title, f"{row['practitionerName']} · {row['start']} to {row['end']}", [tuple(k) for k in row["kpis"]], [("Visits", row["headers"], row["rows"], [2, 2, 4, 2, 2, 2])], await settings_doc())
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="statement-{row["start"]}-{row["end"]}.pdf"'})

    return r
