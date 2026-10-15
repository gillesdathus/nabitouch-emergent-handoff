# Monitoring

`GET /api/health` is public. It reports `mongo` and `redis` as `ok`, `unavailable`, or `unconfigured`. It does not include credentials, coordinates, or clinical text.

`GET /api/ops/status` is owner-only. It adds whether MongoDB is a replica set, the financial transaction mode, and the count of pending ledger operations.

Alert a person when:

- `/api/health` is not `ok`
- `pendingFinancialOperations` stays above zero after a retry
- Stripe webhook responses are 400 or 409
- A client billing notice fails to send (the ledger write still stands; mail is not the source of truth)
- An import batch reports errors
- Booking responses return 5xx
- Tracking ingest returns 503 because Redis is down

Logs pass through the existing redaction filter. Do not add passwords, webhook secrets, insurance member numbers, SOAP text, or latitude and longitude to new log lines.
