EVE Healthcare – Diagnostic Booking & Payment API
1. What is this project?

This is a backend API for a healthcare diagnostic booking system.

A patient can:

Create an account
Login
View diagnostic centres
View tests available at a centre
Book a test
Make a payment
Receive payment confirmation
Check their booking

The backend is built using Node.js, Express and MongoDB. Redis and BullMQ are used for optional caching and background processing.

2. Technologies Used
Backend
Node.js 20
Express 4
Database
MongoDB
Mongoose
Authentication
JWT
bcrypt
Validation
express-validator
Caching
Redis
ioredis
Background Jobs
BullMQ
Testing
Jest
Supertest
MongoDB Memory Server
Security
Helmet
CORS
Rate Limiting
Documentation
OpenAPI
Swagger UI
Logging
Pino
Pino HTTP

3. Project Structure

The main folders are:

src/
│
├── config/
├── models/
├── middleware/
├── validators/
├── controllers/
├── services/
├── jobs/
├── routes/
├── docs/
└── utils/
models

Contains database models:

User
Centre
DiagnosticTest
Booking
Payment
WebhookEvent
routes

Defines API endpoints.

Example:

POST /api/bookings
GET /api/bookings/me
POST /api/payments
controllers

Handle incoming requests and send responses.

services

Contain the main business logic.

Important services:

paymentService
webhookService
middleware

Used for:

Authentication
Role checking
Validation
Error handling
Rate limiting
jobs

Contains background jobs using BullMQ.

4. Authentication

There are three important APIs.

Signup
POST /api/auth/signup

User sends:

{
  "name": "Asha",
  "email": "asha@example.com",
  "password": "secret123"
}

The server creates the user and returns a JWT token.

Login
POST /api/auth/login

User provides:

email
password

If the credentials are correct, the server returns a JWT.

Get current user
GET /api/auth/me

The JWT is sent in the request:

Authorization: Bearer <token>

The server verifies the token and identifies the user.

5. Diagnostic Centres

The system stores diagnostic centres.

Example:

Apollo Diagnostics
Delhi
Uttar Pradesh
Mumbai

A user can get all centres:

GET /api/centres

The API supports:

Pagination
City filtering
Redis caching

A user can also get one centre:

GET /api/centres/:id

An admin can:

POST   /api/centres
PATCH  /api/centres/:id
DELETE /api/centres/:id

6. Diagnostic Tests

Each centre can have multiple tests.

For example:

Centre: ABC Diagnostics

Tests:
- Blood Test
- CBC
- Thyroid Test
- Diabetes Test

A user can get tests:

GET /api/centres/:centreId/tests

Admin can create a test:

POST /api/centres/:centreId/tests

Admin can update or delete a test as well.

An important point is that changing the test price does not change the price of existing bookings.

7. Booking Flow

The user books a diagnostic test using:

POST /api/bookings

Example:

{
  "testId": "123",
  "appointmentDate": "2026-12-01T09:00:00Z"
}

Initially, the booking is:

PENDING

The system also saves the test price at the time of booking.

For example:

Test price = ₹1000

User books test

Booking amount = ₹1000

Later, if the admin changes the test price to ₹1200, the existing booking remains:

₹1000

This is called a price snapshot.

8. Payment Flow

Payment API:

POST /api/payments

The user sends:

{
  "bookingId": "123"
}

There are two payment modes.

Normal payment

Payment is processed immediately.

Possible result:

SUCCESS

or

FAILED
Async payment

The user sends:

{
  "bookingId": "123",
  "async": true
}

The payment initially becomes:

PENDING

Later, a payment provider sends a webhook.

9. What is a Webhook?

A webhook is basically a message sent by an external payment provider to our backend.

For example:

Payment provider
       |
       | Payment successful
       ↓
POST /api/payments/webhook

The webhook can contain:

{
  "eventId": "evt_123",
  "providerTransactionId": "sim_123",
  "status": "SUCCESS"
}

The backend then updates the payment and booking.

10. What is Webhook Idempotency?

This is one of the most important concepts in this project.

Sometimes a payment provider can send the same webhook more than once.

For example:

