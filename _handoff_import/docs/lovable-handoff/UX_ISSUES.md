# UX issues for the redesign

These are the problems Lovable should solve. The current React screens remain the functional reference until a design is integrated back into this repository.

Reference compositions already used for the product direction:

- A light operational dashboard with KPI cards, today’s appointments, and a chart
- An interactive day/week/month schedule with appointment blocks and a detail card
- A mobile profile with a header, segmented appointments, and bottom navigation

Sample names, prices, and dates in those compositions are not Nabitouch records. Do not copy them into the product.

## Layout

- Several staff screens were composed for a wide page and then squeezed. Reception still lays practitioners out as side-by-side columns (`frontend/src/pages/reception/Desk.jsx`).
- The owner availability page still stacks a chip summary under the time grid, so the same day is explained twice (`frontend/src/pages/practitioner/Availability.jsx`).
- Large empty regions appear around single cards, especially on the training sign-in and some owner forms, instead of a dense mobile stack.
- Target widths are 375, 390, 430, 768, 1024, and desktop. Shrinking the desktop grid is not the mobile design.

## Actions

Create is inconsistent.

- Flash campaigns, services, promotions, and practitioner invite open from a button.
- Reception permissions still show a staff-account form immediately (`frontend/src/pages/owner/Permissions.jsx`).
- Rewards opens directly into threshold fields (`frontend/src/pages/owner/RewardsAdmin.jsx`).
- Availability editing is inside a disclosure, which is closer to the desired pattern, but the weekly form is still a long grid once opened.

Primary buttons, ghost buttons, and text links are mixed for the same kind of action. Cards, eyebrows, and spacing follow `nb-*` classes on some pages and ad-hoc Tailwind on others.

## Navigation

Owner primary navigation is Overview, Schedule, Manage, and Invoices (`frontend/src/components/shells.jsx`). Older tools remain as routes: dispatch, campaigns, zones, credentials, legacy import, recovery. Manage links to many of them as cards, but the information architecture is still split between the sidebar and in-page links.

Practitioner navigation has six bottom items (Today, Profile, Route, Recovery, Hours, Plans). On a phone they scroll horizontally.

Public navigation is Home, Services, Book, and My Nabitouch, with Practitioners and Contact in a secondary row on small screens.

## Dashboard and schedule

The owner dashboard reads real appointment totals and can open a visit or a client profile. Chart segments do not yet open a filtered record list. Quick actions still navigate to other pages for invoices, availability, and promotions.

The schedule time grid is real. Dispatch, driving routes, and availability approval are separate pages. Mobile dispatch is not a purpose-built sheet; it reuses the owner dispatch view.

## Profiles

Client and practitioner profiles open as sheets from Manage and from an appointment. They are not yet a single destination linked from search, desk, and the public practitioner page. Documents and clinical sections are only as complete as the backing APIs. Client invoices in the sheet are visit pricing rows, not a full invoice ledger.

## Data honesty

Empty states must stay empty. SOAP completion is withheld when no session has ended. Mapbox address search returns a configuration error when the token is missing. Card checkout stays disabled when Stripe is not configured. Insurance stays “not connected.” Gift cards and rewards stay inactive until their commercial rules are turned on.

A redesign must not fill these gaps with sample numbers.
