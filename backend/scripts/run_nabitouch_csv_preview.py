"""Generate an anonymized Checkpoint D preview from private_imports CSVs.

Does not write operational Mongo collections. Does not print personal data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nabitouch_csv_import import build_migration_preview, public_preview  # noqa: E402

PRIVATE = ROOT / "private_imports" / "nabitouch_history"


def main():
    pe = (PRIVATE / "patient_export.csv").read_bytes()
    pw = (PRIVATE / "patients_without_appointments.csv").read_bytes()
    sales = (PRIVATE / "practitioner_sales_report.csv").read_bytes()
    report = build_migration_preview(
        patient_export_csv=pe,
        secondary_csv=pw,
        sales_csv=sales,
        existing_clients=[],
    )
    public = public_preview(report)
    out = PRIVATE / "checkpoint_d_preview.json"
    out.write_text(json.dumps(public, indent=2), encoding="utf-8")
    summary = public["summary"]
    finances = summary["finances"]
    print("dryRun", public["dryRun"])
    print("writesOperationalData", public["writesOperationalData"])
    print("mainPatientExportRows", summary["mainPatientExportRows"])
    print("secondaryPatientExportRows", summary["secondaryPatientExportRows"])
    print("distinctDisplayNames", summary["distinctDisplayNames"])
    print("patientsWithEmail", summary["patientsWithEmail"])
    print("patientsWithPhone", summary["patientsWithPhone"])
    print("patientsNeedingContactReview", summary["patientsNeedingContactReview"])
    print("classification", summary["patientClassificationCounts"])
    print("salesPatientsMissingFromExports", summary["salesPatientsMissingFromExports"])
    print("invoiceCount", finances["invoiceCount"])
    print("billedServiceUnits", finances["billedServiceUnits"])
    print("durationHours", finances["durationHours"])
    print("billedTotalCad", finances["billedTotalCad"])
    print("outstandingBalanceCad", finances["outstandingBalanceCad"])
    print("taxCents", summary["taxCents"])
    print("discrepancies", len(public["discrepancies"]))
    for row in public["discrepancies"]:
        print(" discrepancy", row["metric"], "prelim", row["preliminary"], "verified", row["verified"])
    print("errors", public["errors"])
    print("wrote", str(out))


if __name__ == "__main__":
    main()
