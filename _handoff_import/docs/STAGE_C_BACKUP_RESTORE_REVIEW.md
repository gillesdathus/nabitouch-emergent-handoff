# Stage C backup and restore review

14 October 2026. Review only. The backup, restore, and cleanup scripts were not executed. No confirmation variable was set to `yes`.

## 1. Script inventory

| Script | Purpose | Arguments | Confirmation | Source | Destination | Encryption | Checksum | Cleanup | Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `deploy/private-release/backup-encrypted.sh` | Oplog dump streamed into AES-256-GCM | none. `CONSISTENCY_MODE` must be unset or `oplog` | `CONFIRM_PRODUCTION_BACKUP=yes` | replica set `rs0`, including `nabitouch_prod` | `/root/nabitouch-next-backups/nabitouch_prod_<UTC>.archive.gz.aesgcm` | AES-256-GCM, PBKDF2, 200000 iterations, salt, prompted passphrase | SHA-256 of the ciphertext, hash only | Removes a partial ciphertext and the temporary URI file. Does not delete existing archives | 0 success, 2 refusal, 1 dump or encrypt failure |
| `deploy/private-release/transfer-encrypted-backup.sh` | Copy ciphertext off the host | ciphertext path. Destination is `OFFHOST_DESTINATION` | `CONFIRM_OFFHOST_TRANSFER=yes` | the local ciphertext, checksum, and manifest | `user@host:/absolute/directory` | none. It does not decrypt | Compares the remote SHA-256 before the final name is published | Does not delete the local backup. Leaves a remote `.partial` if the copy fails | 0 stored, 2 blocked or refusal, 4 checksum mismatch, 1 incomplete copy |
| `deploy/private-release/verify-isolated-restore.sh` | Namespace restore for a non-oplog archive | ciphertext path | `CONFIRM_ISOLATED_RESTORE=yes` | the ciphertext | new `nabitouch_prod_restore_<UTC>` on `nt-next-mongo` | decrypts the same AES-256-GCM stream | checks the `.sha256` file before decrypt | shreds the decrypted stream. Leaves the validation database. Refuses an oplog manifest | 0 match, 2 refusal, 4 checksum mismatch, 3 count mismatch, 1 decrypt failure |
| `deploy/private-release/restore-oplog-isolated.sh` | Oplog replay on a separate mongod | ciphertext path and `nt-restore-*` container | `CONFIRM_ISOLATED_RESTORE=yes` | the ciphertext | original namespaces on that container only | decrypts to a mode `600` file outside the backup directory | checks the `.sha256` file before decrypt | shreds the decrypted stream. Does not remove the container | 0 replay finished, 2 refusal, 4 checksum mismatch, 3 `nabitouch_prod` missing after replay, 1 decrypt failure |
| `deploy/private-release/drop-isolated-restore.sh` | Drop one remapped validation database | database name | `CONFIRM_DROP_RESTORE=yes` | none | only a timestamped `nabitouch_prod_restore_<UTC>` name on the live API | none | none | drops that database only | 0 dropped, 2 refusal |
| `deploy/private-release/remove-isolated-mongo.sh` | Remove the throwaway mongod | container name | `CONFIRM_REMOVE_ISOLATED_INSTANCE=yes` | none | only `nt-restore-*` with network `none` and no production volume | none | none | `docker rm` that container and a volume of the same name | 0 removed, 2 refusal |
| `deploy/private-release/stage-c-checks.sh` | Shared refusals | none | none | none | none | none | fixture comparison | none | used by the scripts and the fixture test |
| `deploy/private-release/stage-c-checks.test.sh` | Fixture and static checks | none | none | none | none | none | synthetic files | deletes its temp fixture | 0 when the checks pass |

`deploy-private-api.sh` and `stage-frontend-static.sh` are Stage D. They were not part of this run.

The original backup script wrote a plaintext `.archive.gz` into the backup directory and put `MONGO_URL` on the `mongodump` command line. The original restore script used `mongorestore --drop` and could decrypt into the backup directory. Those paths were corrected in this review and were not run.

## 2. Encryption assessment

