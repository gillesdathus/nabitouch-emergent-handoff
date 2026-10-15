# Configuration change manifest

Nothing in this file has been written to `nabitouch_prod` or to the private API database. The functions below are the prepared source. Applying them requires a separate owner authorization, a backup, and an audit entry naming the owner.

## Welcome offer

Source: `launch_welcome_offer()` in `backend/pricing.py`.

| Field | Prepared value |
| --- | --- |
| id | `promo-welcome` |
| code | `WELCOME20` |
| name | First-booking welcome offer |
| type | percent |
| value | 20 |
| maxDiscount | 40 |
| eligibility | `first_online` |
| start / end | none |
| stackable | false |
| redemptionLimit | none |
| enabled | true |
| approval | `approved` |
| appliesTo | treatment |

Preconditions: the offer document is still absent from production. Identity claims use client id, normalized email, and the last 10 phone digits. A quote does not reserve the offer. A losing concurrent claim rolls back its own keys and is repriced without the discount.

Rollback: disable `promo-welcome` and leave existing `nt_welcome_claims` rows in place so a person who already received the offer cannot receive it again. Do not delete historical invoices.

Local evidence, not a production insert: guest booking `NT-2033` stored base 120, discount 24, tax 4.8, total 100.8. The same phone and email on `NT-2034` stored discount 0, tax 6, total 126.

## Cancellation policy

Source: `CANCELLATION_DRAFT` and `launch_policy()`.

Text:

> We understand that plans can change. If you need to cancel or reschedule your massage appointment, please contact Nabitouch as soon as possible. We currently do not charge an automatic cancellation fee.

`launch_policy()` keeps `status` at `pending` and `automaticFee` false. `launch_readiness()` does not treat the policy as published until status is `approved`. Do not set that status in this change. Automatic cancellation fees, no-show fees, and automatic collection stay disabled.

Rollback: set the policy status back to `pending`. Do not invent a fee.

## Business settings

Source: `launch_clinic()` and the launch seed.

| Field | Prepared value |
| --- | --- |
| name | Nabitouch |
| phone | +1 780-235-6508 |
| phoneDisplay | (780) 235-6508 |
| phoneTel | +17802356508 |
| email | info@nabitouch.com |
| hours | By appointment only |
| mobileEnabled | true |
| clinic.enabled | false |
| clinic.address | empty |
| GST | 5 percent, already used by the quote |
| cash payments | enabled |

Keep the three existing zones (Central Edmonton, inner ring, outer ring) and the ten-service catalogue. The local contact page hides the phone and email until `clinic.phoneTel` and `clinic.email` are stored, and it hides a clinic street while the address is empty. That is the current preview behaviour, not a production write.

Rollback: restore the previous clinic document from the backup. Do not publish a street address as part of this change.

## Scheduling buffers

Launch seed values, for owner confirmation before they are written:

| Buffer | Minutes |
| --- | ---: |
| Setup | 10 |
| Cleanup | 15 |
| Travel buffer | 10 |
| Minimum lead time | 90 |

`enforceAdjacentTravel` is true in the launch seed. Do not change production hours in this manifest.

## Practitioner onboarding — Nabitu Kahindo

`launch_practitioner()` is a draft: id `p-nabitu-kahindo`, available false, bookable false, specialties empty, onboarding draft. The preview database has 0 documents with that id. Do not create or activate the production practitioner.

Still required from the owner, and not invented here:

- A practitioner login email that is not `info@nabitouch.com` and not an example domain
- Professional registration identifier and expiry date
- Liability insurance policy identifier and expiry date
- Approved services
- Weekly availability
- Practitioner MFA enrollment
- A separate owner activation approval

`onboarding_gaps()` reports those items as pending until real values exist. Placeholder words such as "pending" and "test" are rejected.

## Features that stay off

Rewards, referrals, and NabiDerm stay disabled in `launch_rewards()`. Promotional email campaigns, recovery email, automatic cancellation and no-show fees, automatic collection, clinic booking, card checkout, and clinical document uploads stay off for launch. `WELCOME20` is a checkout rule, not a promotional email campaign.

The local preview process enables document uploads and card checkout so the existing suite can run. That environment is not a template for production.
