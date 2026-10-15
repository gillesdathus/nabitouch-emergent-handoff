# Nabitouch branding

Use the assets and tokens already in the frontend. Do not redraw the emblem, change the wordmark, or invent a new palette.

## Logo

Rendered by `frontend/src/components/brand.jsx`.

| Variant | File | Use |
| --- | --- | --- |
| Lockup | `frontend/public/brand/emblem.png` plus `frontend/public/brand/wordmark.png` | Header and sidebar |
| Emblem | `frontend/public/brand/emblem.png` | Compact mark |
| Full | `frontend/public/brand/logo-full.png` | Marketing footer. Alt text: “Nabitouch Mobile Massage Services — Relax, Recover, Anywhere” |
| Wordmark with tag | `frontend/public/brand/wordmark-tag.png` | Present in the asset folder. The lockup component uses `wordmark.png`, not this file. |

Also present: `frontend/public/brand/icon-192.png`, `frontend/public/brand/icon-512.png`, `frontend/public/favicon.png`.

## Color

Defined in `frontend/src/index.css` and `frontend/tailwind.config.js`.

| Token | Hex | Role |
| --- | --- | --- |
| Navy | `#0B2E8A` | Brand start, ghost-button text |
| Blue | `#1565F0` | Primary action, focus ring |
| Sky | `#18A8F5` | Supporting blue |
| Cyan | `#12C9EF` | Primary gradient end |
| Turquoise | `#14D8C4` | Accent and chart secondary |
| Teal | `#0E9E9A` | Eyebrow labels |
| Green | `#7BC74D` | Gradient tail |
| Lime | `#A8E063` | Rare accent |
| Ink | `#0B1B3F` | Headings |
| Mute | `#4A5A7A` | Secondary text |
| Canvas | `#F5FBFC` | Page background |
| Mint | `#EAFBF6` | Soft surface |
| Ice | `#F2FAFD` | Soft surface |

Brand gradient, used on primary buttons:

`linear-gradient(120deg, #0B2E8A 0%, #1565F0 32%, #12C9EF 62%, #14D8C4 82%, #7BC74D 100%)`

Primary buttons in the app use a shorter slice of that gradient: navy, blue, cyan. See `.nb-btn-primary` in `frontend/src/index.css`.

Surfaces are white cards on the canvas, with sky-tinted borders and a soft navy shadow. Training mode adds an amber banner. That amber is a mode indicator, not a brand color.

## Typography

Loaded in `frontend/index.html` from Google Fonts.

| Role | Family | Weights |
| --- | --- | --- |
| UI | Poppins | 300, 400, 500, 600, 700 |
| Display | Fraunces | 400, 500, 600, including italics |

Tailwind maps `font-sans` to Poppins and `font-display` to Fraunces.

## Components to keep visually compatible

Class names in `frontend/src/index.css`: `nb-card`, `nb-btn-primary`, `nb-btn-ghost`, `nb-btn-dark`, `nb-input`, `nb-chip-on`, `nb-chip-off`, `nb-eyebrow`, `nb-soft`.

Icons are Lucide React components already imported by each screen. Do not replace them with a second icon set unless the integration step maps every control back to a named action.

## Catalogue photography

Stock treatment images live in `frontend/public/img/`. A newly created service must not inherit one of these files. Photo upload is a separate owner action after the draft exists. See `backend/media.py`.

## Voice

The product is mobile massage in Edmonton. Copy should stay specific: Edmonton local time, travel and GST shown separately from the treatment price, cash recorded only when received, insurance described as not connected until an insurer is actually configured.