The corrected backup pipes `mongodump --oplog --archive --gzip` into `openssl enc -aes-256-gcm`. The persistent file is ciphertext. A `.partial` file in the backup directory is the ciphertext stream while encryption is running. The exit trap deletes that partial file. The passphrase is read from the terminal and given to OpenSSL through the environment, then unset. It is not hardcoded, not a command argument, and not written to a log line.

The MongoDB URI is written to a mode `600` temporary file, copied into the container as a tool config, and shredded. It is not passed as `--uri`.

This is authenticated encryption. It is not a managed key service. The script does not store the passphrase. If the operator does not put it in a password manager, the archive cannot be decrypted later. A matching SHA-256 proves the ciphertext file matches the recorded digest. It does not prove that the passphrase works or that the database can be restored.

On restore, the decrypted gzip is a mode `600` file under `/dev/shm` when that directory exists, otherwise `/tmp`. The trap shreds it. It is not left in the backup directory.

## 3. Database targeting assessment

Backup proceeds only when `DB_NAME` in `/etc/nabitouch-next.env` is exactly `nabitouch_prod`. `mongodump --oplog` cannot take `--db`, so the archive contains every database the user can read except `local`. The script allows only `admin`, `local`, `config`, and `nabitouch_prod`. Any other database name stops the backup before encryption. `admin` is included because an oplog dump cannot exclude it. It holds the replica set's user records. Those records are restored only on the throwaway mongod.

`verify-isolated-restore.sh` still remaps `nabitouch_prod.*` to `nabitouch_prod_restore_<UTC stamp>` and refuses `nabitouch_prod`, `admin`, `local`, `config`, and `test`. It now refuses an archive whose manifest says `consistency=oplog`, because oplog replay cannot be remapped and must not run on `nt-next-mongo`.

`restore-oplog-isolated.sh` accepts only a container named `nt-restore-*`. It refuses `nt-next-mongo`, the public MongoDB container, the API, and the name `nabitouch_prod`. The container must be running, use network `none`, publish no ports, and mount no production volume. It refuses the restore when that mongod already has a user database or any user in `admin.system.users`. `mongorestore` uses `--oplogReplay` and does not use `--drop`, `--uri`, or `--nsFrom`.

Production overwrite is prevented by these script checks. It is not prevented by a separate MongoDB role. A hand-typed `mongorestore` could still target the wrong database. Do not run `mongorestore` outside these scripts.

## 4. Consistency assessment

`nt-next-mongo` is a single-node replica set named `rs0` with authentication and no TLS listener. The port is not published on the host. The prepared backup uses `mongodump --oplog` on that primary and replays the captured oplog on a separate mongod. See the consistency section below. The last measured data size was 20,145 bytes. No service is stopped by this procedure.

## 5. Checksum assessment

The backup writes one SHA-256 hex line beside the ciphertext and exits non-zero if that file is empty. An encrypted file under 128 bytes is rejected before it is renamed into place. The restore script rejects a missing archive, an empty archive, a missing checksum, an empty checksum, and a mismatch. Mismatch exits 4, before decrypt. The checksum file contains only the digest, not credentials or client records.

## 6. Restore isolation assessment

An oplog backup is replayed by `restore-oplog-isolated.sh` onto a new mongod that is not a member of `rs0`. The restored namespaces keep their original names, including `nabitouch_prod` and `admin`, only inside that container. The running API, `DB_NAME`, and Nginx are not changed. The container has no network and no published port. The data is still production data. Remove the container with the separate cleanup command after validation.

`verify-isolated-restore.sh` remains the path for an older archive that has no oplog manifest. It creates `nabitouch_prod_restore_<UTC stamp>` on the live replica set, refuses that name if it already exists, and leaves the database in place. Do not point it at an oplog archive. The script refuses that manifest.

## 7. Storage and retention assessment

Last inspection, not remeasured here: about 67 GiB free, logical data about 20 KiB, and the MongoDB volume about 325 MiB. Earlier ciphertext archives were about 10 KiB. A new encrypted archive should be in that range, far below free space. Temporary space is the stream plus a short-lived decrypted file in `/dev/shm`.

