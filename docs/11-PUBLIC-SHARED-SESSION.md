# Public Shared Session

The judge portal at `https://errand-arc.vercel.app` supports a shared buyer/merchant replay. Add a session slug to the URL and open it in two browsers:

```text
https://errand-arc.vercel.app/?session=judge-room
```

Both clients poll the same no-store endpoint and render the newest revision. The shopper can parse the intent, run recorded paid research, build plans, and fund the recorded escrow. The merchant client sees that funded order and advances it through preparing, ready, and pickup release. These actions update demo state only; they do not sign or broadcast a new transaction.

## API

`GET /api/session?session=judge-room` returns the current session state.

`POST /api/session?session=judge-room` accepts:

```json
{
  "action": "research",
  "expectedRevision": 1,
  "requestId": "client_generated_unique_id",
  "intent": "I am making meatballs for 4 people"
}
```

Allowed actions are ordered and cannot be skipped:

```text
start → research → plans → fund → preparing → ready → release
```

`reset` is allowed from any phase. Request IDs make retries idempotent; revisions reject stale writes; session slugs are restricted to 1-48 lowercase letters, numbers, or hyphens. Vercel Runtime Cache keeps the session shared within the production region for 24 hours. A temporary-file fallback keeps `vercel dev` deterministic when Runtime Cache is unavailable locally.

## Verification

```bash
npm --prefix deploy/vercel test
```

The tests cover the complete lifecycle, duplicate requests, stale and skipped transitions, input validation, and the HTTP handler's shared read/write behavior.
