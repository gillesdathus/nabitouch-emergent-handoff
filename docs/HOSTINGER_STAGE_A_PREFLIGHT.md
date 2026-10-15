# Hostinger Stage A preflight

Inspection only. No service was started, stopped, reloaded, or reconfigured. No backup, dump, restore, certificate renewal, or staging deployment was run.

## A. Executive summary

| Item | Result |
|---|---|
| Inspection time | 12 October 2026, 23:14 UTC |
| Host | Hostinger VPS `187.77.204.131`, hostname `srv1393944` |
| Repository checkpoint | `feature/production-hardening` at `8481d2af4d9ec024c0b7a7c9654ca679f951f00e` |
| Production status | Reachable. Homepage HTTP 200. Public health reports the database up. The three production containers are healthy, with zero restarts and no OOM kill recorded. |
| Staging readiness | The proposed loopback port, network name, and volume names are free. Memory and disk can hold the initial 1,152 MiB staging budget on this snapshot. No Nabitouch backup was found. |
| Stage B | Do not start. This report does not authorize a backup, snapshot, or deployment. |

**Overall assessment: READY WITH CONDITIONS.**

The live site is healthy and the proposed staging names do not collide with current listeners. Stage B can be planned only after the owner accepts the conditions in section J. A dedicated VPS remains preferable for the eventual production replacement.

## B. Host resources

Compared with the 12 October 2026 discovery. No material change in CPU, RAM, swap, or disk.

| Check | This inspection | Previous discovery |
|---|---|---|
| OS | Ubuntu 24.04.4 LTS | Ubuntu 24.04.4 |
| Kernel | 6.8.0-107-generic | 6.8.0-107-generic |
| Architecture | x86_64 | x86_64 |
| vCPU | 2 | 2 |
| Uptime | 178 days, 20 hours | about 178 days |
| Clock | 2026-10-12T23:14:16Z | same day |
| RAM | 7.8 GiB total, 4.1 GiB used, 3.6 GiB available | about 7.8 GiB, about 3.5 GiB available |
| Swap | none | none |
| Disk `/` | 96 GiB, 32 GiB used, 65 GiB free (33%) | about 65 GiB free |
| Inodes `/` | 9% used, about 11.9 million free | not previously highlighted |
| Load | 0.51, 0.61, 0.55 | about 0.7 |

`dg-creator-hostinger` web and API were restarted about 24 minutes before this sample and were healthy. That is the only notable workload change from the earlier inventory.

### Container sample (`docker stats --no-stream`)

One sample. It is not a peak measurement.

| Container | CPU | Memory | Configured cap |
|---|---:|---:|---|
| felicy-hair-mysql-1 | 0.65% | 424 MiB | unlimited |
| dg-academy-academy-1 | 0.00% | 230 MiB | unlimited |
| dgsolutions_minio | 0.00% | 222 MiB | unlimited |
| dg-creator-hostinger-mongo-1 | 0.45% | 208 MiB | 512 MiB (41%) |
| sem-ayiti-prod | 0.00% | 182 MiB | unlimited |
| kwalitee_mongo | 0.41% | 170 MiB | unlimited |
| nabitouch_mongo | 0.46% | 162 MiB | unlimited |
| sem-ayiti-staging | 14.78% | 158 MiB | unlimited |
| nabitouch_backend | 0.48% | 55 MiB | unlimited |
| nabitouch_frontend | 2.64% | 6 MiB | unlimited |

Highest memory in this sample: Felicy Hair MySQL. Highest CPU in this sample: Sem Ayiti staging. No inspected container had a restart count above zero or `OOMKilled=true`. The only containers near a configured memory cap are the DG Creator staging containers, and those were under half of their caps. No OOM lines were present in the kernel ring buffer at inspection time. Existing monitoring beyond this sample was not installed for Nabitouch, so spikes between samples are **NOT VERIFIED**.

### Staging budget

