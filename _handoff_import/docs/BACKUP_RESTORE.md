# Backup and restore

Financial and clinical records live in MongoDB. Redis is the live tracking cache. A Redis outage hides GPS and does not delete invoices.

The disposable database used for development is a standalone MongoDB. It does not support multi-document transactions. Ledger writes use an operation journal (`nt_ops`) plus a unique idempotency key. The owner can compare stored invoice balances with the ledger at `GET /api/billing/reconciliation` and copy the ledger result back with `POST /api/billing/reconciliation/repair`. Repair does not delete ledger lines.

On a replica set the same payment commits the ledger line, the invoice balance, and the journal status together. A conflict aborts all three. On a standalone server a crash after the ledger insert and before the invoice update leaves `nt_ops.status` as `pending` and a balance that reconciliation can repair from the ledger. Retrying the same idempotency key does not post the money twice. The billing notice is written after that commit; the same key inserts the notice if the first attempt died before it, and a duplicate notice is ignored.

An invoice number is assigned after the issue line is stored. Repeating the same issue key fills in a missing number and does not create a second issue line.

## Backup

Run against the deployment you intend to protect. Replace the database name. Do not run this against a database you have not identified.

```bash
mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive=nabitouch.archive.gz --gzip
```

Store the archive outside the application server, and store `FIELD_ENCRYPTION_KEY` in a separate secret manager. The archive contains ciphertext for insurance numbers, clinical text, and uploaded files. Restoring the archive without that key does not make those fields readable. Restrict both the archive and the key to the owner and the person who would restore them.

## Restore drill

Restore into a new database name first.

```bash
mongorestore --uri "$MONGO_URL" --nsFrom "$DB_NAME.*" --nsTo "${DB_NAME}_restore.*" --archive=nabitouch.archive.gz --gzip
```

Compare collection counts, an invoice number, and a signed SOAP note id between the source and the restore. Drop the restore database when the comparison is done.

## Retention

Insurance uploads are marked with a 2555-day retention hint and are not public. They stay in quarantine until a signature check passes, or until ClamAV reports them clean when `CLAMAV_HOST` is set. Deleting a clinical record is not automatic. Export and correction go through the owner clinical export and the SOAP amendment record.

## Local archive of the current Hostinger database

This procedure is not authorized for execution by configuration preparation. Do not run it until the owner asks for the archive. Do not delete the live database afterward.

The old application stays in place. A separate patient contact list does not replace the duty to keep the clinical records that are already on the server.

1. On the owner computer, confirm at least 2 GiB free. The earlier inspection saw a MongoDB volume near 505 MiB and an uploads volume near 50 MiB. Re-measure before the copy.
2. On the VPS, as root, write a `mongodump` archive of the identified old database to a root-only directory. Encrypt that archive with AES-256-GCM, or with `age`, before it leaves the server. The passphrase or age identity is stored in a password manager, not next to the archive and not in git.
3. Copy only the ciphertext to the owner computer over SSH. Compare SHA-256 on both sides.
4. Delete the plaintext dump on the VPS with `shred` where the filesystem allows it, then delete the ciphertext from the VPS after the checksum matches. Do not leave either file in `/tmp`.
5. On a computer that is not the VPS, decrypt into a disposable MongoDB and `mongorestore` into a new database name. Compare collection counts only. Drop that database and shred the decrypted archive.
6. Copy the uploads volume the same way: tar, encrypt, checksum, shred the plaintext, restore the tar into an empty directory, compare file counts, then shred the restored copy used for the check. Do not open the files.
7. Access to the ciphertext and the encryption key is the owner, or a custodian the owner names in writing.

Retention: do not destroy the archive because the website was replaced. Record a destruction date only after a privacy review under Alberta health-information rules. Until that written decision exists, keep the archive. The encryption key for this archive is separate from `FIELD_ENCRYPTION_KEY` for the new application. The old database may not use that new key.

## Redis

Production Redis must use TLS and a password. Tracking keys are appointment-scoped. Persistence is useful for a reconnect during a trip and is not the financial source of truth.
