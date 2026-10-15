# Design requirements

Lovable redesigns presentation. The integrated result must call the existing API and keep the business rules below.

## Experience

Mobile first. Layouts at 375, 390, 430, 768, 1024, and desktop must be designed for that width. Desktop can add columns. Mobile must not be a scaled desktop page.

Use the Nabitouch brand in `BRANDING.md`: light canvas, white cards, blue-to-cyan primary actions, turquoise accents, Poppins for UI, Fraunces only for short display lines.

Persistent patterns:

- One obvious create action per management list. The form stays closed until that action.
- Bottom navigation on phones for the primary workspace. Contextual actions in a bottom sheet on mobile and a drawer on desktop.
- Status, payment, and empty states use the same components everywhere.
- Loading uses skeletons. Success toasts happen only after the API confirms the write.

## Screens to cover

### Dashboard

Personalized greeting, date, business status, notification entry, and one quick-action control. KPI cards for today’s visits, booked value, collected payments, outstanding balances, upcoming visits, and SOAP completion only when completed sessions exist. Each card opens the matching filtered work. Upcoming visits show client, service, practitioner, time, appointment status, payment status, and mobile address, with only the actions that role may perform.

### Schedule

Day, week, and month on a time grid. Mobile uses a horizontal day selector and a vertical timeline. Show available time, bookings, breaks, blocked time, and time off when the schedule API returns them. Selecting an empty block offers create booking or block time. Selecting a visit opens the appointment detail. Availability editing is a short guided flow, not a permanently open form.

### Profiles

One client profile and one practitioner profile, opened from search, appointments, and management. Client sections: overview, appointments, invoices, payments, and clinical only for an authorized role. Practitioner sections: overview, schedule, credentials, documents, reports, and account. Practitioners never see an approve control for their own credentials.

### Operations

Services, campaigns, promotions, rewards, zones, and settings share one list-then-action pattern. Travel fees stay on the zone record. Cancellation policy stays with business settings, not inside campaign creation.

### Navigation

Owner: Dashboard, Schedule, Manage, Invoices. Manage contains the other catalogues. Practitioner and reception keep their real tasks reachable with one hand. Public booking keeps Home, Services, Book, and My Nabitouch.

## Business rules that the visual design cannot relax

- In-clinic is hidden on the public booking steps while clinic booking is disabled. The API rejects it.
- Treatment notes do not change the purchased service or price.
- Cash is unpaid until it is recorded. A booking is not prepaid because cash was chosen.
- Deposits and totals come from the server quote. The UI must not invent a second price.
- Promotional messages are not sent while promotional sending is off. A live campaign can still be booked in the app.
- New services start unpublished and without a stock photo.
- A practitioner is not publicly bookable until credentials, account, services, and schedule are valid.
- Reports are drafts until approved and published. A PDF is not a payroll or tax filing.
- Gift cards cannot be issued from the owner UI. Rewards earning stays off until the owner authorizes it.
- Address autocomplete without a Mapbox token shows the configuration error. Do not offer sample addresses as search results.
- A calculated route is not live practitioner tracking.

## Responsive behavior

| Width | Expectation |
| --- | --- |
| 375–430 | Single column, bottom nav, full-screen create sheets, no sideways scrolling of forms |
| 768 | Two columns where a list and a detail can sit together |
| 1024 and desktop | Sidebar for staff, drawers for detail, calendar week grid |

Touch targets stay at least 44px. Focus states stay visible. The amber training banner, when shown, must remain readable at every width.
