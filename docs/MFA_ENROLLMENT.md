# Staff authenticator enrollment

## Production owner bootstrap

Do this only after an approved deployment has created the fresh database. Configuration preparation does not create the account.

1. Generate `OWNER_PASSWORD` on the server and store it in `/etc/nabitouch-next.env` with mode `600`. Do not put that password in git or in a chat log. It is bootstrap-only: after the owner changes or resets the live password, leave the env value alone and do not sync the current password into the file.
2. The first API start creates one owner for `OWNER_EMAIL=info@nabitouch.com` when that address is absent. The display name is Nabitouch Owner. Enforcement stays off. The isolated production account already exists and keeps its original id, role, and password when the login email changes.
3. Sign in with that bootstrap password over HTTPS (or the current live password if it already differs).
4. Enroll TOTP with the steps below. Write the eight recovery codes on paper or into a password manager that is not on the VPS. The application shows them once.
5. Sign out and sign in again. Confirm the password step returns a challenge and that one recovery code works a single time.
6. From that authenticator session, turn on **Require authenticator for staff**.

Do not turn enforcement on before the recovery code has been used successfully once and stored off the server.

## Private enrollment session

The public site remains the current application. The owner completes enrollment on a loopback page that is not published.

1. From the owner’s computer, forward local port 8443 to the server’s loopback port 8443.
2. Open `https://127.0.0.1:8443/`. The certificate is a private loopback certificate, so the browser warning is expected.
3. Sign in as `info@nabitouch.com` with the existing owner password.
4. Choose **Set up authenticator**. Store the secret and the eight recovery codes off the server. They are shown once.
5. Enter a current six-digit code. Sign out, sign in again, and enter a current code. A recovery code works once and is then rejected.
6. Leave **Require authenticator for staff** off until that second sign-in succeeds.

## Enrollment steps

Privileged roles are the owner, practitioners, and reception. Enforcement is the database setting `mfaEnforcePrivileged`. It ships off. Turn it on only after the steps below, from an owner session that has already completed an authenticator check.

## Before enforcement

1. Sign in with the owner password while enforcement is off.
2. Open Receptionist permissions and choose **Set up authenticator**, or call `POST /api/auth/mfa/enroll` with that session.
3. Store the secret in an authenticator app. Store the eight recovery codes somewhere the clinic can open if the phone is lost. The application shows the codes once and stores only their hashes.
4. Confirm with a current six-digit code (`POST /api/auth/mfa/confirm`).
5. Sign out. Sign in again. The password step returns a challenge and does not set a session cookie. Enter the code or one recovery code. That code works once.
6. Repeat enrollment for every practitioner and reception account. A new staff account can enroll from its own signed-in session, or, after enforcement is on, from the enrollment challenge returned by password sign-in.
7. With the owner signed in through the authenticator, turn on **Require authenticator for staff**. The server rejects that change from a session that has not completed MFA.

## After enforcement

Password sign-in, demo sign-in, and session refresh do not issue a usable session for a privileged account until the authenticator step succeeds. A session created before enforcement stops being accepted while the setting is on. Demo sign-in for a privileged account that has not enrolled returns 403 and does not set a cookie. Client sign-in is unchanged.

Turning the setting off, or turning an authenticator off, requires a current authenticator or recovery code. Disabling an authenticator revokes that account's sessions.

Five wrong authenticator attempts lock that account's authenticator check for 15 minutes. Password failures have their own 15-minute lock.

## Replace authenticator (Account & security)

Staff manage password, authenticator replacement, and recovery codes from **Account & security** (`/account/security`).

1. Sign in with password and the current authenticator (or a recovery code) so the session is MFA-marked.
2. Choose **Replace authenticator** and enter a current TOTP or recovery code.
3. Scan the new QR (or enter the setup key). Save the new recovery codes — they are shown once.
4. Confirm with a code from the **new** authenticator. The old secret and old recovery codes stay valid until that confirm succeeds; then they are replaced atomically.
5. Cancel or let a started replacement expire (15 minutes) to keep the previous authenticator.

While `mfaEnforcePrivileged` is on, `POST /api/auth/mfa/disable` returns 409. Replace instead of turning MFA off.

## Regenerate recovery codes

From Account & security, enter a current authenticator or recovery code. Previous recovery codes are invalidated immediately. New codes are returned once and are never logged.

## If the owner loses the phone

Use a recovery code at the authenticator prompt. Then open **Account & security** and replace the authenticator (preferred while staff MFA is required). Turning authenticator off is refused when enforcement is on. If every recovery code is gone, an operator with database access has to remove that account's `nt_mfa` row and then enroll again. Do that only on a database you are allowed to change, and turn enforcement off first so the owner can sign in to enroll.