| Component | Initial cap |
|---|---:|
| Nabitouch API | 512 MiB |
| MongoDB | 512 MiB |
| Redis | 128 MiB |
| **Subtotal** | **1,152 MiB** |

Available memory at this snapshot was about 3.6 GiB. The 1,152 MiB subtotal fits inside that figure with roughly 2.5 GiB left if the current working set stays flat. That remainder still has to cover filesystem cache, Nginx, the static frontend, and every other application on the host.

ClamAV is a separate 768 MiB cap and is not in the default Compose start. Adding it on this host would consume most of the remaining headroom. Leave it off until available memory stays at or above about 1.5 GiB after the API, MongoDB, and Redis are running.

Unused RAM in one sample is not reserved capacity. Most resident containers have no memory limit, and there is no swap. A spike can invoke the OOM killer against any container, including production Nabitouch.

A dedicated VPS is preferable for the production replacement. Coexistence on this host is acceptable only as a temporary staging arrangement, with ClamAV off and with a stop rule if available memory falls under about 1.5 GiB.

## C. Docker inventory

Thirteen Compose projects were running. Twenty-nine containers were up. The proposed project `nt-next` is not among them.

Production Nabitouch, Compose project `nabitouch-rmt`:

| Container | Status | Published port | Restarts | Memory cap |
|---|---|---|---:|---|
| nabitouch_frontend | Up 9 days, healthy | `127.0.0.1:8080` | 0 | none |
| nabitouch_backend | Up 9 days, healthy | unpublished `8001` | 0 | none |
| nabitouch_mongo | Up 5 months, healthy | unpublished `27017` | 0 | none |

Restart policy on these three is `unless-stopped`. Network `nabitouch-rmt_nabitouch_network` is present. Volumes `nabitouch-rmt_mongo_data` and `nabitouch-rmt_uploads` are present. Their contents were not opened.

Other residents, unchanged in role from the earlier inventory: DG Academy, DG Creator staging, DG Solutions, Felicy Hair, Jacques Tauto, Kwalitee, Sem Ayiti production and staging, and the older localhost-only `nabitu` stack (`127.0.0.1:3002`, `127.0.0.1:3102`, `127.0.0.1:27018`). Additional localhost sites `lasous`, `soundclash`, and `ask` are also running.

`nt-next`, `nt-next-mongo`, and `nt-next-redis-certs` are absent. `/etc/nabitouch-next.env` is absent. `/var/www/nabitouch-next` is absent.

### Port conflicts

`127.0.0.1:8011` is not listening. It remains available for the staging API.

Still occupied, and still excluded from the staging plan:

| Listener | Occupant |
|---|---|
| `127.0.0.1:8080` | production Nabitouch frontend |
| `127.0.0.1:3011` | Sem Ayiti staging |
| `127.0.0.1:3000`–`3007`, `3010`, `3012`, `3021` | other applications |
| `*:3020` | a host process, not a Docker-published Nabitouch port |
| `127.0.0.1:27018` | older `nabitu` MongoDB |
| `127.0.0.1:3102` | older `nabitu` API |

The staging Compose file publishes `127.0.0.1:8011:8000` and states that this port is the API only. It does not publish a frontend. The inactive Nginx sketch, which is not installed, would listen on `127.0.0.1:8081` and proxy `/api/` to `127.0.0.1:8011`.

## D. Nabitouch production routing

Public domain: `nabitouch.com` and `www.nabitouch.com`.

Observed host Nginx behavior:

- Port 80 for both names returns `301` to `https://$host$request_uri`. A request to `http://nabitouch.com/` followed that redirect toward `https://nabitouch.com/`.
- Port 443 for both names uses `/etc/letsencrypt/live/nabitouch.com/fullchain.pem`.
- The only HTTPS location is `/`, proxied to `http://127.0.0.1:8080`.
- `/api/` and `/uploads/` are not separate host upstreams. They travel through the same frontend listener.
- WebSocket upgrade headers are set on that location.
- `proxy_read_timeout` is 90 seconds.
- `client_max_body_size` is 25m.
- `www` is not redirected to the apex. Both names serve the same upstream. `https://www.nabitouch.com/` returned HTTP 200.