Webhook 1 → SUCCESS
Webhook 2 → SUCCESS
Webhook 3 → SUCCESS

We don't want the backend to process the payment three times.

So the system stores an:

eventId

and checks whether that event was already processed.

If it was already processed, the backend simply ignores it.

This makes the webhook idempotent.

In simple words:

Processing the same webhook multiple times should not change the final result.

11. Payment Race Condition

Suppose two requests try to complete the same payment at exactly the same time.

Request A → Payment SUCCESS
Request B → Payment SUCCESS

We don't want both requests to update the payment.

The project uses an atomic conditional database update.

Only one request can successfully change:

PENDING → SUCCESS

The other request loses and gets a conflict response.

This prevents duplicate payment processing.

12. Booking Status

A booking can move through different states.

PENDING
   |
   | Payment SUCCESS
   ↓
CONFIRMED

Or:

PENDING
   |
   | Payment FAILED
   ↓
FAILED

Or:

PENDING
   |
   | User cancels
   ↓
CANCELLED

A failed payment can be retried.

FAILED
   |
   | Retry payment
   ↓
CONFIRMED

13. Database Models
User

Stores:

name
email
password
role

Roles are:

patient
admin

Password is stored in hashed form.

Centre

Stores:

name
location
isActive
DiagnosticTest

Stores:

centre
name
description
price
isActive
Booking

Stores:

user
test
centre
appointmentDate
amount
status
Payment

Stores:

booking
amount
status
providerTransactionId
WebhookEvent

Stores:

eventId
payload
status
attempts
lastError
processedAt

14. Redis Caching

Redis is used to make frequently requested data faster.

For example:

GET /api/centres

Instead of querying MongoDB every time:

Request
   ↓
Redis
   ↓
Data available?
   ↓
YES → return data

If Redis doesn't have the data:

Request
   ↓
Redis MISS
   ↓
MongoDB
   ↓
Store result in Redis
   ↓
Return result

The cache normally lasts for 60 seconds.

15. What happens if Redis goes down?

The application does not completely fail.

It simply behaves as if the cache doesn't exist.

Redis unavailable
       ↓
Cache MISS
       ↓
MongoDB
       ↓
Return data

This is called fail-open caching.

16. BullMQ Background Jobs

BullMQ is used for tasks that don't need to be completed immediately.

For example:

Webhook arrives
       ↓
Processing fails
       ↓
Create background job
       ↓
BullMQ
       ↓
Retry later

The system uses retries with backoff.

If the operation keeps failing, eventually the event is moved to:

DEAD

The reconciliation job also runs periodically.

17. Reconciliation Job

The reconciliation job runs every 5 minutes.

Its job is to find things that may have been left incomplete.

For example:

Payment stuck in PENDING
        ↓
Timeout
        ↓
Payment FAILED

It also:

Expires unpaid bookings
Retries failed webhook events
Handles orphaned events
Dead-letters events that have exceeded retry limits

18. Error Handling

The API uses different HTTP status codes.

400 — Bad Request

The user sent invalid data.

Example:

Invalid appointment date
401 — Unauthorized

User is not authenticated.

Example:

Invalid JWT
403 — Forbidden

User is authenticated but doesn't have permission.

Example:

Patient tries to access admin API
404 — Not Found

Requested resource doesn't exist.

Example:

Booking doesn't exist
409 — Conflict

The requested operation conflicts with the current state.

Example:

Trying to pay for an already confirmed booking

19. Security

The project handles several security issues.

JWT

Used for authentication.

bcrypt

Used to hash passwords.

Helmet

Adds security-related HTTP headers.

CORS

Controls which origins can access the API.

Rate Limiting

Limits the number of requests.

For example:

Authentication:
20 requests / 15 minutes

Other APIs:
300 requests / 15 minutes
Input Validation

express-validator checks incoming data.

Mass Assignment Protection

Users cannot simply send:

{
  "role": "admin"
}

during signup and make themselves an admin.

20. Testing

The project uses:

Jest
Supertest
MongoDB Memory Server

Tests cover:

Authentication
Centres
Bookings
Payments
Webhooks
Redis caching
Background jobs
Error cases
API documentation

