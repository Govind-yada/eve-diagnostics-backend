const ApiError = require('../../src/utils/ApiError');
const { errorHandler, notFound } = require('../../src/middleware/errorHandler');

function run(err) {
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  errorHandler(err, {}, res, () => {});
  return res;
}

describe('errorHandler', () => {
  test('passes an ApiError through with its status and details', () => {
    const res = run(new ApiError(418, 'teapot', [{ field: 'x' }]));
    expect(res.statusCode).toBe(418);
    expect(res.body).toEqual({ success: false, message: 'teapot', details: [{ field: 'x' }] });
  });

  test('maps a Mongoose CastError (malformed ObjectId) to 400', () => {
    const res = run({ name: 'CastError', path: '_id', value: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/_id/);
  });

  test('maps a duplicate-key error (11000) to 409 naming the field', () => {
    const res = run({ code: 11000, keyValue: { email: 'a@b.com' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/email/);
  });

  test('maps a Mongoose ValidationError to 400 with per-field details', () => {
    const res = run({ name: 'ValidationError', errors: { price: { message: 'too low' } } });
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toEqual(['too low']);
  });

  test('unknown errors become a 500 without leaking a stack trace', () => {
    const res = run(new Error('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body.stack).toBeUndefined();
  });

  test('notFound forwards a 404 ApiError naming the route', () => {
    const next = jest.fn();
    notFound({ method: 'GET', originalUrl: '/nope' }, {}, next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
    expect(err.message).toMatch(/GET \/nope/);
  });
});
