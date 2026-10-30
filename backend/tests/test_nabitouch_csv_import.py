"""Checkpoint D — NabiTouch CSV adapters. Synthetic fixtures only; no real PII."""
import json

from nabitouch_csv_import import (
    build_migration_preview,
    parse_patient_export,
    parse_patients_without_appointments,
    parse_sales_report,
    public_preview,
    reconcile_finances,
    reconcile_patients,
)


PATIENT_EXPORT = """first_name,last_name,date_of_birth,gender,home_phone,work_phone,cell_phone,address1,city,prov_state,postal_zip_code,email,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,source_of_referral,primary_care_physician,primary_care_physician_address,primary_care_physician_phone,last_appointment_date
Ada,CaseA,1990-01-02,,,,+17805550101,101 St,Edmonton,AB,T5J0A1,ada.a@example.com,,,,,,,
Ben,CaseB,1991-02-03,,,,+17805550102,,,,,ben.b@example.com,,,,,,,
Cara,NoContact,,,,,,,,,,,,,,,,,,
"""

SECONDARY = """Patient,"Patient Email","Home Phone","Mobile Phone","Last Appointment Date"
"Ada CaseA",ada.a@example.com,,+17805550101,"Jun 1, 2026"
"Dana Only",,,,
"Eve SalesMissing",eve@example.com,,+17805550999,"Jul 1, 2026"
"""

SALES = """INV-#,Service,Duration,"Service Category","Tx Date",Patient,Practitioner,Payments,Price,Adj.,Quantity,"Tax Name","Tax Number","Tax Rate","Tax Amount",Total,Balance
INV-1,"Deep Tissue Massage",60,Massage,"Oct 1, 2026","Ada CaseA","Nabitu Kahindo",Cash,$110.00,$0.00,1.00,,,,$0.00,$110.00,$0.00
INV-2,"Swedish Massage",90,Massage,"Oct 2, 2026","Frank SalesOnly","Nabitu Kahindo",-,$150.00,$0.00,1.00,,,,$0.00,$150.00,$150.00
INV-2,"Hot Stone",30,Massage,"Oct 2, 2026","Frank SalesOnly","Nabitu Kahindo",-,$70.00,$0.00,1.00,,,,$0.00,$70.00,$150.00
INV-3,"Deep Tissue Massage",60,Massage,"Oct 3, 2026","Ada CaseA","Nabitu Kahindo",Insurance,$110.00,$0.00,1.00,,,,$5.50,$115.50,$0.00
"""


def test_parse_patient_export_counts_and_contacts():
    parsed = parse_patient_export(PATIENT_EXPORT)
    assert parsed["rowCount"] == 3
    assert sum(1 for row in parsed["patients"] if row["hasEmail"]) == 2
    assert sum(1 for row in parsed["patients"] if row["hasPhone"]) == 2
    assert sum(1 for row in parsed["patients"] if not row["hasEmail"] and not row["hasPhone"]) == 1


def test_secondary_and_sales_parsers():
    secondary = parse_patients_without_appointments(SECONDARY)
    sales = parse_sales_report(SALES)
    assert secondary["rowCount"] == 3
    assert sales["rowCount"] == 4
    assert {line["invoiceNumber"] for line in sales["lines"]} == {"INV-1", "INV-2", "INV-3"}


def test_patient_dedup_by_email_not_by_name_alone():
    pe = parse_patient_export(PATIENT_EXPORT)["patients"]
    pw = parse_patients_without_appointments(SECONDARY)["patients"]
    sales = parse_sales_report(SALES)["lines"]
    result = reconcile_patients(pe, pw, sales, existing_clients=[{"id": "c-ada", "email": "ada.a@example.com", "phone": ""}])
    statuses = {item["status"] for item in result["patients"]}
    assert "existing_matched" in statuses
    assert "missing_contact" in statuses
    # Frank from sales-only should require review
    assert result["salesPatientsMissingFromExports"] >= 1
    frank = next(item for item in result["patients"] if item.get("fromSalesOnly"))
    assert frank["status"] in ("requires_manual_review", "missing_contact")
    # Ada appears in both exports with same email → one identity, not two
    ada_rows = [item for item in result["patients"] if item["existingClientId"] == "c-ada" or "patient_export" in item["sourceFiles"]]
    assert len([item for item in result["patients"] if item["status"] == "existing_matched"]) == 1


def test_financial_reconciliation_and_no_fabricated_appointments():
    sales = parse_sales_report(SALES)["lines"]
    finances = reconcile_finances(sales)
    assert finances["invoiceCount"] == 3
    assert finances["lineCount"] == 4
    assert finances["billedServiceUnits"] == 4.0
    assert finances["durationMinutes"] == 240
    assert finances["billedTotalCents"] == 11000 + 15000 + 7000 + 11550
    # Outstanding uses last Balance per invoice: INV-2 = 15000
    assert finances["outstandingBalanceCents"] == 15000
    assert all(line["verifiedAppointment"] is False for line in sales)
    assert all(inv["verifiedAppointment"] is False for inv in finances["invoices"])
    # Zero balance + payment method must NOT confirm collection.
    assert all(inv["paymentConfirmed"] is False for inv in finances["invoices"])
    assert all(inv["paymentVerificationStatus"] == "source_reported_unverified" for inv in finances["invoices"])


