// Hand-written OpenAPI 3 spec. Kept in one file (not scattered across route
// comments) so the whole API contract can be reviewed at a glance, and so it
// can be checked against the real routes by tests/openapi.test.js.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema, required = true) => ({ required, content: { 'application/json': { schema } } });
const res = (description, schema) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});
const errorRes = (description) => res(description, ref('Error'));
const envelope = (data, extra = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean', example: true }, data, ...extra },
});
const pathId = (name, description) => ({
  name, in: 'path', required: true, description,
  schema: { type: 'string', pattern: '^[a-f0-9]{24}$', example: '64b6f0f0f0f0f0f0f0f0f0f0' },
});
const query = (name, schema, description) => ({ name, in: 'query', required: false, description, schema });
const secured = [{ bearerAuth: [] }];
const pageParams = [
  query('page', { type: 'integer', minimum: 1, default: 1 }, 'Page number'),
  query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 10 }, 'Page size'),
];
const cacheHeader = {
  'X-Cache': { description: 'HIT when served from Redis, MISS otherwise (header absent semantics: cache disabled = MISS)', schema: { type: 'string', enum: ['HIT', 'MISS'] } },
};
const withHeaders = (r, headers) => ({ ...r, headers });

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'EVE Healthcare — Diagnostics Booking API',
    version: '1.0.0',
    description:
      'Diagnostic test bookings and simulated payments.\n\n' +
      '**Auth:** send `Authorization: Bearer <JWT>` (from `/auth/signup` or `/auth/login`).\n\n' +
      '**Rate limits:** auth endpoints 20 req/15 min, all others 300 req/15 min (`429` when exceeded).\n\n' +
      '**Idempotency:** `POST /payments/webhook` is safe to call repeatedly with the same `eventId`.',
  },
  servers: [{ url: '/api', description: 'API base path' }],
  tags: [
    { name: 'Auth' }, { name: 'Centres' }, { name: 'Bookings' }, { name: 'Payments' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Invalid request data' },
          details: { type: 'array', items: { type: 'object' }, description: 'Field-level validation errors, when applicable' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' }, limit: { type: 'integer' },
          total: { type: 'integer' }, totalPages: { type: 'integer' },
        },
      },
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string' }, name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['patient', 'admin'] },
        },
      },
      Location: {
        type: 'object',
        required: ['address', 'city'],
        properties: {
          address: { type: 'string', example: '80 Feet Road' }, city: { type: 'string', example: 'Bengaluru' },
          state: { type: 'string', example: 'KA' }, pincode: { type: 'string', example: '560095' },
        },
      },
      Centre: {
        type: 'object',
        properties: {
          _id: { type: 'string' }, name: { type: 'string' }, location: ref('Location'), isActive: { type: 'boolean' },
        },
      },
      DiagnosticTest: {
        type: 'object',
        properties: {
          _id: { type: 'string' }, centre: { type: 'string' }, name: { type: 'string', example: 'Lipid Profile' },
          description: { type: 'string' }, price: { type: 'number', example: 700 }, isActive: { type: 'boolean' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          _id: { type: 'string' }, user: { type: 'string' }, test: { type: 'string' }, centre: { type: 'string' },
          appointmentDate: { type: 'string', format: 'date-time' },
          amount: { type: 'number', description: 'Snapshot of the test price at booking time' },
          status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'] },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          _id: { type: 'string' }, booking: { type: 'string' }, amount: { type: 'number' },
          status: { type: 'string', enum: ['PENDING', 'SUCCESS', 'FAILED'] },
          providerTransactionId: { type: 'string', example: 'sim_3f1c2a9e-…' },
        },
      },
      AuthResult: envelope({
        type: 'object',
        properties: { user: ref('User'), token: { type: 'string', description: 'JWT' } },
      }),
    },
  },
  paths: {
    '/auth/signup': {
      post: {
        tags: ['Auth'], summary: 'Create a new patient account',
        requestBody: jsonBody({
          type: 'object', required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', example: 'Asha' },
            email: { type: 'string', format: 'email', example: 'asha@example.com' },
            password: { type: 'string', minLength: 6, example: 'secret123' },
          },
        }),
        responses: {
          201: res('Account created', ref('AuthResult')), 400: errorRes('Validation failed'),
          409: errorRes('Email already registered'), 429: errorRes('Rate limited'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in and receive a JWT',
        requestBody: jsonBody({
          type: 'object', required: ['email', 'password'],
          properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
        }),
        responses: {
          200: res('Logged in', ref('AuthResult')), 400: errorRes('Validation failed'),
          401: errorRes('Invalid email or password'), 429: errorRes('Rate limited'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'], summary: 'Get the authenticated user', security: secured,
        responses: { 200: res('Current user', envelope({ type: 'object', properties: { user: ref('User') } })), 401: errorRes('Missing/invalid token') },
      },
    },
    '/centres': {
      get: {
        tags: ['Centres'], summary: 'List active diagnostic centres (paginated, cached)',
        parameters: [...pageParams, query('city', { type: 'string' }, 'Case-insensitive exact city match')],
        responses: {
          200: withHeaders(
            res('Centres', envelope({ type: 'object', properties: { centres: { type: 'array', items: ref('Centre') } } }, { pagination: ref('Pagination') })),
            cacheHeader
          ),
        },
      },
      post: {
        tags: ['Centres'], summary: 'Create a centre (admin)', security: secured,
        requestBody: jsonBody({
          type: 'object', required: ['name', 'location'],
          properties: { name: { type: 'string', example: 'EVE Diagnostics — Koramangala' }, location: ref('Location') },
        }),
        responses: {
          201: res('Created', envelope({ type: 'object', properties: { centre: ref('Centre') } })),
          400: errorRes('Validation failed'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'),
        },
      },
    },
    '/centres/{id}': {
      parameters: [pathId('id', 'Centre id')],
      get: {
        tags: ['Centres'], summary: 'Get a centre with its active tests (cached)',
        responses: {
          200: withHeaders(
            res('Centre', envelope({ type: 'object', properties: { centre: ref('Centre'), tests: { type: 'array', items: ref('DiagnosticTest') } } })),
            cacheHeader
          ),
          400: errorRes('Malformed id'), 404: errorRes('Centre not found'),
        },
      },
      patch: {
        tags: ['Centres'], summary: 'Update a centre (admin)', security: secured,
        requestBody: jsonBody({
          type: 'object',
          properties: { name: { type: 'string' }, location: ref('Location'), isActive: { type: 'boolean' } },
        }),
        responses: {
          200: res('Updated', envelope({ type: 'object', properties: { centre: ref('Centre') } })),
          400: errorRes('Validation failed'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'), 404: errorRes('Centre not found'),
        },
      },
      delete: {
        tags: ['Centres'], summary: 'Soft-delete a centre and its tests (admin)', security: secured,
        responses: { 200: res('Deactivated'), 400: errorRes('Malformed id'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'), 404: errorRes('Centre not found') },
      },
    },
    '/centres/{centreId}/tests': {
      parameters: [pathId('centreId', 'Centre id')],
      get: {
        tags: ['Centres'], summary: 'List tests offered by a centre (cached)',
        responses: {
          200: withHeaders(res('Tests', envelope({ type: 'object', properties: { tests: { type: 'array', items: ref('DiagnosticTest') } } })), cacheHeader),
          400: errorRes('Malformed id'), 404: errorRes('Centre not found'),
        },
      },
      post: {
        tags: ['Centres'], summary: 'Add a test to a centre (admin)', security: secured,
        requestBody: jsonBody({
          type: 'object', required: ['name', 'price'],
          properties: { name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', minimum: 0 } },
        }),
        responses: {
          201: res('Created', envelope({ type: 'object', properties: { test: ref('DiagnosticTest') } })),
          400: errorRes('Validation failed'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'), 404: errorRes('Centre not found'),
        },
      },
    },
    '/centres/{centreId}/tests/{testId}': {
      parameters: [pathId('centreId', 'Centre id'), pathId('testId', 'Test id')],
      patch: {
        tags: ['Centres'], summary: 'Update a test (admin). Price changes never affect existing bookings.', security: secured,
        requestBody: jsonBody({
          type: 'object',
          properties: { name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', minimum: 0 }, isActive: { type: 'boolean' } },
        }),
        responses: {
          200: res('Updated', envelope({ type: 'object', properties: { test: ref('DiagnosticTest') } })),
          400: errorRes('Validation failed'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'), 404: errorRes('Test not found'),
        },
      },
      delete: {
        tags: ['Centres'], summary: 'Soft-delete a test (admin)', security: secured,
        responses: { 200: res('Deactivated'), 400: errorRes('Malformed id'), 401: errorRes('Unauthenticated'), 403: errorRes('Not an admin'), 404: errorRes('Test not found') },
      },
    },
    '/bookings': {
      post: {
        tags: ['Bookings'], summary: 'Book a diagnostic test (creates a PENDING booking)', security: secured,
        requestBody: jsonBody({
          type: 'object', required: ['testId', 'appointmentDate'],
          properties: {
            testId: { type: 'string', example: '64b6f0f0f0f0f0f0f0f0f0f0' },
            appointmentDate: { type: 'string', format: 'date-time', description: 'Must be in the future' },
          },
        }),
        responses: {
          201: res('Booked', envelope({ type: 'object', properties: { booking: ref('Booking') } })),
          400: errorRes('Validation failed (e.g. date in the past)'), 401: errorRes('Unauthenticated'), 404: errorRes('Test not found'),
        },
      },
    },
    '/bookings/me': {
      get: {
        tags: ['Bookings'], summary: "List the caller's bookings (paginated)", security: secured,
        parameters: [...pageParams, query('status', { type: 'string', enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'] }, 'Filter by status')],
        responses: {
          200: res('Bookings', envelope({ type: 'object', properties: { bookings: { type: 'array', items: ref('Booking') } } }, { pagination: ref('Pagination') })),
          401: errorRes('Unauthenticated'),
        },
      },
    },
    '/bookings/{id}': {
      parameters: [pathId('id', 'Booking id')],
      get: {
        tags: ['Bookings'], summary: 'Get a booking (owner or admin)', security: secured,
        responses: {
          200: res('Booking', envelope({ type: 'object', properties: { booking: ref('Booking') } })),
          400: errorRes('Malformed id'), 401: errorRes('Unauthenticated'), 403: errorRes('Not your booking'), 404: errorRes('Booking not found'),
        },
      },
    },
    '/bookings/{id}/cancel': {
      parameters: [pathId('id', 'Booking id')],
      patch: {
        tags: ['Bookings'], summary: 'Cancel a PENDING booking', security: secured,
        responses: {
          200: res('Cancelled', envelope({ type: 'object', properties: { booking: ref('Booking') } })),
          400: errorRes('Malformed id'), 401: errorRes('Unauthenticated'), 403: errorRes('Not your booking'),
          404: errorRes('Booking not found'), 409: errorRes('Booking is not PENDING'),
        },
      },
    },
    '/payments': {
      post: {
        tags: ['Payments'], summary: 'Simulate a payment for a booking', security: secured,
        description:
          'Default: resolves immediately (`200` SUCCESS / `402` FAILED) and updates the booking. ' +
          'With `async: true` the payment stays PENDING (`202`) and is finalized by the webhook — ' +
          'or timed out by the reconciliation job if no webhook arrives.',
        requestBody: jsonBody({
          type: 'object', required: ['bookingId'],
          properties: { bookingId: { type: 'string' }, async: { type: 'boolean', default: false } },
        }),
        responses: {
          200: res('Payment succeeded; booking CONFIRMED', envelope({ type: 'object', properties: { payment: ref('Payment'), booking: ref('Booking') } })),
          202: res('Payment pending (async mode)', envelope({ type: 'object', properties: { payment: ref('Payment'), booking: ref('Booking') } })),
          402: res('Payment failed; booking FAILED (may be retried)', envelope({ type: 'object', properties: { payment: ref('Payment'), booking: ref('Booking') } })),
          400: errorRes('Validation failed'), 401: errorRes('Unauthenticated'), 403: errorRes('Not your booking'),
          404: errorRes('Booking not found'), 409: errorRes('Booking not payable, or a payment is already in progress'),
        },
      },
    },
    '/payments/webhook': {
      post: {
        tags: ['Payments'], summary: 'Payment-status callback from the (simulated) provider — idempotent',
        description:
          'Not JWT-protected (called by the provider; production would verify a signature header). ' +
          'Repeated deliveries of the same `eventId` never duplicate payments or corrupt booking state. ' +
          'If processing fails and background jobs are enabled, the event is accepted (`202`) and retried ' +
          'with exponential backoff, then dead-lettered if retries are exhausted.',
        requestBody: jsonBody({
          type: 'object', required: ['eventId', 'providerTransactionId', 'status'],
          properties: {
            eventId: { type: 'string', example: 'evt_123' },
            providerTransactionId: { type: 'string', example: 'sim_3f1c2a9e-…' },
            status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
          },
        }),
        responses: {
          200: res('Applied, or a duplicate / already-finalized no-op'),
          202: res('Accepted: retry scheduled, or already in progress'),
          400: errorRes('Validation failed'),
          404: errorRes('Unknown providerTransactionId (only when background jobs are disabled)'),
        },
      },
    },
  },
};

module.exports = spec;
