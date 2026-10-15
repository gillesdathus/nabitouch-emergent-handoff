# Privacy safeguards

Which statute applies depends on the clinic arrangement. A massage practice in Alberta may be a health custodian under the Health Information Act, a PIPA organization, or both, and federal PIPEDA can also matter for commercial activity. This repository does not decide that. A privacy officer or counsel needs to confirm the role, the consent forms, and the retention schedule before launch.

## Controls in the application

- Clinical notes are readable by the owner and the practitioner assigned to that visit. Another practitioner and the receptionist receive 403 on the note.
- Reception can read allergies and contraindications for a client, not the medication narrative.
- Signed notes stay as written. Corrections are amendment records.
- Intake submissions are versioned. A new submission does not delete the previous one.
- Booking does not create a consent record. The client records treatment or mobile consent separately and can withdraw it.
- Clinical reads and exports are written to an access log that stores the actor, the action, and the record id. It does not store the note text.
- Owner export of a client's clinical file can require a completed authenticator check when `requireMfaForPrivileged` is on.
- Insurance files are private, type-checked, and stored in quarantine. A download is refused until a signature check passes, or until ClamAV reports the file clean when `CLAMAV_HOST` is set. If that scanner cannot be reached, the file stays in quarantine. Clients see a file only when staff mark it visible and the check has passed.
- Insurance member numbers, policy numbers, intake answers, clinical note text, and uploaded file bytes are encrypted when `FIELD_ENCRYPTION_KEY` is set. The key is an environment variable. It is not written to MongoDB or this repository. A backup of those fields cannot be restored into readable form without the same key. See `docs/FIELD_ENCRYPTION.md`.
- Billing notices say that an update is ready. They do not include amounts or insurer names. Promotional notices are a separate channel and are refused without marketing consent or when the text contains clinical words.
- Live location is appointment-scoped, started by the practitioner, and ended when the trip ends. The mobile brief returns the service address and a sharing flag, not a location trail.

## Not provided by this build

A chosen retention deletion job and a signed privacy impact assessment. Disk encryption, TLS, and backup access control are hosting decisions. The application encrypts the fields above and can call ClamAV, and it does not replace those hosting controls.
