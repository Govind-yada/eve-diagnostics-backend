// Integration tests against a REAL Redis. Skipped automatically unless
// REDIS_TEST_URL is set (e.g. REDIS_TEST_URL=redis://127.0.0.1:6379 npm test).
const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');
const { getRedis, initRedis, closeRedis } = require('../src/config/redis');
const User = require('../src/models/User');
const WebhookEvent = require('../src/models/WebhookEvent');

const describeRedis = process.env.REDIS_TEST_URL ? describe : describe.skip;

async function adminToken() {
  const { token, user } = await registerAndLogin();
  await User.updateOne({ _id: user._id }, { role: 'admin' });
  return token;
}

describeRedis('Redis caching (real Redis)', () => {
  beforeAll(async () => {
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    await initRedis();
  });
  beforeEach(async () => { await getRedis().flushdb(); });
  afterAll(async () => {
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  test('GET /centres is a MISS first, then a HIT with an identical body', async () => {
    await createCentreWithTest();
    const first = await request(app).get('/api/centres');
    const second = await request(app).get('/api/centres');
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toEqual(first.body);
  });

  test('different pages / filters use different cache entries', async () => {
    await createCentreWithTest();
    await request(app).get('/api/centres?page=1&limit=5');
    const other = await request(app).get('/api/centres?page=1&limit=6');
    const city = await request(app).get('/api/centres?city=testville');
    expect(other.headers['x-cache']).toBe('MISS');
    expect(city.headers['x-cache']).toBe('MISS');
  });

  test('an admin write invalidates the cached list (no stale data)', async () => {
    const admin = await adminToken();
    await createCentreWithTest();
    await request(app).get('/api/centres'); // warm

    await request(app).post('/api/centres').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'New Centre', location: { address: '9 New Rd', city: 'Pune' } });

    const after = await request(app).get('/api/centres');
    expect(after.headers['x-cache']).toBe('MISS');
    expect(after.body.pagination.total).toBe(2);
  });

  test('a price update invalidates the cached centre detail; existing bookings keep their snapshot', async () => {
    const admin = await adminToken();
    const { token } = await registerAndLogin();
    const { centre, test } = await createCentreWithTest(500);
    const booking = await createBooking(token, test._id);

    const warm = await request(app).get(`/api/centres/${centre._id}`);
    expect(warm.body.data.tests[0].price).toBe(500);
    expect((await request(app).get(`/api/centres/${centre._id}`)).headers['x-cache']).toBe('HIT');

    await request(app).patch(`/api/centres/${centre._id}/tests/${test._id}`)
      .set('Authorization', `Bearer ${admin}`).send({ price: 900 });

    const fresh = await request(app).get(`/api/centres/${centre._id}`);
    expect(fresh.headers['x-cache']).toBe('MISS');
    expect(fresh.body.data.tests[0].price).toBe(900);

    const mine = await request(app).get(`/api/bookings/${booking.body.data.booking._id}`).set('Authorization', `Bearer ${token}`);
    expect(mine.body.data.booking.amount).toBe(500);
  });

  test('errors are never cached (404 stays a 404 and a later create is visible)', async () => {
    const id = '64b6f0f0f0f0f0f0f0f0f0f0';
    expect((await request(app).get(`/api/centres/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/centres/${id}`)).status).toBe(404);
    expect(await getRedis().keys('eve:centres:one:*')).toHaveLength(0);
  });

  test('authenticated per-user data (bookings) is never cached', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    await createBooking(token, test._id);
    await request(app).get('/api/bookings/me').set('Authorization', `Bearer ${token}`);
    expect(await getRedis().keys('eve:bookings*')).toHaveLength(0);
  });

  test('webhook fast path: a completed event id is remembered in Redis and short-circuits redelivery', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const b = await createBooking(token, test._id);
    const pay = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`)
      .send({ bookingId: b.body.data.booking._id, async: true });
    const body = { eventId: 'evt_fp', providerTransactionId: pay.body.data.payment.providerTransactionId, status: 'SUCCESS' };

    expect((await request(app).post('/api/payments/webhook').send(body)).status).toBe(200);
    expect(await getRedis().exists('eve:webhook:done:evt_fp')).toBe(1);

    // Prove the redelivery is answered from Redis alone: wipe Mongo's record first.
    await WebhookEvent.deleteMany({});
    const again = await request(app).post('/api/payments/webhook').send(body);
    expect(again.status).toBe(200);
    expect(again.body.message).toMatch(/already processed/i);
    expect(await WebhookEvent.countDocuments()).toBe(0); // Mongo was never touched
  });

  test('FAILS OPEN: with Redis unreachable the API still answers correctly', async () => {
    await createCentreWithTest();
    await closeRedis();
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing listens here
    try {
      const res = await request(app).get('/api/centres');
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.headers['x-cache']).toBe('MISS');
    } finally {
      await closeRedis();
      process.env.REDIS_URL = process.env.REDIS_TEST_URL;
      await initRedis();
    }
  });
});
