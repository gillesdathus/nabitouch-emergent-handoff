# Field encryption and file quarantine

## What is encrypted

When `FIELD_ENCRYPTION_KEY` is set, the API seals these values before they are written:

- Insurance `memberId` and `policy`
- Clinical note text, amendment text, and import SOAP text
- Intake answers
- Uploaded insurance and clinical file bytes

Authorized API responses decrypt them. A practitioner snapshot does not include another client's insurance block. Reception still receives insurance only when that permission is on. Clinical notes stay limited to the owner and the treating practitioner.

The key is 32 bytes, encoded as url-safe base64. Production startup refuses to run without it. The key is not written to MongoDB, logs, or this repository.

## Backup

A database dump copies ciphertext. Restoring that dump onto a new host does not make the fields readable unless the same `FIELD_ENCRYPTION_KEY` is present. Store the key in the host secret manager separately from the database backup, and test a restore with the key before relying on it.

## Rotation

1. Copy the current key to `FIELD_ENCRYPTION_KEY_PREVIOUS`.
2. Set `FIELD_ENCRYPTION_KEY` to a new 32-byte key and restart.
3. Reads try the current key, then the previous key.
4. Re-save insurance profiles, notes, intake, and files so new writes use the current key.
5. Remove `FIELD_ENCRYPTION_KEY_PREVIOUS` after those records open correctly.

## Uploaded files

New uploads are quarantined. `GET /api/billing/documents/{id}` returns 409 until `POST /api/billing/documents/{id}/scan` passes.

With `CLAMAV_HOST` empty, the scan re-checks the PDF, JPEG, or PNG signature and marks the file `signature-checked`. That is a type check, not antivirus. With `CLAMAV_HOST` set, the file is released only when clamd reports the stream clean. If clamd cannot be reached, the scan returns 503 and the file stays in quarantine.
