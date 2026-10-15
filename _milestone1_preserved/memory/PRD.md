# Nabitouch-Mobile — Frontend Preview PRD

## Original problem statement (summary of user's words)
Senior UI/UX + frontend proposal for Nabitouch-Mobile (premium mobile massage booking & practice management). Read GitHub handoff docs (gillesdathus/Nabitouch-Mobile, branch feature/frontend-vite-security-migration, docs/lovable-handoff), present design, implement only after "PROCEED". Frontend only — no backend/auth/payments/deploy/repo changes. Attribution: "Designed & Developed by DG Solutions." Testing only after the user says "START TESTING".

## Architecture
- Standalone CRA React preview in /app/frontend with fictional mock data (src/mock/data.js) and PreviewStore (local state).
- Mapbox GL (mapbox-gl 3.33.0) via REACT_APP_MAPBOX_TOKEN (public pk. token, added).
- Roles: client/public, owner, practitioner (pro), reception (desk), training workspace.

## Implemented
- Initial "Tide" design preview (all roles) — tested in earlier iteration.
- Icon-only mobile dock, HandHeart services icon, updated brand logos.
- Mapbox MapView, fleet/dispatch, client tracking, Start Trip + navigation handoff, native nav preview, service zones editor, client intake, practitioner gallery (UNTESTED).
- 2026: Mapbox token configured; Trip alerts (started / running late / arrived) with visit alert history — components/TripAlerts.jsx, store api.tripEvent, seeded db.tripEvents; shown in pro Visit (Late sheet with delay, reason, message preview, SMS toggle), client Track (latest alert banner + history) and AppointmentSheet history. Alerts are preview-only, NOT SENT (UNTESTED).

## Backlog
- P0: Run testing when the user says START TESTING.
- P1: Notifications inbox integration for trip alerts; owner-level alert settings.