The project reports:

127 tests
44 unit tests
83 integration tests

The documented test run used FerretDB and Redis because the environment could not download a real MongoDB binary; the document notes that real MongoDB in CI or on the user's machine is the authoritative check.

21. Complete Flow of the Application

The easiest way to remember the entire project is:

User
 |
 | Signup / Login
 ↓
JWT Authentication
 |
 ↓
View Diagnostic Centres
 |
 ↓
View Tests
 |
 ↓
Book Test
 |
 ↓
Booking = PENDING
 |
 ↓
Make Payment
 |
 ├── Normal Payment
 |       ↓
 |    SUCCESS / FAILED
 |
 └── Async Payment
         ↓
      PENDING
         ↓
      Webhook
         ↓
      Payment Finalized
         ↓
      Booking Updated
         ↓
      CONFIRMED / FAILED

Redis helps make read operations faster, while BullMQ handles retries and background work.

22. Most Important Interview Topics

If you are preparing for an interview based on this project, focus especially on:

JWT authentication
bcrypt password hashing
MongoDB + Mongoose
REST APIs
Redis caching
Cache invalidation
Webhook
Webhook idempotency
Race conditions
Atomic database updates
BullMQ
Retry with exponential backoff
Dead-letter queue
Reconciliation jobs
HTTP status codes
Rate limiting
Input validation
Jest + Supertest
Unit vs integration testing
Booking/payment state machine

These are the parts of the project most worth being able to explain in your own words.

in the readme format

Yes. You want the content in a README.md-style format, but written in simple, readable language.

Below is a clean version based on the uploaded README.

EVE Healthcare — Diagnostics Booking & Payment API

A backend API for booking diagnostic tests and handling payments.

Built with:

Node.js
Express.js
MongoDB
Mongoose
JWT
Redis
BullMQ

This project is backend only. No frontend is included.

Features
User signup and login
JWT-based authentication
Patient and admin roles
Diagnostic centre management
Diagnostic test management
Test booking
Payment processing
Async payment support
Payment webhooks
Webhook retry mechanism
Redis caching
Background jobs using BullMQ
Rate limiting
Input validation
API documentation using Swagger
Unit and integration testing
Tech Stack
Technology	Purpose
Node.js	Backend runtime
Express.js	API framework
MongoDB	Database
Mongoose	MongoDB ODM
JWT	Authentication
bcrypt	Password hashing
express-validator	Input validation
Redis	Caching
BullMQ	Background jobs
Jest	Testing
Supertest	API testing
Swagger	API documentation
Pino	Logging
Helmet	Security
CORS	Cross-origin requests

Project Structure
src/
│
├── config/
│   ├── db.js
│   └── redis.js
│
├── models/
│   ├── User
│   ├── Centre
│   ├── DiagnosticTest
│   ├── Booking
│   ├── Payment
│   └── WebhookEvent
│
├── middleware/
│   ├── auth
│   ├── validate
│   ├── errorHandler
│   └── rateLimiter
│
├── validators/
│
├── controllers/
│
├── services/
│   ├── paymentService
│   └── webhookService
│
├── jobs/
│   ├── queues
│   ├── workers
│   ├── reconcile
│   └── lifecycle
│
├── routes/
│
├── docs/
│   └── openapi.js
│
├── utils/
│
├── app.js
├── server.js
└── worker.js

The project separates routes, controllers, services, database models, middleware and background jobs.

Getting Started
Requirements

You need:

Node.js 20+
MongoDB
Redis is optional
Installation
cp .env.example .env
npm install

Update your .env file with:

MONGO_URI
JWT_SECRET

Then optionally create sample data:

npm run seed

Start the server:

npm run dev

The API will run on:

http://localhost:5000

Swagger documentation:

http://localhost:5000/api-docs

Docker

The application can also be started using Docker:

docker-compose up --build

This starts:

MongoDB
Redis
API

Redis

Redis is optional.

If Redis is not configured, the application continues working using MongoDB.

If Redis is available:

Centre data is cached for 60 seconds.
Webhook processing can use Redis for faster duplicate checking.
BullMQ background jobs can run.
Reconciliation runs every 5 minutes.