Public checks from the VPS, read-only:

| Request | Result |
|---|---|
| `https://nabitouch.com/` | HTTP 200 |
| `https://nabitouch.com/api/health` | `{"status":"ok","db":"up", ...}` |
| `https://www.nabitouch.com/` | HTTP 200 |
| `http://nabitouch.com/` | HTTP 301 to HTTPS |

An HTTP 200 and a database-up health body show that the homepage and the health route answered. They do not prove booking, mail, payments, or uploads.

### TLS

| Field | Value |
|---|---|
| Subject | `CN=nabitouch.com` |
| SAN | `nabitouch.com`, `www.nabitouch.com` |
| Issuer | Let's Encrypt, `CN=YE1` |
| Not before | 21 August 2026, 01:51:43 GMT |
| Not after | 19 November 2026, 01:51:42 GMT |
| Renewal timer | `certbot.timer` enabled and active |
| Next timer run | 13 October 2026, 09:44 UTC |
| Last timer run | 12 October 2026, 16:09 UTC |
| Last `certbot.service` result | success, exit status 0 |
| Authenticator | nginx |

The certificate has about 37 days of life. The renewal timer is healthy. This inspection did not read renewal-log text and did not run Certbot. A successful timer run today does not by itself prove the November renewal will succeed.

## E. Backup discovery

No Nabitouch archive, cron job, or dump directory was found. Backup file contents were not opened.

| Requirement | Classification | Evidence |
|---|---|---|
| Nabitouch MongoDB backup job | Not found | No Nabitouch entry in `cron.d` or root crontab. No Nabitouch dump under `/opt/backups`, `/root/backups`, or `/var/backups`. |
| Uploads backup job | Not found | Volume `nabitouch-rmt_uploads` exists. No matching archive job was identified. |
| Backup destination for Nabitouch | Not found | No off-server destination is recorded on the host. |
| Retention policy on the host | Not found | The repository documents a 2555-day hint for insurance uploads. That policy is not an observed host job. |
| Hostinger snapshot | Requires separate authorization | Not visible over SSH. Creating or listing a snapshot in the panel was not attempted. |
| Restore procedure | Documented, not exercised on this host | `docs/BACKUP_RESTORE.md` describes `mongodump` and a restore into a new database name. |
| Previous restore drill | Verified only for a disposable local database | `docs/PRODUCTION_ARCHITECTURE.md` records a 12 October 2026 drill of a disposable database, 521 documents, then dropped. That drill did not use this VPS or the live `nabi_touch` data. |

Other applications on this host have dated local dumps and configuration copies. Those files were not read. Their presence does not cover Nabitouch.

A scheduled job was not found, so there is no job whose success could be mistaken for a backup. Absence of a job is not proof that a panel snapshot exists.

### Proposed Stage B procedure (not executed)

1. Owner authorizes this procedure in a separate instruction.
2. Confirm a Hostinger snapshot in the panel and record its identifier and retention. Do not treat the snapshot as a database restore drill.
3. Identify the production database name from deployment metadata. Do not print credentials.
4. Run `mongodump` of that database only, gzip-compressed, to a path outside the container. Copy the archive off the VPS. Do not open documents.
5. Copy the uploads volume as an opaque archive. Do not open files.
6. Keep any field-encryption key, if one exists for a future import, in a separate store from the archive.
7. Restore the archive into a new database name on a disposable target. Compare collection counts only. Drop the drill database.
8. Do not restore over the live database, and do not import the archive into `nt-next`.

## F. Staging configuration assessment

Files reviewed locally and not started: `deploy/docker-compose.hostinger.yml`, `deploy/nginx.staging.not-active.conf`, `docs/HOSTINGER_REPLACEMENT.md`, `docs/PRODUCTION_ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`.

