# Pre-cleanup database dump

This file is still on the VPS:

`/root/nabitouch-next-backups/nabitouch_prod-before-cleanup-20261013.archive.gz`

It is an uncompressed archive from before synthetic records were removed. It is not the encrypted launch archive, and it is not the legacy patient archive. Do not restore it into `nabitouch_prod`. Do not copy it to another machine. Do not delete it as part of a deployment.

## Later cleanup

Delete it only after all of the following are true:

1. The owner has finished the Alberta retention review described in `docs/BACKUP_RESTORE.md`.
2. A separate encrypted copy, with its own key kept off the server, has been checked by SHA-256 and an authenticated decrypt on a disposable database.
3. That check did not use the field-encryption key or the legacy patient-archive key.
4. The owner has given a written instruction that names this exact path.

Then, on the VPS, as root:

```bash
test -f /root/nabitouch-next-backups/nabitouch_prod-before-cleanup-20261013.archive.gz
shred -u /root/nabitouch-next-backups/nabitouch_prod-before-cleanup-20261013.archive.gz
```

`shred -u` removes the file after overwriting it. Do not use it on the encrypted launch archive, the legacy patient archive, `/etc/nabitouch-next.env`, or any MongoDB volume.

This procedure is not authorized now.
