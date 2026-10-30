# NabiTouch — Manual Patient Invitation Management

**Date:** 2026-10-30  
**Scope:** Patients → Invitations administration UI + legacy invitation API enrichments  
**Live actions:** None. No real invitation sends, merge, deploy, or production identity changes were performed for this deliverable.

## Summary

Manual invitation management is available in the owner/manager administration interface at **Patients → Invitations** (`/owner/patients/invitations`, legacy path `/owner/legacy` retained).

Invitations reuse the existing legacy invitation engine (`backend/legacy.py`): secure hashed tokens, 72-hour expiry, identity verification before account link, branded email template without clinical PHI, audit events, duplicate/concurrent send safeguards, and the existing claim/onboarding flow. No second invitation engine was added. Import still never auto-sends invitations (`autoSendOnImport: false`).

## Interface

| Capability | Behavior |
|---|---|
| Search / filter | Name, phone, source id, and status filters with pagination |
| Contact display | Email/phone shown to authorized owner/manager staff only |
| Eligibility | Contact completeness, readiness flags, duplicate/linked checks |
| Individual Invite | Opens confirmation with name, destination, channel, template preview; sends only after confirm |
| Batch selection | Checkboxes persist across pages; select all **eligible in current filter**; clear; preview excluded + ready |
| Exact recipient set | Preview/send use the submitted id list only (`autoExpand` / `autoExpanded: false`) |
| History | Open / used / revoked / expired / delivery_error / activated outcomes; revoke outstanding |

## Server controls reused / extended

- `POST /api/legacy/patients/{id}/invite` — individual send/resend  
- `POST /api/legacy/invitations/preview` — enriched recipients, exclusions, template preview (`willSend: false`)  
- `GET /api/legacy/invitations/eligible` — exact eligible ids for current filter  
- `POST /api/legacy/invitations/send` — requires `confirm: true`; returns per-id sent/failed; never expands set  
- `POST /api/legacy/invitations/{id}/revoke` — revokes token; marks patient `invitation_expired` for controlled resend  
- `GET /api/legacy/invitations` — status dashboard without raw tokens  
- Authorization: owner or manager (`has_role`); desk/practitioner remain forbidden  
- Rate limit: 15-minute duplicate send guard per patient  
- Open invites revoked when a new invite is issued for the same patient  

## Security checklist

- [x] Expiring invitation tokens (hashed at rest)  
- [x] Identity verification (last name + DOB) before linking historical records  
- [x] No clinical / insurance / treatment detail in invitation content  
- [x] Invitation management restricted to owner/manager  
- [x] Onboarding invite separated from marketing consent (`marketingConsent: false` in preview)  
- [x] Audit trail: sender, time, recipients/batch, channel, delivery outcome  

## Tests (synthetic recipients only)

| Suite | Coverage |
|---|---|
| `backend/tests/test_legacy_invite.py` | Authorization, preview, expiry, revoke, verify/replay/conflict, batch eligible/exclusions/exact send |
| `frontend/src/pages/owner/LegacyClients.test.jsx` | Individual confirm-before-send, eligible selection, excluded recipients, cancel without send |

## Production readiness

| Gate | Status |
|---|---|
| UI + API implementation | Ready for review |
| Automated tests authored | Ready (run in CI / local Vitest + backend QA) |
| Real invitation sends | **Not authorized / not executed** |
| Merge to main | **Not performed** |
| Hostinger deploy | **Not performed** |
| Production patient invites | **Hold** until explicit send approval |

## Remaining approval items

1. Review UI on a non-production build.  
2. Approve merge/deploy of this invitation-management change set when ready.  
3. Separately authorize any real patient invitation sends (individual or batch).  

Marketing welcome-back / winback invites remain a different product path and are not used for legacy patient onboarding.
