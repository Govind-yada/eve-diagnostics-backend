# EVE Healthcare — Diagnostics Booking & Payment API

Backend service for booking diagnostic tests and simulating payments, built with **Node.js, Express and MongoDB (Mongoose)**, with optional **Redis caching** and **BullMQ background jobs**. (Backend only — no frontend was requested.)

## Stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js 20, Express 4 |
| Database | MongoDB via Mongoose 8 |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Validation | `express-validator` |
| Cache (optional) | Redis via `ioredis` |
| Background jobs (optional) | BullMQ |
| API docs | OpenAPI 3 + Swagger UI (`/api-docs`, raw JSON at `/api-docs.json`) |
| Logging | `pino` + `pino-http` (structured JSON) |
| Hardening | `helmet`, `cors`, `express-rate-limit` |
| Tests | Jest + Supertest (+ `mongodb-memory-server`) |

## Project layout

```
src/
  config/        db.js, redis.js
  models/        User, Centre, DiagnosticTest, Booking, Payment, WebhookEvent
  middleware/    auth (JWT + roles), validate, errorHandler, rateLimiter
  validators/    express-validator rule sets
  controllers/   thin HTTP layer
  services/      paymentService (finalizePayment), webhookService (idempotent intake + retry logic)
  jobs/          queues, workers, reconcile, lifecycle (BullMQ)
  routes/        route -> controller wiring
  docs/openapi.js  full OpenAPI spec
  utils/         ApiError, asyncHandler, logger, cache (fail-open Redis helper), seed
  app.js         Express app (no listener; importable by tests)
  server.js      API entrypoint        worker.js   optional standalone worker entrypoint
tests/
  unit/          no database needed (error handler, cache helper, OpenAPI spec)
  *.test.js      integration tests (MongoDB; some also need Redis)
```

## Running locally

Requirements: Node 20+, MongoDB. Redis is **optional**.

```bash
cp .env.example .env      # edit MONGO_URI / JWT_SECRET
npm install
npm run seed              # optional: demo centre + 3 tests + admin (admin@eve.health / admin123)
npm run dev               # http://localhost:5000  (Swagger UI: /api-docs)
```

### With Docker (Mongo + Redis + API)

```bash
docker-compose up --build
```

### Redis is optional

| | `REDIS_URL` unset | `REDIS_URL` set |
|---|---|---|
| Centre endpoints | served straight from MongoDB | cached (60s TTL), invalidated on admin writes |
| Webhook dedupe | MongoDB unique index | Redis fast-path in front of the same index |
| Webhook failures | claim released; the provider's own retry is processed | accepted (`202`), retried by a BullMQ worker with backoff, then dead-lettered |
| Reconciliation sweep | not running | repeating job every 5 min |

If Redis is configured but goes down, the cache **fails open** (requests behave as cache misses, nothing errors).

Run the workers in the API process (default) or separately: set `RUN_JOBS_IN_API=false` on the API and run `npm run worker`.

## Tests

```bash
npm run test:unit         # ~1s, needs nothing
npm test                  # unit + integration
```

Integration tests need a MongoDB. By default `mongodb-memory-server` downloads and caches a `mongod` on first run. To use your own instance instead (docker, CI service container):

```bash
MONGO_TEST_URI=mongodb://127.0.0.1:27017/eve_test npm test
```

Redis-dependent suites (`cache.test.js`, `jobs.redis.test.js`) **skip themselves** unless `REDIS_TEST_URL` is set:

```bash
MONGO_TEST_URI=mongodb://127.0.0.1:27017/eve_test REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

**Suite: 127 tests (44 unit, 83 integration), all passing.** How they were verified, for transparency: the author's environment could not download a `mongod` binary, so the run used **FerretDB 1.24 (a MongoDB-wire-protocol server, SQLite backend)** and **Redis 7.0.15**. The code uses only standard operations (unique indexes, atomic `findOneAndUpdate`, `updateMany`, aggregation-free queries), but this was not run against genuine `mongod` — CI or your machine with real MongoDB is the authoritative check.

What the tests cover:

- **Auth / centres / bookings / payments** — happy paths and every rejection path (400/401/403/404/409).
- **Webhook idempotency** — replays, conflicting events, early events, half-applied events.
- **Retry handling** — failing event → `202` + job scheduled; redelivery while pending is a no-op; stale events are taken over; dead-lettered events are acknowledged but never re-applied.
- **End-to-end BullMQ** (real Redis) — a webhook arriving *before* its payment exists is accepted, retried by the worker with backoff and applied with nobody calling it again; a never-succeeding event is dead-lettered after N attempts; no duplicate jobs; the reconciliation schedule is registered exactly once.
- **Reconciliation** — times out stale payments, expires past unpaid bookings, re-processes orphaned events, dead-letters exhausted ones, and is idempotent.
- **Caching** (real Redis) — MISS→HIT, per-query keys, invalidation on admin writes, errors never cached, per-user data never cached, webhook fast-path, and fail-open with Redis unreachable.
- **Docs** — every registered route is documented and vice-versa (checked by walking the Express router), every `$ref` resolves.

## API overview

All endpoints are under `/api` (the assignment's `POST /payments/` is `POST /api/payments/`; trailing slashes work). Full request/response schemas: Swagger UI at `/api-docs`.

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | – | `{ name, email, password }` → user + JWT |
| POST | `/auth/login` | – | `{ email, password }` → user + JWT |
| GET | `/auth/me` | Bearer | current user |

### Centres & tests
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/centres?page=&limit=&city=` | – | paginated, cached; `X-Cache: HIT|MISS` header |
| GET | `/centres/:id` | – | centre + active tests (cached) |
| POST | `/centres` | admin | create |
| PATCH | `/centres/:id` | admin | update name / location / isActive |
| DELETE | `/centres/:id` | admin | soft-delete (also deactivates its tests) |
| GET | `/centres/:centreId/tests` | – | tests at a centre (cached) |
| POST | `/centres/:centreId/tests` | admin | `{ name, price, description? }` |
| PATCH | `/centres/:centreId/tests/:testId` | admin | update (price changes never affect existing bookings) |
| DELETE | `/centres/:centreId/tests/:testId` | admin | soft-delete |

### Bookings (Bearer)
| Method | Path | Description |
|---|---|---|
| POST | `/bookings` | `{ testId, appointmentDate }` → `PENDING` booking; `amount` snapshots the test price |
| GET | `/bookings/me?page=&limit=&status=` | caller's bookings |
| GET | `/bookings/:id` | owner or admin only |
| PATCH | `/bookings/:id/cancel` | cancel a `PENDING` booking |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments` | Bearer | `{ bookingId, async?: boolean }` |
| POST | `/payments/webhook` | none* | `{ eventId, providerTransactionId, status: SUCCESS|FAILED }` |

`POST /payments` — default: resolves immediately (`200` SUCCESS / `402` FAILED; odds set by `PAYMENT_SUCCESS_RATE`) and updates the booking. `async: true`: payment stays `PENDING` (`202`) and is finalized by the webhook — or timed out by the reconciliation job if no webhook arrives.

Webhook responses:

| Status | Meaning |
|---|---|
| `200` | applied, **or** a duplicate / already-finalized no-op, **or** previously dead-lettered (acknowledged, never re-applied) |
| `202` | processing failed and a retry is scheduled, **or** the event is already being processed |
| `400` | invalid payload |
| `404` | unknown `providerTransactionId` — **only when background jobs are disabled** (with jobs enabled it is retried instead, since the payment row may just not be visible yet) |

```bash
curl -X POST localhost:5000/api/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"secret123"}'

curl -X POST localhost:5000/api/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"testId":"<test id>","appointmentDate":"2026-12-01T09:00:00Z"}'

curl -X POST localhost:5000/api/payments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bookingId":"<booking id>","async":true}'

