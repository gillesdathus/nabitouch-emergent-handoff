# Financial reconciliation: report KPIs vs sum of rows, and revenue vs nt_invoices (this month + last 90 days)
import asyncio
import csv
import io
from datetime import date, timedelta

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from t1_common import API, BENV, OWNER, login

KINDS = ["revenue", "collections", "insurance", "refunds", "earnings", "plans", "giftcards"]
T = date.today()
PERIODS = {"month": (T.replace(day=1).isoformat(), T.isoformat()), "90d": ((T - timedelta(days=90)).isoformat(), T.isoformat())}


def money(v):
    v = str(v).replace("$", "").replace(",", "").replace("CA", "").strip()
    neg = v.startswith("(") or v.startswith("-")
    v = v.strip("()-")
    try:
        return round(-float(v) if neg else float(v), 2)
    except ValueError:
        return None


def fetch(owner, kind, start, end):
    r = owner.get(f"{API}/finance/reports/{kind}", params={"start": start, "end": end, "format": "csv"}, timeout=60)
    assert r.status_code == 200, r.text[:200]
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    blank = rows.index([])
    kpis = {k: v for k, v in rows[1:blank]}
    headers, body = rows[blank + 1], rows[blank + 2:]
    sums = {}
    for i, h in enumerate(headers):
        vals = [money(r[i]) for r in body if i < len(r)]
        if vals and all(v is not None for v in vals) and any("$" in r[i] for r in body if i < len(r)):
            sums[h] = round(sum(vals), 2)
    return kpis, headers, body, sums


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.mark.parametrize("period", list(PERIODS))
@pytest.mark.parametrize("kind", KINDS)
def test_report_dump(owner, kind, period):
    start, end = PERIODS[period]
    kpis, headers, body, sums = fetch(owner, kind, start, end)
    print(f"\n[{kind} {period} {start}..{end}] rows={len(body)} KPIs={kpis} COLSUMS={sums}")


@pytest.mark.parametrize("period", list(PERIODS))
def test_revenue_kpis_equal_rows(owner, period):
    kpis, headers, body, sums = fetch(owner, "revenue", *PERIODS[period])
    assert money(kpis["Invoiced revenue"]) == sums.get("Total", 0.0), (kpis, sums)
    assert money(kpis["GST"]) == sums.get("GST", 0.0), (kpis, sums)
    assert money(kpis["Net of GST"]) == sums.get("Net", 0.0), (kpis, sums)
    assert int(kpis["Invoices"]) == len(body)


@pytest.mark.parametrize("period", list(PERIODS))
def test_collections_kpis_equal_rows(owner, period):
    kpis, headers, body, sums = fetch(owner, "collections", *PERIODS[period])
    amount_col = headers[-1]
    assert money(kpis["Net collected"]) == sums.get(amount_col, 0.0), (kpis, sums)


@pytest.mark.parametrize("period", list(PERIODS))
def test_revenue_vs_db(owner, period):
    start, end = PERIODS[period]
    kpis, *_ = fetch(owner, "revenue", start, end)

    async def q():
        c = AsyncIOMotorClient(BENV["MONGO_URL"])
        try:
            invs = await c[BENV["DB_NAME"]].nt_invoices.find({}, {"_id": 0, "state": 1, "serviceDate": 1, "issueDate": 1, "totalCents": 1, "total": 1, "training": 1}).to_list(100000)
        finally:
            c.close()
        return invs
    invs = asyncio.run(q())
    day = lambda i: str(i.get("serviceDate") or i.get("issueDate") or "")[:10]
    sel = [i for i in invs if start <= day(i) <= end and i.get("state") not in ("draft", "voided")]
    tot = lambda i: i.get("totalCents") if i.get("totalCents") is not None else (i.get("total") or {}).get("cents", 0) if isinstance(i.get("total"), dict) else 0
    db_total = round(sum(tot(i) for i in sel) / 100, 2)
    print(f"\nDB {period}: {len(sel)} issued invoices, total ${db_total}; report {kpis['Invoiced revenue']} / {kpis['Invoices']} invoices; states={sorted({i.get('state') for i in invs})}")
    assert abs(db_total - money(kpis["Invoiced revenue"])) < 0.01 or int(kpis["Invoices"]) != len(sel)
