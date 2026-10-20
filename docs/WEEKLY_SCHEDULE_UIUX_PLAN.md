# Practitioner Weekly Schedule — UI/UX Plan

**Status:** Implementation in progress (not production-deployed).  
**Surface:** Practitioner `/pro/availability` (and owner `/owner/availability` in owner mode).  
**Constraint:** Do not merge, deploy, or change production availability without explicit approval.

## Goal

One Schedule workspace where a practitioner configures:

1. **Weekly Hours** — recurring paid working windows  
2. **Campaign Slots** — reserved promotional blocks (starting with “10 Minutes. On Us.”)  
3. **Breaks** — dated breaks inside working time  
4. **Time Off / Exceptions** — vacation, sick, emergency, closed, and intentional open overrides  

Regular hours and promotional blocks share the same conflict calendar. There is no independent promo calendar.

---

## Current baseline (audit)

| Layer | Status |
| --- | --- |
| Engine helpers | Present in `backend/availability.py`: `validate_campaign_blocks`, `open_campaign_covers`, `reserved_by_campaign`, campaign-aware `interval_open` / `feasible_slot` / `candidate_starts` (10-min trial step) |
| Storage | `nt_schedules.campaignBlocks[]` on draft + saved schedules |
| API | `PUT /api/schedules/{id}/campaign-blocks` (atomic replace); `GET` returns schedule including blocks |
| UI | Still being rebuilt into four Schedule sections (was append-only weekly form) |
| Campaign owner controls | `nt_campaigns` / Campaigns UI — live status, Home/Offers visibility, eligibility (independent of pro blocks) |
| Trial inventory | Requires an **open** matching campaign block; empty blocks ⇒ **zero** trial slots (intentional) |
| Conflicts | Closing time / blocks never cancels visits; `keep_appointments` for weekly/exception conflicts |

**Transitional note:** Owner campaign live/visibility can be on while a practitioner has no open campaign blocks. That means the offer may appear publicly with no bookable trial times for that practitioner until they open slots.

---

## Information architecture

```
Schedule
├── Status strip (per dirty section: Saved | Unsaved changes | Saving | Success | Error)
├── Calendar (day / week / month — read-only context; campaign segments when present)
└── Editors (accordion sections; one primary Save per section)
    ├── 1. Weekly Hours
    ├── 2. Campaign Slots
    ├── 3. Breaks
    └── 4. Time Off / Exceptions
```

Owner mode keeps practitioner selector + Approve schedule / Pause. Reception with `manageAvailability` may edit with audit (`can_manage` unchanged).

### Section 1 — Weekly Hours (full redesign)

- Load existing `schedule.weekly` automatically on open; never imply empty merely because the session has not edited.
- Show all seven days with working/off state and saved time ranges.
- Multi-select weekdays and apply the same hours to all selected days.
- Configure different day groups independently (e.g. Mon–Fri 9–5, Sat 10–2, Sun off).
- Edit one day without changing others.
- Multiple time blocks per day (split shifts) when the engine allows; overlap validation on the same weekday.
- Copy hours to selected days.
- One prominent **Save Schedule** action → `PUT /schedules/{id}/weekly` (atomic full replace).
- Save states: Loading · Saved schedule loaded · Unsaved changes · Saving… · Schedule saved successfully · Save failed — retry.
- Last-saved timestamp after confirmed persistence.
- Empty state: “No working hours set yet” with a simple setup action.
- Unsaved-navigation warning (`beforeunload` / in-app guard).
- If schedule is already `approved`, practitioner/receptionist saves keep `approved` and do not clear `acceptingBookings`. Draft/pending onboarding still needs Owner Approve.
- Saving weekly hours must not cancel existing bookings (existing conflict / keep-appointments flow).

### Section 2 — Campaign Slots

**Campaign picker:** only schedulable campaigns the practitioner may serve. Launch default: **“10 Minutes. On Us.”** (`cmp-ten-minutes-on-us` / service `ten-minutes-on-us`).

**Block editor fields:**

| Field | Behavior |
| --- | --- |
| Campaign | Required; currently the trial campaign |
| Weekdays | One or many (for recurring) |
| Start / end | Edmonton wall clock |
| Full day | Uses that day’s applicable weekly hours |
| Recurrence | `recurring` (weekdays), `one_time` (single date), `range` (inclusive date span + optional weekdays) |
| Open / Closed | Toggle per block — closed blocks reject **new** campaign bookings only |
| Actions | Edit, copy, delete; multiple blocks with different hours |
| Save | One action persists the full campaign-block list for that practitioner |

**Save states (required):** Saved · Unsaved changes · Saving · Success · Error.  
On load: hydrate existing saved blocks.

**Outside normal hours:** Allowed only when the practitioner intentionally saves an open campaign block that extends beyond weekly hours. That block authorizes campaign work for that window; it does not open paid regular inventory.

### Section 3 — Breaks