If Redis goes down, the application fails open. This means requests continue normally and simply behave like cache misses.

API Endpoints

All APIs start with:

/api
Authentication
Signup
POST /api/auth/signup

Request:

{
  "name": "Asha",
  "email": "asha@example.com",
  "password": "secret123"
}

Creates a new user and returns a JWT token.

Login
POST /api/auth/login

Logs the user in and returns a JWT token.

Current User
GET /api/auth/me

Requires:

Authorization: Bearer <token>

Diagnostic Centres
Get Centres
GET /api/centres

Supports:

Pagination
City filtering
Redis caching
Get Centre
GET /api/centres/:id

Returns the centre and its active tests.

Create Centre
POST /api/centres

Admin only.

Update Centre
PATCH /api/centres/:id

Admin only.

Delete Centre
DELETE /api/centres/:id

Admin only.

The delete operation is a soft delete, meaning the centre is deactivated instead of being permanently removed.

Diagnostic Tests
Get Tests
GET /api/centres/:centreId/tests
Create Test
POST /api/centres/:centreId/tests

Example:

{
  "name": "Blood Test",
  "price": 500,
  "description": "Basic blood test"
}
Update Test
PATCH /api/centres/:centreId/tests/:testId
Delete Test
DELETE /api/centres/:centreId/tests/:testId

Admin access is required for creating, updating and deleting tests.

A test price change does not change the price of existing bookings.

Bookings

All booking APIs require a JWT.

Create Booking
POST /api/bookings

Request:

{
  "testId": "test_id",
  "appointmentDate": "2026-12-01T09:00:00Z"
}

When created, the booking starts as:

PENDING

The test price is copied into the booking.

For example:

Test price = ₹500

Booking created

Booking amount = ₹500

Even if the test price later changes, this booking remains ₹500.

My Bookings
GET /api/bookings/me

Supports:

Pagination
Status filtering
Get Booking
GET /api/bookings/:id

Only the booking owner or admin can access it.

Cancel Booking
PATCH /api/bookings/:id/cancel

Only a PENDING booking can be cancelled.

Payments
Create Payment
POST /api/payments

Request:

{
  "bookingId": "booking_id"
}

The payment can either be processed immediately or asynchronously.

Normal Payment

The payment immediately becomes:

SUCCESS

or:

FAILED
Async Payment

Request:

{
  "bookingId": "booking_id",
  "async": true
}

The payment initially remains:

PENDING

Later, a payment webhook finalizes the payment.

Payment Webhook

Endpoint:

POST /api/payments/webhook

Example:

{
  "eventId": "evt_123",
  "providerTransactionId": "sim_123",
  "status": "SUCCESS"
}

The webhook is called by the payment provider.

It tells our backend whether the payment was:

SUCCESS

or:

FAILED

In a real production system, the webhook should also verify the payment provider's signature.

Webhook Idempotency

The same webhook can sometimes arrive multiple times.

For example:

Webhook #1 → SUCCESS
Webhook #2 → SUCCESS
Webhook #3 → SUCCESS

The system must not process the payment three times.

The project solves this using a unique:

eventId

The backend checks whether the event was already processed.

If it was already processed, the webhook becomes a no-op.

In simple terms:

The same webhook can be received multiple times without changing the final result.

Payment Race Condition

Two requests could try to process the same payment at the same time.

Example:

Request A → SUCCESS
Request B → SUCCESS

The backend uses an atomic database update so that only one request can change:

PENDING → SUCCESS

The other request gets a conflict.

This prevents duplicate payment processing.

Booking Status

A booking can have these states:

PENDING
   |
   ├── Payment SUCCESS → CONFIRMED
   |
   ├── Payment FAILED  → FAILED
   |
   └── Cancel          → CANCELLED

A failed booking can be retried:

FAILED
   |
   ↓
Retry Payment
   |
   ├── SUCCESS → CONFIRMED
   └── FAILED  → FAILED

CONFIRMED and CANCELLED are final states.

Database Models
User
name
email
password
role

Roles:

