# Auth testing (Nabitouch)

Use `OWNER_EMAIL` and `OWNER_PASSWORD` from the environment. Do not put passwords in this file or in test defaults.

1. Mongo: `db.nt_users.find({}, {email:1, role:1, password_hash:1})` — hashes start with `$2b$`; unique index on email.
2. API: `curl -c c.txt -X POST $API/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}"` then send the `csrf_token` cookie value as `X-CSRF-Token` on later cookie-authenticated mutations. `curl -b c.txt $API/api/auth/me` reads the session.
3. Protected: /api/payments/*, /api/claims/*, /api/tracking/*, transitions, soap, PATCH/POST collections require auth plus role or ownership. GET /api/state is role-scoped (public: catalogue and anonymised availability only).
4. Local credentials belong in an untracked environment file, not in git.