| Control | Observed in the Compose file | Gap |
|---|---|---|
| Project isolation | Project name `nt-next` | Not created on the host. Correct for this stage. |
| Network isolation | Network `nt-next` only | Does not attach to `nabitouch-rmt_nabitouch_network`. |
| Volume separation | `nt-next-mongo`, `nt-next-redis-certs` | Absent on the host. Do not reuse production volumes. |
| Published ports | API only, `127.0.0.1:8011:8000` | Port was free. Frontend is not a container. |
| MongoDB | `--replSet rs0`, `--auth`, WiredTiger cache 0.25 GiB, no host port | One container is a single-node set, not the primary-plus-secondary layout in `docs/PRODUCTION_ARCHITECTURE.md`. User bootstrap and replica initiation are not in the Compose file. |
| Redis | TLS only, password required, no host port | Password and certificate files must exist before a start. The cert volume is not created by Compose. |
| Notification outbox | Application stores booking mail in MongoDB | No extra container. Persistence depends on the staging MongoDB volume. |
| Secrets | `env_file: /etc/nabitouch-next.env` | That file is absent. Do not create it in this stage. |
| Health checks | API checks `GET /api/health` | MongoDB and Redis have no health check. `depends_on` waits for start, not health. |
| Restart | `unless-stopped` | Appropriate once a start is authorized. |
| Memory caps | 512 / 512 / 128 MiB | Present. Frontend, proxy, and page cache are outside those caps. |
| Log rotation | json-file, 10 MiB, 3 files | Present. |
| Malware scanning | ClamAV profile `scan`, 768 MiB | Off unless that profile is requested. Leave it off on this host. |
| Reverse proxy | `deploy/nginx.staging.not-active.conf` is fully commented | Not installed. It omits body-size, WebSocket, and timeout directives that production has. Do not copy it into `sites-enabled` until those are filled in under a separate change. |

`deploy/docker-compose.example.yml` still binds public 80 and 443. Do not start it on this VPS.

## G. Security observations

| Observation | Severity | Evidence |
|---|---|---|
| Public listeners are 22, 80, and 443 | Informational | `ss` plus UFW allow list. Default incoming policy is deny. |
| MongoDB and Redis for Nabitouch are not published on the host | Informational | `nabitouch_mongo` and the production stack have no host Redis. Staging Redis and MongoDB also have no `ports:` entries. |
| Older `nabitu` MongoDB is on localhost `27018` only | Low | Not reachable from UFW's public allow list. Leave it untouched. |
| `*:3020` listens on all interfaces | Low | UFW does not allow that port. It is not a Nabitouch service. |
| TLS expires 19 November 2026 | Moderate | Certificate metadata. Timer is active. Renewal success in November is still future work. |
| No swap and no memory caps on production Nabitouch | High | `free` and `docker inspect`. A neighbor can exhaust RAM. |
| Staging secrets file is absent | Informational | Expected. Creating it is a later authorized step. |
| Other applications keep local backup copies of environment files | Moderate | Filenames and sizes only. Contents were not read. Those copies are outside Nabitouch and were not rotated in this task. |

Unattended upgrades are active. SSH configuration was not changed and was not printed. No external vulnerability scan was run.

## H. Risk register