The script sets directory mode `700` and file mode `600`. Run it as root. There is no backup cron and this review did not delete, move, or re-encrypt anything. Two plaintext archives from 13 October 2026 are still in `/root/nabitouch-next-backups`. They are a storage concern. Leave them until a separate decision.

The oplog archive also contains `admin`, `config` when it exists, and the oplog entries written while the dump runs. At the last measured size that is still kilobytes, plus a second small volume for the throwaway mongod. Free space was about 67 GiB and was not remeasured.

The transfer script can copy the ciphertext, the `.sha256` file, and the manifest. It does not copy a plaintext archive or the passphrase. No off-host destination is configured, so that copy is **BLOCKED**. Local storage is not an off-host copy. `FIELD_ENCRYPTION_KEY` is still required to read encrypted fields inside a restored database, and it is not inside the archive.

## 8. Static test results

`bash -n` passed for the Stage C scripts and the fixture test. `deploy/private-release/stage-c-checks.test.sh` passed 83 checks. The backup, transfer, restore, drop, and removal scripts were not invoked.

The fixture checks cover a missing or wrong confirmation, an empty passphrase, a source database other than `nabitouch_prod`, a production restore name, an existing validation name, a namespace outside `nabitouch_prod`, a checksum mismatch, a missing or empty archive, and removal of a partial file without deleting a neighboring file. They also cover an unsupported consistency mode, an oplog window below 3600 seconds, an unexpected database name, a missing off-host destination, a short transfer, a destination checksum mismatch, an existing destination archive, a missing recovery record, a recovery record that contains a passphrase, and a restore aimed at `nt-next-mongo` or `nabitouch_prod`. A static scan checks that each production script calls its confirmation guard before `docker`, `mongodump`, `mongorestore`, `openssl`, `ssh`, `scp`, or `mktemp`, and that those scripts do not contain `--drop` or `--uri`.

## 9. Future execution commands

Run these on `srv1393944` as root, from a checkout that contains `deploy/private-release/`. Do not use `/opt/nt-next`. Do not set a confirmation variable until that step is separately authorized.

### A. Read-only prerequisites

```text
df -hP /
docker inspect nt-next-mongo --format '{{.State.Status}}'
docker inspect nt-next-api --format '{{.State.Status}}'
```

Expect MongoDB and the API to be running, and free space still on the order of tens of GiB. No confirmation variable.

### B. Backup

```text
CONFIRM_PRODUCTION_BACKUP=yes deploy/private-release/backup-encrypted.sh
```

The terminal prompts `Backup passphrase:`. Expected output is one line naming the `.sha256` file, plus a `.manifest` file with `consistency=oplog` and no passphrase. Expected exit 0. Exit 2 also means the database user cannot read the oplog, the oplog window is under 3600 seconds, the database list is unexpected, or `mongodump` is older than Database Tools 100. If it exits 1, the dump or encryption failed and the partial ciphertext should already have been removed. Do not rerun with a new passphrase against an archive encrypted with a different one.

### C. Checksum verification

Replace the stamp with the name printed by the backup. This does not decrypt.

```text
awk 'NR==1 { print $1 }' /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm.sha256
sha256sum /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm
```

The two hashes must match. A mismatch means the file must not be restored.

### Off-host copy

**BLOCKED** until the owner provides a destination. Do not treat `/root/nabitouch-next-backups` as that destination. The destination directory must already exist, mode `700`, and the host must provide `stat` and `sha256sum`. SSH must use a key already loaded in the agent. `BatchMode` is set, so the script will not prompt for a password or put one on the command line.

```text
OFFHOST_DESTINATION=user@backup-host:/absolute/directory CONFIRM_OFFHOST_TRANSFER=yes deploy/private-release/transfer-encrypted-backup.sh /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm
```

Expected output is one line beginning `Off-host ciphertext stored:`. Expected exit 0. Exit 2 means the destination was refused or SSH could not see the directory. Exit 4 means the remote checksum did not match and the final name was not published. Exit 1 means the byte count did not match. The local archive is left in place either way.

### D and E. Isolated oplog restore

Run this on a machine that has the ciphertext, the checksum, the manifest, and Docker. It does not need the production host. Start the throwaway mongod first. Do not attach it to `rs0` or to the `nt-next` network.

