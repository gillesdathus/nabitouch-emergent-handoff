# Privacy readiness gap assessment

This is a technical inventory of data the application stores and who can reach it. It is not a privacy impact assessment, not a certification, and not a legal opinion. A qualified Alberta or Canadian privacy reviewer needs to decide which statute applies and what the retention schedule should be. Existing notes in `docs/PRIVACY.md` and `docs/FIELD_ENCRYPTION.md` still apply.

Legacy patient records were not deleted, exported, or migrated.

## Data the application handles

| Data | Where it lives | Access control observed in code and tests |
| --- | --- | --- |
| Client name, email, phone, date of birth | Client profile and guest booking payload | Booking creates a client row. Another client's clinical file is not returned to a different client. |
| Addresses | Appointment and client address list | A mobile booking requires a confirmed civic address. The preview contact page does not publish a clinic street. |
| Health intake | Versioned intake submissions | A new submission does not delete the previous one. Booking itself does not create a treatment-consent record. |
| SOAP and clinical notes | Clinical collections | Owner and the assigned practitioner can read a note. Other practitioners and reception receive 403 on the note. Signed notes are amended, not rewritten. |
| Appointments and prices | `nt_appointments` | The stored pricing snapshot is what the invoice copies. Historical totals are not recalculated when catalogue prices change. |
| Insurance identifiers and files | Insurance records, quarantine uploads | Downloads stay blocked until a signature check passes. Production document uploads are intended to stay off. |
| Practitioner registration and insurance | Credential records | An approved profile needs current registration and liability insurance. Draft profiles are not bookable. Values for Nabitu Kahindo were not invented. |
| Catalogue and profile photos | `nt_media` | JPEG, PNG, and WebP only. Images are re-encoded and metadata is stripped. Anonymous reads follow publication. Cache-Control is `private, no-store`. |
| Audit logs | `nt_audit` | Catalogue writes record the signed-in actor. A failed audit insert rolls the catalogue write back. |
| Backups | Mongo archives | Field-encrypted values stay ciphertext without `FIELD_ENCRYPTION_KEY`. The key is an environment variable, not a database field. |
| Guest tracking links | Tracking responses | The confirmation told the guest the link expires in two hours. Tracking responses are sent `no-store`. |

## Retention, export, and deletion

The application can export a client's clinical file and can require MFA for that export when the privileged-MFA setting is on. It does not ship an automatic retention-deletion job. Insurance uploads carry a 2555-day hint and are not deleted by a scheduler. Deleting a clinical record is not automatic.

This run did not export or delete any clinical record.

## Decisions that need professional review

1. Whether Nabitouch is a health custodian under the Health Information Act, an organization under PIPA, subject to PIPEDA, or more than one of those.
2. The consent wording for treatment, mobile visits, insurance handling, and optional marketing. Booking does not record that consent today.
3. How long appointments, invoices, intake, SOAP notes, insurance files, audit logs, and backups must be kept, and when deletion is allowed.
4. Whether guest booking without an account is an acceptable way to collect health-adjacent booking details.
5. Who may use the owner clinical export, and whether MFA must be mandatory before launch.
6. How legacy Hostinger patient records stay available without being copied into the new database by accident.
7. Whether the welcome-offer claim keys (client id, email, phone) are a permitted matching purpose.
8. Backup storage location, encryption at rest, and who can decrypt `FIELD_ENCRYPTION_KEY`.

Until those decisions are written down by a qualified reviewer, this repository should not be described as privacy-certified, and legacy health records should stay where they are.
