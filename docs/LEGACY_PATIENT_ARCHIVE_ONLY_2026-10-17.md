# Legacy patient archive-only decision (2026-10-17)

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Application RC:** `0a0d8c74336299bce9958bd39ede2769201a4fd5`  
**Decision:** **ARCHIVE ONLY** — do not auto-import legacy `nabi_touch.patients` into `nabitouch_prod`.

## What was preserved

| Asset | Status |
| --- | --- |
| Live DB `nabi_touch` on `nabitouch_mongo` | **Intact** (read-only export; no record writes) |
| Uploads volume `nabitouch-rmt_uploads` | **Intact** on host; offline tarball also copied off-host |
| Gate A encrypted backups (`*.aesgcm`) | **Intact** under `C:\Nabitouch-Backups` |
| Owner Excel/CSV export | Off-host under `C:\Nabitouch-Backups\Legacy-Patient-Export\` (ACL: owner + SYSTEM) |

## What was not done

- No mongorestore / field-map import into `nabitouch_prod`
- No deletion of Emergent Compose project `nabitouch-rmt`, volumes, or backups
- No patient bodies committed to git

## Recovery when needed

1. Live source: `nabitouch_mongo` / database `nabi_touch` / collection `patients` (17 records at export time).  
2. Off-host tabular export + `export_manifest.json` (SHA-256 verified).  
3. Uploads tarball beside the export (checksum in manifest).  
4. Gate A AES-GCM archives remain the encrypted Stage C path for `nabitouch_prod` (separate DB).

## Media note

`media_assets` (18) has **no patient_id linkage**. Exported as separate CMS inventory only. Patient-associated binary files were not identifiable by schema; the full uploads volume was archived instead.
