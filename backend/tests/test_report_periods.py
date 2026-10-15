from calendar import monthrange

from reports import period_bounds, snapshot_lines, text_pdf


def test_february_and_leap_years_use_the_real_month_end():
    assert period_bounds(2026, 2, 1) == ("2026-02-01", "2026-02-15")
    assert period_bounds(2026, 2, 2) == ("2026-02-16", "2026-02-28")
    assert period_bounds(2024, 2, 2) == ("2024-02-16", "2024-02-29")
    assert period_bounds(2026, 4, 2)[1].endswith(f"-{monthrange(2026, 4)[1]:02d}")


def test_collections_stay_separate_from_invoiced_and_pending_insurance():
    rows = snapshot_lines([
        {"id": "a", "date": "2026-02-10", "status": "completed", "serviceSlug": "swedish", "practitionerId": "p1",
         "pricing": {"base": 120, "discount": 20, "travel": 15, "tax": 5.75, "total": 120.75},
         "settle": {"clientPaid": 30, "refunded": 0, "insuranceConfirmed": 0, "insurancePending": 40, "balance": 90.75},
         "payNow": "deposit"},
        {"id": "b", "date": "2026-02-20", "status": "cancelled", "pricing": {"total": 50}, "settle": {"clientPaid": 50, "balance": 0}},
    ], "2026-02-01", "2026-02-15")
    assert rows["count"] == 1
    assert rows["invoiced"] == 120.75
    assert rows["collected"] == 30
    assert rows["insurancePending"] == 40
    assert rows["insuranceReceived"] == 0


def test_pdf_is_a_real_document_from_the_snapshot_text():
    payload = text_pdf("Nabitouch report", ["2026-02-01 to 2026-02-15", "Collected 30.0"])
    assert payload.startswith(b"%PDF-1.4")
    assert b"Collected 30.0" in payload