curl -X POST localhost:5000/api/payments/webhook -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_123","providerTransactionId":"sim_...","status":"SUCCESS"}'
```

\* Not gated by a user JWT because the *provider* calls it. In production it would verify a provider-issued HMAC signature header (see "improvements").

## Database design

- **User** — `name, email (unique), password (hashed, select:false), role (patient|admin)`
- **Centre** — `name, location{address, city, state, pincode}, isActive`
- **DiagnosticTest** — `centre → Centre, name, description, price, isActive`. Separate collection so the same test can be priced per centre and queried/paginated independently.
- **Booking** — `user, test, centre, appointmentDate, amount, status`. `amount` is a **snapshot** of the test price at booking time.
- **Payment** — `booking, amount, status (PENDING|SUCCESS|FAILED), providerTransactionId (unique)`. One row per attempt; a booking may have several (retry after failure).
- **WebhookEvent** — `eventId (unique), payload, status (RECEIVED|PROCESSED|FAILED|DEAD), attempts, lastError, processedAt`. Powers idempotency and makes failures visible.

Booking state machine:

```
PENDING --cancel--> CANCELLED
PENDING --payment SUCCESS--> CONFIRMED          (terminal)
PENDING --payment FAILED / timeout--> FAILED
FAILED  --retry payment--> CONFIRMED | FAILED
PENDING --appointment time passed, unpaid--> CANCELLED   (reconciliation job)
CONFIRMED, CANCELLED: terminal
```

## How webhook idempotency works

All in `services/webhookService.js` and `services/paymentService.js`:

1. **Event-level dedupe.** The `eventId` is claimed by inserting a `WebhookEvent` (unique index). A duplicate-key error means the event was already received; what happens next depends on its stored `status`: `PROCESSED` → no-op `200`; `DEAD` → acknowledged; `RECEIVED`/`FAILED` and fresh → `202` in progress; unfinished and **stale** (default > 60s) → taken over and applied. With Redis, completed event ids are also remembered so redeliveries are answered without touching MongoDB; Redis only ever short-circuits events *known to be finished*, so a cold or lost cache is harmless.
2. **State-level guard.** `finalizePayment()` moves a payment out of `PENDING` with one conditional atomic update (only one caller can win), then reconciles the booking from the payment's **stored** status — never from the incoming event — with a second conditional update that only touches non-terminal bookings. A conflicting late event can therefore never flip a finalized outcome, and re-running the function is always safe.
3. **Failure handling.** If processing fails (DB blip, or the event beat its payment row): with jobs enabled the event is stored as `FAILED` and a BullMQ job retries it with exponential backoff (default 5 attempts, 2s base), then marks it `DEAD`. Without Redis the claim is released so the provider's own retry gets processed. Because step 2 re-reconciles on every call, a retry also **heals a half-applied event** (payment finalized, process died before the booking update).
4. **Reconciliation job** (every 5 min): times out `PENDING` payments older than 15 min (→ booking `FAILED`, user can retry), expires unpaid bookings whose appointment time passed, re-processes events orphaned in `RECEIVED`/`FAILED`, and dead-letters those over budget. It uses the same idempotent code paths, so it is safe alongside live traffic.

Assumption: an `eventId` always carries the same payload; a corrected event must come with a new id.

## Caching

Read-heavy public endpoints (`GET /centres`, `/centres/:id`, `/centres/:centreId/tests`) are cached in Redis for `CACHE_TTL_SECONDS` (default 60). Every admin write to a centre or test clears the whole `centres:` key family (coarse but simple and correct). Errors (e.g. 404) are never cached; per-user data (bookings, payments) is never cached. Responses carry `X-Cache: HIT|MISS`.

## Edge cases handled

- Invalid/missing/expired JWT → `401`; non-admin on admin routes → `403`; other users' bookings → `403`
- Duplicate email → `409`; bad input / weak password / past appointment date / malformed ObjectIds → `400`
- Unknown test / booking / centre → `404`
- Cancelling a non-pending booking, paying for a confirmed/cancelled one, or starting a second in-flight payment → `409`
- Concurrent payment attempts resolving the same booking → loser gets `409`, state never overwritten
- Webhook: replays, conflicting events, unknown transaction, events arriving before their payment, crashes mid-processing, exhausted retries (see above)
- `city` filter is regex-escaped (no regex injection / ReDoS); centre/test writes whitelist fields (no mass assignment; `role` can't be set at signup)
- Rate limiting: auth 20 req/15 min, everything else 300 req/15 min

## Assumptions

- Webhook is unauthenticated in this simulation (no real provider secret exists).
- A `FAILED` booking can be retried; `CONFIRMED`/`CANCELLED` are terminal (refunds/rebooking out of scope).
- Price is snapshotted at booking time.
- Minimal roles (`patient`, `admin`); there is no admin-signup flow — the seed script creates one.
- `async` flag on `POST /payments` is an addition so the webhook path has a real `PENDING` payment to finalize.
- Background workers run inside the API process by default for simplicity.

## What I'd improve with more time

- HMAC signature verification on the webhook (verified against the raw body)
- MongoDB multi-document transactions for payment + booking (needs a replica set) instead of conditional updates
- Finer-grained cache invalidation and per-key TTLs; Redis-backed rate-limit store for multi-instance deployments
- An admin endpoint to inspect/replay `DEAD` webhook events; metrics (Prometheus) and alerting on dead-letter growth
- Refresh tokens, email verification, admin user management
- CI pipeline running the suite against real `mongod` + Redis service containers