def test_duplicate_invoice_identity_preserved():
    sales = parse_sales_report(SALES)["lines"]
    finances = reconcile_finances(sales)
    inv2 = next(inv for inv in finances["invoices"] if inv["invoiceNumber"] == "INV-2")
    assert inv2["lineCount"] == 2
    assert inv2["sourceId"] == "noterro:INV-2"
    assert inv2["totalCents"] == 22000


def test_overlapping_categories_and_invitation_readiness():
    pe = parse_patient_export(PATIENT_EXPORT)["patients"]
    pw = parse_patients_without_appointments(SECONDARY)["patients"]
    sales = parse_sales_report(SALES)["lines"]
    result = reconcile_patients(pe, pw, sales, existing_clients=[{"id": "c-ada", "email": "ada.a@example.com", "phone": ""}])
    oc = result["overlappingCategoryCounts"]
    assert oc["totalCandidateIdentities"] == result["distinctIncoming"]
    # Categories may overlap (email + phone on same identity); not an additive partition.
    assert oc["withUsableEmail"] >= 1
    assert oc["proposedNewIdentities"] + oc["existingMatchedStaging"] + oc["salesOnlyRequiresReview"] >= oc["totalCandidateIdentities"]
    assert sum(result["invitationReadinessCounts"].values()) == oc["totalCandidateIdentities"]
    frank = next(item for item in result["patients"] if item.get("fromSalesOnly"))
    assert frank["flags"]["salesOnlyRequiresReview"] is True
    assert frank["invitationReadiness"] == "requires_identity_reconciliation"
    cara = next(item for item in result["patients"] if item["status"] == "missing_contact" and not item["fromSalesOnly"])
    assert cara["flags"]["lacksEmailAndPhone"] is True
    assert cara["invitationReadiness"] in ("requires_contact_verification", "requires_identity_reconciliation")


def test_dry_run_preview_strips_internal_and_writes_nothing():
    report = build_migration_preview(
        patient_export_csv=PATIENT_EXPORT,
        secondary_csv=SECONDARY,
        sales_csv=SALES,
        existing_clients=[],
    )
    assert report["dryRun"] is True
    assert report["writesOperationalData"] is False
    assert report["historicalServiceClassification"]["verifiedHistoricalAppointment"] == 0
    assert report["historicalServiceClassification"]["historicalBilledService"] == 4
    assert "overlappingCategoryCounts" in report["patientReconciliation"]
    assert report["financialValidation"]["paymentInferenceDisabled"] is True
    assert report["financialValidation"]["clinicalAppointmentsCreated"] == 0
    public = public_preview(report)
    assert "_internal" not in public
    dumped = json.dumps(public)
    assert "ada.a@example.com" not in dumped
    assert "17805550101" not in dumped
    assert "Ada" not in dumped


def test_malformed_money_recorded_as_error():
    bad = SALES.replace("$110.00,$0.00,1.00,,,,$0.00,$110.00,$0.00", "not-a-price,$0.00,1.00,,,,$0.00,$110.00,$0.00", 1)
    parsed = parse_sales_report(bad)
    assert parsed["errors"]


def test_staging_plan_has_no_db_side_effects():
    from nabitouch_staging_plan import (
        COLLECTIONS_MODIFIED_BY_IMPORT,
        COLLECTIONS_NOT_TOUCHED,
        build_checkpoint_e_prep_report,
    )
    plan = build_checkpoint_e_prep_report(patient_record_count=10, invoice_record_count=51)
    assert plan["status"] == "prepared_stop_before_import"
    assert plan["importExecutionProcedure"]["databaseWritesAuthorized"] is False
    assert "nt_legacy_patients" in plan["collectionsModified"]
    assert "nt_clients" in plan["collectionsNotTouched"]
    assert "nt_appointments" in COLLECTIONS_NOT_TOUCHED
    assert set(COLLECTIONS_MODIFIED_BY_IMPORT).isdisjoint(COLLECTIONS_NOT_TOUCHED)
    assert plan["proposedWriteSet"]["noInvitations"] is True
    assert plan["proposedWriteSet"]["noClinicalAppointments"] is True


def test_production_plan_keeps_live_gate_closed():
    from nabitouch_production_plan import build_production_readiness_skeleton, FINANCIAL_GATES
    plan = build_production_readiness_skeleton(patient_record_count=34, invoice_record_count=51)
    assert plan["liveActionsAuthorized"] is False
    assert plan["invitationWorkflow"]["autoSendOnImport"] is False
    assert plan["deploymentProcedure"]["autoExecute"] is False
    assert FINANCIAL_GATES["invoiceIdentities"] == 51
    assert "nt_appointments" in plan["collectionsNotTouchedByImport"]
