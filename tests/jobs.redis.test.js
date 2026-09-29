
const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');
const { getRedis, initRedis, closeRedis } = require('../src/config/redis');
const { startJobs, stopJobs } = require('../src/jobs');
const { getQueues } = require('../src/jobs/queues');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const WebhookEvent = require('../src/models/WebhookEvent');

const describeRedis = process.env.REDIS_TEST_URL ? describe : describe.skip;

async function waitFor(check, timeoutMs = 15000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (; ;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describeRedis('Background jobs (real Redis + BullMQ)', () => {
  const saved = {};
  beforeAll(async () => {
    Object.assign(saved, {
      REDIS_URL: process.env.REDIS_URL,
      WEBHOOK_RETRY_ATTEMPTS: process.env.WEBHOOK_RETRY_ATTEMPTS,
      WEBHOOK_RETRY_BASE_DELAY_MS: process.env.WEBHOOK_RETRY_BASE_DELAY_MS,
      WEBHOOK_STALE_SECONDS: process.env.WEBHOOK_STALE_SECONDS,
    });
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    process.env.WEBHOOK_RETRY_ATTEMPTS = '3';
    process.env.WEBHOOK_RETRY_BASE_DELAY_MS = '150';
    process.env.WEBHOOK_STALE_SECONDS = '3600'; // keep the "take over stale event" path out of this test
    await initRedis();
    await getRedis().flushdb();
    await startJobs();
  });
  afterAll(async () => {
    await stopJobs();
    await closeRedis();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('a webhook that arrives BEFORE its payment exists is accepted, retried by the worker, and applied', async () => {
    const body = { eventId: 'evt_e2e_ok', providerTransactionId: 'sim_e2e_late', status: 'SUCCESS' };

    const first = await request(app).post('/api/payments/webhook').send(body);
    expect(first.status).toBe(202);

    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const b = await createBooking(token, test._id);
    const bookingId = b.body.data.booking._id;
    await Payment.create({ booking: bookingId, amount: 500, status: 'PENDING', providerTransactionId: 'sim_e2e_late' });

    await waitFor(async () => (await Booking.findById(bookingId)).status === 'CONFIRMED');
    const ev = await WebhookEvent.findOne({ eventId: 'evt_e2e_ok' });
    expect(ev.status).toBe('PROCESSED');
    expect(ev.attempts).toBeGreaterThanOrEqual(1);
  });

  test('an event that can never succeed is retried with backoff and then dead-lettered', async () => {
    const res = await request(app).post('/api/payments/webhook')
      .send({ eventId: 'evt_e2e_dead', providerTransactionId: 'sim_never_exists', status: 'SUCCESS' });
    expect(res.status).toBe(202);

    const ev = await waitFor(async () => {
      const e = await WebhookEvent.findOne({ eventId: 'evt_e2e_dead' });
      return e && e.status === 'DEAD' ? e : null;
    });
    expect(ev.lastError).toMatch(/No payment found/);
    expect(ev.attempts).toBeGreaterThanOrEqual(3);

    const again = await request(app).post('/api/payments/webhook')
      .send({ eventId: 'evt_e2e_dead', providerTransactionId: 'sim_never_exists', status: 'SUCCESS' });
    expect(again.status).toBe(200);
    expect(again.body.message).toMatch(/dead-lettered/i);
  });

  test('redelivering the same failing event does not enqueue duplicate jobs', async () => {
    const body = { eventId: 'evt_e2e_dupe', providerTransactionId: 'sim_dupe_never', status: 'SUCCESS' };
    await request(app).post('/api/payments/webhook').send(body);
    await request(app).post('/api/payments/webhook').send(body);
    await request(app).post('/api/payments/webhook').send(body);

    const jobs = await getQueues().webhook.getJobs(['waiting', 'delayed', 'active', 'failed', 'completed']);
    expect(jobs.filter((j) => j.data.eventId === 'evt_e2e_dupe')).toHaveLength(1);
  });

  test('the repeating reconciliation job is registered exactly once', async () => {
    const schedulers = await getQueues().maintenance.getJobSchedulers();
    expect(schedulers.filter((s) => s.key === 'reconcile-schedule' || s.id === 'reconcile-schedule')).toHaveLength(1);
    await startJobs().catch(() => { });
    const after = await getQueues().maintenance.getJobSchedulers();
    expect(after.filter((s) => s.key === 'reconcile-schedule' || s.id === 'reconcile-schedule')).toHaveLength(1);
  });
});
