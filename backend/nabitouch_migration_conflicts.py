"""Reconciliation plan for Checkpoint D/E historical CSV conflicts.

Counts are structural only — no patient names or contact values.
Never assign an invoice to a patient solely to complete an import.
"""

CONFLICT_PLAN = {
    "ambiguousInvoiceToPatientMatches": {
        "count": 14,
        "rule": "Display-name collisions across reconciled identities. Do not auto-link.",
        "actions": [
            "Owner reviews each colliding display-name bucket offline (private worksheet, not git)",
            "Link invoice only when email/phone/source id uniquely identifies one legacy patient",
            "Otherwise keep invoice sourcePatientId unset and status=needs_manual_link",
            "Preserve all 51 invoice identities and line totals regardless of link state",
        ],
        "forbidden": ["Merge patients by display name", "Guess assignment to clear the queue"],
    },
    "salesOnlyPatientIdentities": {
        "count": 2,
        "rule": "Appear only on practitioner sales report; no patient-export row.",
        "actions": [
            "Manual identity confirmation against Noterro / clinic records",
            "Create legacy patient only after owner confirms legal name + contact",
            "Mark invitationReadiness=requires_identity_reconciliation until confirmed",
        ],
    },
    "contactVerificationCases": {
        "count": 3,
        "rule": "Identity present but lacking usable email and phone for invite.",
        "actions": [
            "Owner PATCH contact via Legacy Clients UI before invite",
            "Status remains needs_contact_review until contactComplete",
            "Do not send invitations",
        ],
    },
    "identityReconciliationCases": {
        "count": 16,
        "rule": "Ambiguous duplicates and/or sales-only stubs requiring human merge decision.",
        "actions": [
            "Keep separate sourceIds until owner chooses keep-separate or link-duplicateOf",
            "Never auto-merge",
            "Block invite while invitationReadiness requires_identity_reconciliation",
        ],
    },
    "currentlyUnlinkedInvoices": {
        "count": 14,
        "rule": "Same set as ambiguous name matches after unique-name linking (37 linked / 14 unlinked).",
        "actions": [
            "Import linked invoices (37) under nt_legacy_invoices with historical classification",
            "Hold 14 unlinked invoices in preview payload or import with sourcePatientId null skipped by _prepare",
            "Financial gates still require all 51 identities present in source reconciliation report",
            "Post-import: track unlinked count as residual until owner resolves",
        ],
        "integrity": {
            "invoiceIdentities": 51,
            "billingLines": 64,
            "billedTotalCad": 6657.50,
            "outstandingBalanceCad": 457.55,
            "reportedTaxCad": 177.50,
            "massageServiceUnits": 57.0,
            "massageDurationHours": 55.0,
        },
    },
}


def migration_readiness(*, live_canonical_mismatch: bool, backup_verified: bool) -> dict:
    blockers = []
    if live_canonical_mismatch:
        blockers.append(
            "Live Nabitu practitioner id is not p-nabitu-kahindo; sole-therapist code must be aligned before deploy"
        )
    if not backup_verified:
        blockers.append("Production encrypted backup + SHA-256 verification not completed")
    blockers.extend([
        "14 ambiguous invoice links unresolved",
        "2 sales-only identities unresolved",
        "Owner authorization still required for import write",
    ])
    return {
        "importWriteAuthorized": False,
        "conflictPlan": CONFLICT_PLAN,
        "blockers": blockers,
        "safeToImportNow": False,
    }
