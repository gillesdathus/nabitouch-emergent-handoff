# Test credentials

Frontend-only design preview. No real auth/backend — all data is MOCK.

- Role switching: floating "DESIGN PREVIEW" pill at top center (data-testid="role-switcher") → role-option-{guest|client|owner|pro|desk|training}
- /login (mock): any email + password (8+ chars). Emails containing "owner" / "pro" / "desk" go to MFA step; any 6 digits verify. Other emails sign in as client.
