# Asset manifest

Paths are relative to the repository root. Reuse these files. Do not regenerate the logo.

## Brand

| Path | Role |
| --- | --- |
| `frontend/public/brand/emblem.png` | Emblem |
| `frontend/public/brand/wordmark.png` | Wordmark used in the header lockup |
| `frontend/public/brand/wordmark-tag.png` | Wordmark with tag line |
| `frontend/public/brand/logo-full.png` | Full logo used in the marketing footer |
| `frontend/public/brand/icon-192.png` | App icon |
| `frontend/public/brand/icon-512.png` | App icon |
| `frontend/public/favicon.png` | Browser icon |
| `frontend/public/manifest.json` | Web app manifest |
| `frontend/src/components/brand.jsx` | Logo component |

## Design tokens

| Path | Role |
| --- | --- |
| `frontend/src/index.css` | CSS variables, buttons, cards, inputs |
| `frontend/tailwind.config.js` | `nb` color names and font families |
| `frontend/index.html` | Poppins and Fraunces stylesheet links |

## Catalogue images

These are treatment photographs, not client photos.

`frontend/public/img/hero.jpg`, `deep.jpg`, `foot.jpg`, `hand.jpg`, `hotstone.jpg`, `leg.jpg`, `mobile.jpg`, `prenatal.jpg`, `scalp.jpg`, `senior.jpg`, `sports.jpg`, `stones.jpg`, `swedish.jpg`.

## UI building blocks

| Path | Role |
| --- | --- |
| `frontend/src/components/ui-kit.jsx` | Cards, avatars, status pills, section headings |
| `frontend/src/components/ui/` | Radix-based dialog, sheet, tabs, switch |
| `frontend/src/components/shells.jsx` | Public shell and staff sidebar / bottom nav |
| `frontend/src/components/ops/VisualCalendar.jsx` | Day, week, and month time grid |
| `frontend/src/components/ops/Profiles.jsx` | Client and practitioner profile sheets |
| `frontend/src/components/AppointmentSheet.jsx` | Appointment detail |
| `frontend/src/components/NewBookingDialog.jsx` | Staff booking dialog |
| `frontend/src/lib/domain.js` | Money, dates, booking quote helper, reception permission labels |
| `frontend/src/lib/api.js` | HTTP client |

## Not for Lovable

Do not import environment files, credential scripts, database dumps, or clinical document storage. Uploaded media is served by `GET /api/media/{media_id}` and is not a static asset in this folder.
