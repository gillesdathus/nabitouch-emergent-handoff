# Firebase Android physical-device acceptance — prepared, not executed

Apple/iOS remains deferred. This plan changes no Firebase project, signing key,
device installation, notification setting, VPS or DNS. Push stays disabled/dry-run.
Resend acceptance does not grant permission for a push message.

## Required owner inputs and authorization

- Identify one physical Android phone, OS version and owner-approved tester.
  Provide USB debugging/installation access and a non-store test build workflow.
  Record a redacted device identity; do not commit full device tokens or serials.
- Confirm a dedicated staging Firebase project. Existing Capacitor/Gradle app ID
  is **com.nabitouch.practitioner**; the native client configuration must match.
  Do not assume a staging variant is already registered or that production
  credentials can be reused. Current code targets SDK 35 with minimum SDK 23;
  verify the actual device/build tooling before installation.
- Supply the correct staging google-services.json securely to the Git-ignored
  Android build location. Select the approved debug/test signing identity and
  required public certificate fingerprints. Keep keystores/passwords outside Git;
  do not publish a store build or change production signing.
- Provision server FIREBASE_PROJECT_ID and a least-privilege service-account file
  outside the code folder, with owner-only permissions and a secure read-only
  mount. Existing credential validation checks project identity and permissions.
  Never bundle a service-account private key into the Android/web build.
- Provide an isolated HTTPS test backend reachable by the phone and synthetic
  practitioner/client logins with MFA where required. Local loopback on the
  development PC is not the phone's backend. Review native CORS/origin entries;
  do not disable HTTPS checks or use production patient accounts.
- Explicitly approve installation, test-device registration and the exact
  device-only test notification before any real push. Keep PUSH_ENABLED=false and
  PUSH_DRY_RUN=true until that separately authorized step.

## Execute later and record actual evidence

1. Record candidate SHA, build/APK hash, app ID, signing fingerprint, Firebase
   project and physical OS version. Confirm the APK contains only public client
   configuration, not server secrets. Verify test backend health and isolation.
2. Test login/MFA, secure token storage, refresh rotation and logout. Confirm that
   a client cannot register a device as another practitioner or read another visit.
3. Grant and deny notification permission on the phone. Verify registration,
   refresh/re-registration, app resume and invalid-token cleanup. Store tokens
   only in the protected backend; use hashes/redacted suffixes in evidence.
4. Use Firebase dry-run first. After exact device/message approval, deliver one
   minimal notification solely to that device. Confirm foreground, background,
   locked-screen and tap/deep-link behavior with no clinical content displayed.
   Distinguish API acceptance from actual phone receipt; emulator/mock evidence
   does not certify a physical device.
5. Verify logout/device removal prevents later delivery. Test reconnect/offline
   handling, invalid token and permission revocation without messaging customers.
6. Test trip sharing with an authorized synthetic appointment: foreground and
   locked-screen/background GPS, permission denial, stale fixes, reconnection,
   stop/expiry and role access. Do not capture a tester's unrelated location history.
7. Physically open supported Google Maps/Waze navigation with the synthetic public
   destination, then verify return to Nabitouch. A generated URL or desktop page
   is not physical navigation acceptance. Apple Maps/iOS are outside this phase.
8. Record each case PASS/FAIL/BLOCKED, redacted provider/device evidence and any
   battery/OS restrictions actually observed. Turn off the acceptance-only delivery
   switch, unregister test tokens and retain only the approved minimal evidence.

Do not change the VPS, publish the app, enable automatic customer push or claim
Android acceptance complete until the real phone cases pass. Existing security,
staging recovery and Stripe-native redelivery gates remain independent.