patient
admin
Centre
name
location
isActive
DiagnosticTest
centre
name
description
price
isActive
Booking
user
test
centre
appointmentDate
amount
status
Payment
booking
amount
status
providerTransactionId
WebhookEvent
eventId
payload
status
attempts
lastError
processedAt

Redis Caching

The following read APIs use Redis caching:

GET /api/centres
GET /api/centres/:id
GET /api/centres/:centreId/tests

The default cache time is:

60 seconds

Flow:

Request
   |
   ↓
Check Redis
   |
   ├── HIT  → Return cached data
   |
   └── MISS
        |
        ↓
     MongoDB
        |
        ↓
     Save in Redis
        |
        ↓
     Return data

The API also returns:

X-Cache: HIT

or:

X-Cache: MISS

Background Jobs

BullMQ is used for background processing.

For example, if webhook processing fails:

Webhook
   |
   ↓
Processing fails
   |
   ↓
Create BullMQ job
   |
   ↓
Retry
   |
   ↓
Success

If it continues failing:

Retry
Retry
Retry
Retry
   |
   ↓
DEAD

The project uses retry attempts and exponential backoff.

Reconciliation Job

A reconciliation job runs every 5 minutes.

It checks for incomplete or stuck operations.

It can:

Timeout old pending payments
Fail expired unpaid bookings
Retry failed webhook events
Process orphaned events
Move exhausted events to DEAD

Error Handling

The API uses standard HTTP status codes.

Status	Meaning
400	Invalid request
401	Not authenticated
403	No permission
404	Resource not found
409	Conflict
202	Processing/retry scheduled
200	Success

Examples:

401 → Invalid/expired JWT

403 → Patient trying to access admin API

404 → Booking doesn't exist

409 → Trying to pay for an already confirmed booking

Security

The project includes:

JWT Authentication

Protects private APIs.

bcrypt

Hashes user passwords.

Helmet

Adds security headers.

CORS

Controls cross-origin requests.

Rate Limiting
Authentication:
20 requests / 15 minutes

Other APIs:
300 requests / 15 minutes
Input Validation

Checks whether incoming data is valid.

Mass Assignment Protection

Users cannot make themselves admin by sending:

{
  "role": "admin"
}

during signup.

Testing

Testing is done using:

Jest
Supertest
MongoDB Memory Server

The project reports:

127 total tests

44 unit tests
83 integration tests

Tests cover:

Authentication
Centres
Bookings
Payments
Webhooks
Redis caching
Background jobs
Error handling
API documentation

Running Tests

Unit tests:

npm run test:unit

All tests:

npm test

Integration tests can use:

MONGO_TEST_URI=mongodb://127.0.0.1:27017/eve_test npm test

Redis-dependent tests can use:

MONGO_TEST_URI=mongodb://127.0.0.1:27017/eve_test \
REDIS_TEST_URL=redis://127.0.0.1:6379 \
npm test

Example Complete Flow
1. User signs up
        ↓
2. User logs in
        ↓
3. JWT token is generated
        ↓
4. User views diagnostic centres
        ↓
5. User selects a centre
        ↓
6. User selects a diagnostic test
        ↓
7. User creates a booking
        ↓
8. Booking becomes PENDING
        ↓
9. User makes payment
        ↓
10. Payment succeeds
        ↓
11. Booking becomes CONFIRMED

For asynchronous payment:

Payment
   ↓
PENDING
   ↓
Payment Provider
   ↓
Webhook
   ↓
Webhook Validation / Deduplication
   ↓
Payment Finalized
   ↓
Booking Updated
   ↓
CONFIRMED
Important Concepts Used

If you are preparing for an interview, understand these particularly well:

JWT Authentication
Password Hashing
REST API
MongoDB + Mongoose
Redis Caching
Cache Invalidation
Webhooks
Webhook Idempotency
Race Conditions
Atomic Updates
BullMQ
Background Jobs
Retry Mechanism
Exponential Backoff
Dead Letter Handling
Reconciliation
Rate Limiting
Input Validation
Unit Testing
Integration Testing

The README specifically highlights webhook idempotency, atomic payment finalization, retries, reconciliation, caching and failure handling as important parts of the implementation.