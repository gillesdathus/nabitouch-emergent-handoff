# Installed PWA address & booking checklist (Slice 5)

**Status:** Outstanding — not executed on physical/remote devices in this Slice 5 run.

Use this checklist on Android and iOS **installed** PWAs (not desktop responsive mode alone).

## Environments
- [ ] Android Chrome → Install app → open standalone
- [ ] iOS Safari → Add to Home Screen → open standalone
- [ ] Mobile Chrome (tab, not installed)
- [ ] iOS Safari (tab, not installed)

## Address flow (after selecting a service → Mobile)
1. [ ] Street field focuses; software keyboard opens
2. [ ] Typing retains characters (no bounce-clear)
3. [ ] Suggestions appear and are tappable above sticky Continue
4. [ ] Selecting a suggestion hides the full search form
5. [ ] Confirmation card shows street + locality
6. [ ] Suite / apartment optional
7. [ ] Buzzer / access optional
8. [ ] Confirm & Continue enables booking Continue
9. [ ] Change address restores search
10. [ ] Use My Location → grant → card appears
11. [ ] Use My Location → deny → recoverable error, search remains
12. [ ] Keyboard does not cover Confirm / Continue
13. [ ] Sticky actions clear the bottom dock + home indicator

## Booking navigation
14. [ ] Service → Duration auto-advance
15. [ ] Duration → When auto-advance
16. [ ] System Back unwinds steps without leaving `/book` early
17. [ ] Clinic path skips home address entry

Do not mark the installed-PWA defect resolved until items 1–13 pass on both platforms.