| Risk | Severity | Evidence | Impact | Mitigation | Needs authorization |
|---|---|---|---|---|---|
| Shared VPS memory exhaustion | High | 7.8 GiB, 3.6 GiB available, most containers uncapped, no swap | OOM can stop production Nabitouch or another site | Keep staging at the 1,152 MiB caps, keep ClamAV off, stop staging if available memory falls under about 1.5 GiB. Prefer a dedicated VPS for cutover. | Yes, before any start |
| Single-node MongoDB labeled as a replica set | Moderate | Compose runs one `mongod --replSet rs0` | Transactions can work on one node. There is no secondary if that node dies. | Treat staging as a single-node set. Do not describe it as high availability. | Yes, if a second node is required |
| No swap | High | `Swap: 0B` | The kernel cannot page out pressure. | Do not add swap in this stage. Size the host, or move staging, before relying on it. | Yes |
| Disk growth | Low | 65 GiB free, inode use 9%, container logs capped only in the proposed file | Production containers do not show a log cap in this inspection | Watch `df` before and after any later dump. A dump must go off the server. | Yes, for the dump |
| Backup availability | High | No Nabitouch job or archive | A failed later change has no tested rollback copy | Stage B procedure in section E | Yes |
| Restore readiness | High | Drill evidence is a disposable local database only | A dump that has never been restored is an unverified file | Restore into a new database name and compare counts | Yes |
| TLS expiration | Moderate | Expires 19 November 2026. Timer is active. | The public site fails if renewal fails | Confirm the next successful renewal before cutover. Do not renew from this task. | Only if the timer fails |
| Port collision | Low | `8011` free. `8080`, `3011`, `27018`, `3102`, and `3000`–`3021` busy | A wrong bind would hit another application | Keep the API on `127.0.0.1:8011` only | No, while the port stays free |
| Nginx routing conflict | Low | Live site is one proxy to `127.0.0.1:8080`. Staging sketch is not installed. | Installing the sketch as-is would miss production timeout and body-size settings and would not be a public name | Keep the sketch inactive until a reviewed vhost is approved | Yes |
| Malware scanning | Moderate | 768 MiB profile, host has no spare GiB with margin | Enabling ClamAV can push the host into OOM. Leaving it off keeps uploads in quarantine for the new app. | Do not start the `scan` profile on this VPS | Yes |
| Impact on other DG Solutions applications | High | 13 Compose projects share the host | Staging memory or disk use affects Academy, Sem Ayiti, Felicy Hair, and the others | Caps, loopback-only ports, a separate network, and a stop rule | Yes |
| Failed staging start later | Moderate | `unless-stopped` is in the file. Production uses a different project, port, and network. | A failed `nt-next` start should not change `nabitouch-rmt` if the start stays inside that project | Do not attach to the production network or volume. Roll back by leaving production Nginx on `127.0.0.1:8080`. | Yes, at start time |

Hypothetical items are the OOM outcome, the November renewal failure, and a bad staging start. The missing backup, the missing swap, the shared host, and the certificate date were observed.

## I. Stage B prerequisites

Complete these before any production-data backup or any staging deployment:

1. A separate owner instruction that authorizes Stage B and names the snapshot and the dump destination.
2. A Hostinger snapshot identifier recorded from the panel. SSH cannot see it.
3. A written database name for the dump, confirmed from deployment metadata, with credentials kept out of the report and out of git.
4. An off-server destination for the archive and the uploads archive.
5. A disposable restore target that is not the live database and not the future staging database.
6. Agreement that collection counts are the only comparison, and that documents and uploads stay unread.
7. Agreement that `nt-next` is not started in Stage B.
8. Agreement that ClamAV stays off on this VPS.
9. Agreement that no Nginx, DNS, firewall, TLS, or production environment change is included.
10. A stop rule: if available memory is under about 2 GiB immediately before a dump, postpone the dump.

## J. Final recommendation

**READY WITH CONDITIONS**

Production Nabitouch is up, its containers are healthy, port `127.0.0.1:8011` is free, and the proposed project, network, and volumes do not exist yet. Disk space is sufficient for a later archive if that archive leaves the server. Those facts are enough to consider a controlled backup.

They are not enough to start one. There is no Nabitouch backup, no production restore drill, no swap, and no dedicated headroom for ClamAV. The certificate expires on 19 November 2026 even though renewal is scheduled. Staging secrets, Redis certificates, and MongoDB users are not on the host, which is correct until a later stage and which means a deployment is still blocked.

Stage B stays unauthorized until the owner accepts section I.

## What this stage did not do

- No container, network, or volume was created or removed.
- No Compose command was run on the VPS.
- No Nginx reload, firewall change, or Certbot renewal.
- No database shell, dump, or collection read.
- No upload, log body, or environment file was opened.
- No mail, SMS, or Stripe call.