```text
docker run -d --name nt-restore-<stamp> --network none -v nt-restore-<stamp>:/data/db mongo:7 mongod --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.25
CONFIRM_ISOLATED_RESTORE=yes deploy/private-release/restore-oplog-isolated.sh /absolute/path/nabitouch_prod_<stamp>.archive.gz.aesgcm nt-restore-<stamp>
```

The terminal prompts for the same passphrase. Expected output includes `isolated-target-empty`, a JSON line with `"database": "nabitouch_prod"`, and a line saying the instance is still present. Expected exit 0. Exit 2 means the container, the manifest, or an existing database was rejected. Exit 4 means the checksum did not match. Do not run `verify-isolated-restore.sh` on this archive. That script refuses an oplog manifest so it cannot replay onto `nt-next-mongo`.

### F. Cleanup

Oplog validation cleanup is separate from the remapped-database drop. Use the throwaway name only.

```text
CONFIRM_REMOVE_ISOLATED_INSTANCE=yes deploy/private-release/remove-isolated-mongo.sh nt-restore-<stamp>
```

Expected output is `removed nt-restore-<stamp>`. Expected exit 0. The script rejects `nt-next-mongo` and `nabitouch_prod`. `drop-isolated-restore.sh` is only for a `nabitouch_prod_restore_<stamp>` database left by the older non-oplog script.

## 10. Remaining risks

- The passphrase is not stored by the script. Losing it makes the new archive unreadable.
- The oplog role of the application database user has not been checked. If that user cannot read `local.oplog.rs`, the backup script exits 2 and writes nothing.
- The oplog window has not been measured. A window under 3600 seconds is refused.
- `mongodump` on the server was not executed, so its Database Tools version is checked only when a later run is authorized.
- The archive includes `admin` user records because `--oplog` cannot exclude them.
- MongoDB authentication is on. MongoDB TLS is not.
- Off-host transfer is blocked until the owner names a destination. The ciphertext would otherwise remain only on the production host.
- Older plaintext archives remain in the backup directory.
- A killed process can leave a ciphertext file without a checksum. Do not restore an archive that has no `.sha256` file.
- The throwaway mongod contains production data until the separate removal command runs.
- A matching checksum does not prove that the passphrase works.

## 11. Authorization prerequisites

Stage C execution still needs an explicit owner approval to create the backup, to name an off-host directory, and to replay the archive on a throwaway mongod. Cleanup needs its own approval. This review is not that approval. Deployment, Nginx, DNS, and public booking stay unauthorized.

## 12. Recommendation

**NO-GO to execute Stage C now.**

The oplog procedure is prepared. Off-host copy stays blocked until a destination exists. Do not run the scripts until the owner gives both approvals.

## Consistent recovery and off-host copy

The selected method is an oplog dump, not an application pause. `mongodump --oplog` records a recovery point at the end of the oplog captured during the dump. `mongorestore --oplogReplay` applies that point on a new mongod. The API stays up. MongoDB stays up.

Pausing writers was rejected. The only application process in this stack that uses the database is `nt-next-api`. The public site uses a different MongoDB container. There is no separate worker in the compose file. Stopping the API would not stop a host shell or another client on the Docker network, and changing the database user to read-only would be a credential change. A consistency claim based on stopping one container would be false, so that mode is refused.

The guarantee holds only when the later run passes its own checks: Database Tools 100.x, a readable oplog, a window of at least 3600 seconds, and no database outside `admin`, `local`, `config`, and `nabitouch_prod`. `local` is not stored in the archive. The replay must finish with exit 0 on the throwaway instance. This is not a filesystem snapshot, and it has not been rehearsed.

Off-host recovery needs an owner-provided SSH destination, `user@host:/absolute/directory`. No destination is configured. No cloud service was selected. The transfer copies ciphertext, the checksum, and the manifest, then checks size and SHA-256 before it publishes the final name. It does not upload the passphrase.

The owner keeps the recovery set outside Git, outside logs, and outside `/root/nabitouch-next-backups`: the passphrase in a password manager, the archive file name, the SHA-256 digest, the off-host location, and this procedure. The backup directory receives only the ciphertext, the digest file, and the manifest.