- Prefer `kind: break` exceptions.  
- Closing a break window around existing visits uses the keep-appointments conflict pattern.

### Section 4 — Time Off / Exceptions

- Vacation, sick, emergency, closed, open override.  
- Same conflict / keep-appointments rules as today.

---

## Ownership split (independent controls)

| Actor | Controls |
| --- | --- |
| Owner / Manager | Campaign live/draft, Home & Offers visibility, eligibility & global limits |
| Practitioner | Own weekly hours + campaign blocks: dates, hours, open/closed — **no routine owner approval** once the schedule is approved |
| Reception (authorized) | May edit on behalf of practitioner; every write audited |

Campaign **visibility** (`showHome` / `showOffers` / campaign status) must remain independent of whether a practitioner has open campaign blocks. Empty or closed blocks simply mean no bookable trial inventory for that practitioner.

**Do not** auto-flip Nabitu’s (or any practitioner’s) `available` / `bookable` / onboarding flags when campaign blocks or weekly hours are saved.

---

## Data model

Store campaign blocks on the existing schedule document (same practitioner conflict calendar):

```json
{
  "campaignBlocks": [
    {
      "id": "cb-…",
      "campaignId": "cmp-ten-minutes-on-us",
      "practitionerId": "p-…",
      "timezone": "America/Edmonton",
      "open": true,
      "mode": "recurring | one_time | range",
      "weekdays": [1, 3],
      "startDate": null,
      "endDate": null,
      "start": "13:00",
      "end": "15:00",
      "fullDay": false
    }
  ]
}
```

Validation:

- `end` after `start` when not full-day.  
- Weekdays 0–6 when mode needs them.  
- Date fields required for `one_time` / `range`.  
- Known `campaignId` (trial for launch).  
- No overlapping open blocks for the same campaign on the same weekday/time.

API:

- `GET /api/schedules/{id}` — include `campaignBlocks`.  
- `PUT /api/schedules/{id}/campaign-blocks` — replace list in one write; audit log; does not require owner re-approval.  
- Reuse auth via `can_manage` (owner, self, desk with `manageAvailability`).

---

## Booking engine rules

Reuse `feasible_slot`, travel buffers, overlaps, locks, and service-area checks. Extend hour resolution — do **not** invent a second calendar.

| Request type | Time must sit in | Excluded from |
| --- | --- | --- |
| Regular paid | Weekly hours or open override; **not** reserved by an open campaign block | Open campaign blocks, breaks, leave, conflicts |
| Campaign / trial | An **open** matching campaign block (full-day expands to weekly hours for that day, or the block’s explicit times including intentional outside-hours) | Closed campaign blocks, breaks, leave, any overlapping appointment |

Shared rules:

- Same practitioner conflict calendar; no double booking.  
- Respect travel, setup, cleanup, and scheduling buffers.  
- Trial step size **10 minutes** inside campaign blocks; never invent more 10-minute slots than the real open campaign window allows.  
- Closing a campaign block: reject **new** campaign bookings; **never** silently cancel confirmed appointments.  
- Campaign still requires eligible mobile (or allowed) location inside the service area and live owner campaign eligibility — scheduling open ≠ campaign live.  
- Client When step must pass `campaignId` into recommendations.

---

## Progressive implementation order

1. Plan doc (this file) — refresh baseline + Weekly Hours UX + transitional inventory  
2. Backend: overlap validation, approval-policy fix for approved schedules, API polish  
3. Booking wiring: pass `campaignId` from StepWhen  
4. UI: Weekly Hours editor  
5. UI: Campaign Slots editor  
6. UI: Breaks + Time Off sections  
7. Tests for the 12 acceptance scenarios  
8. **Stop** for explicit approval before merge/deploy/production schedule changes  

---

## Acceptance tests

1. Reserve Saturday 10:00–14:00 for the trial.  
2. Reserve Tuesday and Thursday 13:00–15:00 in one save.  
3. Add a one-time campaign block.  
4. Open and close a campaign block.  
5. Regular bookings cannot consume reserved open campaign slots.  
6. Campaign bookings cannot consume regular-only slots.  
7. Travel buffers and no double booking.  
8. Eligible mobile home address works.  
9. Existing confirmed appointments unchanged when a block closes.  
10. Save confirmation and persistence after refresh.  
11. Dual owner/practitioner account behavior (owner campaign controls vs practitioner blocks).  
12. Campaign visibility and campaign scheduling remain independent.

Weekly Hours subset: load existing; empty state; multi-day apply; Saturday different; Sunday off; edit one day; atomic save; success only after backend; refresh persist; failure keeps edits; unsaved warning; appointments intact; dual-role; mobile layout.

---

## Out of scope (this phase)

- Merging or deploying to production.  
- Auto-activating the trial campaign or changing Nabitu booking eligibility flags.  
- Outbound promotional messaging.  
- A separate promotional calendar product.  
- Automatic cancellation of appointments when blocks close.
