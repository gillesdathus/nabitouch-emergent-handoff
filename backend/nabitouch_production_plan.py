"""Production-directed migration and release plan. No live writes from this module.

Final authorization gate: database writes, invitation sends, and Hostinger deploys
require explicit operator approval after the readiness report is reviewed.
"""
from __future__ import annotations

PROD_DB_CANDIDATES = ("nabitouch_prod",)
FORBIDDEN_ACCIDENTAL = ("demo", "qa_isolated")

REQUIRED_FEATURE_FLAGS_FOR_IMPORT = {
    "LEGACY_PATIENT_IMPORT_ENABLED": "true",
    "EMAIL_PROVIDER": "configured-for-invites-separately",
    "NOTIFICATION_WORKER_ENABLED": "false-during-import",
    "REVIEW_INVITES_ENABLED": "false",
    "SMS_ENABLED": "false-unless-legacy-sms-approved",
    "LEGACY_SMS_INVITES_ENABLED": "false",
}

COLLECTIONS_MODIFIED_BY_LEGACY_IMPORT = (
    "nt_legacy_patients",
    "nt_legacy_invoices",
    "nt_legacy_batches",
    "nt_legacy_events",
)

COLLECTIONS_NOT_TOUCHED_BY_IMPORT = (
    "nt_clients",
    "nt_users",
    "nt_appointments",
    "nt_ledger",
    "nt_invoices",
    "nt_legacy_invitations",
    "nt_legacy_onboarding",
    "nt_legacy_files",
)

FINANCIAL_GATES = {
    "invoiceIdentities": 51,
    "billingLines": 64,
    "billedTotalCad": 6657.50,
    "outstandingBalanceCad": 457.55,
    "reportedTaxCad": 177.50,
    "massageDurationHours": 55.0,
    "massageServiceUnits": 57.0,
}

PRACTITIONER_GATES = {
    "soleTherapistId": "p-nabitu-kahindo",
    "soleTherapistName": "Nabitu Kahindo",
    "managerReceptionistDesignation": "manager_receptionist",
    "managerDisplayNameExpected": "Dathus Gilles",
    "activationBypassForbidden": True,
}


def proposed_write_set(*, patient_record_count: int, invoice_record_count: int) -> dict:
    return {
        "target": "production-directed (authorization gated)",
        "collections": {
            "nt_legacy_patients": {"operation": "insert_many", "estimatedDocuments": patient_record_count},
            "nt_legacy_invoices": {"operation": "insert_many", "estimatedDocuments": invoice_record_count},
            "nt_legacy_batches": {"operation": "insert_one", "estimatedDocuments": 1},
            "nt_legacy_events": {"operation": "insert_one", "estimatedDocuments": 1},
        },
        "explicitlyExcluded": list(COLLECTIONS_NOT_TOUCHED_BY_IMPORT),
        "noClinicalAppointments": True,
        "noActivePatientAccounts": True,
        "noInvitationsOnImport": True,
        "noLedgerPostings": True,
        "neverOverwriteOperationalWithoutReconciliation": True,
    }


def backup_and_rollback() -> dict:
    return {
        "backup": [
            "Confirm intended production MONGO_URL / DB_NAME with operator sign-off",
            "Create encrypted mongodump of production database before any migration write",
            "Record archive SHA-256 and store off-host recovery key custody",
            "Verify dump restores into an isolated verification database (not live cutover)",
        ],
        "rollback": {
            "preferred": "POST /api/legacy/batches/{batchId}/rollback when no linked/invited patients",
            "fallback": "Restore verified pre-migration dump into production only with explicit approval",
            "forbidden": ["Partial silent deletes of invited/activated rows", "Restore into wrong DB_NAME"],
        },
    }


def deployment_procedure() -> dict:
    return {
        "host": "Hostinger production (existing private deploy)",
        "separation": "Application deploy and data migration are separate controlled operations",
        "steps": [
            "Merge release branch after CI green",
            "Deploy application image/config with LEGACY_PATIENT_IMPORT_ENABLED still false until migration window",
            "Verify practitioner gates (Nabitu sole therapist; Dathus manager/receptionist)",
            "Read-only production reconciliation + CSV import preview",
            "Enable import flag only for authorized migration window",
            "Execute import with authorize + backupConfirmed",
            "Disable import flag; run post-import reconciliation",
            "Invitation sends remain a separate owner-operated step (never automatic)",
        ],
        "autoExecute": False,
    }


def build_production_readiness_skeleton(*, patient_record_count: int = 0, invoice_record_count: int = 0) -> dict:
    return {
        "status": "implementation_in_progress",
        "liveActionsAuthorized": False,
        "practitionerGates": PRACTITIONER_GATES,
        "financialGates": FINANCIAL_GATES,
        "collectionsModifiedByImport": list(COLLECTIONS_MODIFIED_BY_LEGACY_IMPORT),
        "collectionsNotTouchedByImport": list(COLLECTIONS_NOT_TOUCHED_BY_IMPORT),
        "proposedWriteSet": proposed_write_set(
            patient_record_count=patient_record_count,
            invoice_record_count=invoice_record_count,
        ),
        "backupAndRollback": backup_and_rollback(),
        "deploymentProcedure": deployment_procedure(),
        "invitationWorkflow": {
            "secureClaimLinks": True,
            "brandedEmailTemplate": True,
            "duplicateAccountPrevention": True,
            "statusDashboardEndpoint": "GET /api/legacy/invitations",
            "autoSendOnImport": False,
            "smsOptionalFuture": True,
            "smsDefaultOff": True,
        },
        "authorizationGate": [
            "Final release report reviewed",
            "Production environment + DB_NAME confirmed",
            "Recoverable backup verified",
            "Import preview + financial gates accepted",
            "Explicit approval for deploy and/or migration writes",
        ],
    }


# Back-compat aliases for earlier Checkpoint E prep imports/tests.
STAGING_DB_NAME = "nabitouch_staging"
COLLECTIONS_MODIFIED_BY_IMPORT = COLLECTIONS_MODIFIED_BY_LEGACY_IMPORT
COLLECTIONS_NOT_TOUCHED = COLLECTIONS_NOT_TOUCHED_BY_IMPORT


def build_checkpoint_e_prep_report(*, patient_record_count: int = 0, invoice_record_count: int = 0) -> dict:
    report = build_production_readiness_skeleton(
        patient_record_count=patient_record_count,
        invoice_record_count=invoice_record_count,
    )
    report["checkpoint"] = "E-prep-superseded-by-production-plan"
    report["status"] = "prepared_stop_before_import"
    report["collectionsModified"] = list(COLLECTIONS_MODIFIED_BY_LEGACY_IMPORT)
    report["collectionsNotTouched"] = list(COLLECTIONS_NOT_TOUCHED_BY_IMPORT)
    report["importExecutionProcedure"] = {
        "databaseWritesAuthorized": False,
        "status": "prepared_not_executed",
    }
    report["proposedWriteSet"]["noInvitations"] = True
    report["proposedWriteSet"]["noClinicalAppointments"] = True
    report["remainingRisksAndGates"] = {
        "approvalGatesBeforeExecute": report["authorizationGate"],
        "risks": [
            "Ambiguous display-name collisions must not be merged",
            "sourcePatientId must be wired for invoices or lines drop",
            "Payment labels remain source_reported_unverified",
            "Production MONGO_URL must be confirmed before any write",
        ],
    }
    return report
