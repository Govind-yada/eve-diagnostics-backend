const mongoose = require('mongoose');
const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const WebhookEvent = require('../src/models/WebhookEvent');
const jobs = require('../src/jobs/queues');
const { reconcile } = require('../src/jobs/reconcile');
const { processStoredEvent } = require('../src/services/webhookService');

const HOUR = 60 * 60 * 1000;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
// Raw-collection update so we can backdate timestamps that Mongoose would otherwise overwrite.
const backdate = (Model, id, field, ms) =>
  Model.collection.updateOne({ _id: oid(id) }, { $set: { [field]: new Date(Date.now() - ms) } });
const backdateEvent = (eventId, ms) =>
  WebhookEvent.collection.updateOne({ eventId }, { $set: { updatedAt: new Date(Date.now() - ms) } });

async function pendingPayment() {
  const { token, user } = await registerAndLogin();
  const { test, centre } = await createCentreWithTest();
  const b = await createBooking(token, test._id);
  const bookingId = b.body.data.booking._id;
  const p = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({ bookingId, async: true });
  return { token, user, test, centre, bookingId, payment: p.body.data.payment };
}

afterEach(() => jest.restoreAllMocks());

describe('reconcile()', () => {
  test('times out a stale PENDING payment: payment -> FAILED, booking -> FAILED (user may retry)', async () => {
    const { bookingId, payment } = await pendingPayment();
    await backdate(Payment, payment._id, 'createdAt', 2 * HOUR);

    const summary = await reconcile();

    expect(summary.paymentsTimedOut).toBe(1);
    expect((await Payment.findById(payment._id)).status).toBe('FAILED');
    expect((await Booking.findById(bookingId)).status).toBe('FAILED');
  });

  test('leaves a fresh PENDING payment alone', async () => {
    const { bookingId, payment } = await pendingPayment();
    const summary = await reconcile();
    expect(summary.paymentsTimedOut).toBe(0);
    expect((await Payment.findById(payment._id)).status).toBe('PENDING');
    expect((await Booking.findById(bookingId)).status).toBe('PENDING');
  });

  test('expires PENDING bookings whose appointment passed, but not future ones or ones with a payment in flight', async () => {
    const { user } = await registerAndLogin();
    const { test, centre } = await createCentreWithTest();
    const base = { user: user._id, test: test._id, centre: centre._id, amount: 500, status: 'PENDING' };

    const past = await Booking.create({ ...base, appointmentDate: new Date(Date.now() - HOUR) });
    const future = await Booking.create({ ...base, appointmentDate: new Date(Date.now() + 24 * HOUR) });
    const pastWithPayment = await Booking.create({ ...base, appointmentDate: new Date(Date.now() - HOUR) });
    await Payment.create({ booking: pastWithPayment._id, amount: 500, status: 'PENDING', providerTransactionId: 'sim_inflight' });

    const summary = await reconcile();

    expect(summary.bookingsExpired).toBe(1);
    expect((await Booking.findById(past._id)).status).toBe('CANCELLED');
    expect((await Booking.findById(future._id)).status).toBe('PENDING');
    expect((await Booking.findById(pastWithPayment._id)).status).toBe('PENDING');
  });

  test('re-processes a webhook event orphaned in RECEIVED (e.g. process died mid-request)', async () => {
    const { bookingId, payment } = await pendingPayment();
    await WebhookEvent.create({
      eventId: 'evt_orphan', status: 'RECEIVED',
      payload: { eventId: 'evt_orphan', providerTransactionId: payment.providerTransactionId, status: 'SUCCESS' },
    });
    await backdateEvent('evt_orphan', HOUR);

    const summary = await reconcile();

    expect(summary.eventsReprocessed).toBe(1);
    expect((await Booking.findById(bookingId)).status).toBe('CONFIRMED');
    expect((await WebhookEvent.findOne({ eventId: 'evt_orphan' })).status).toBe('PROCESSED');
  });

  test('dead-letters an event that exhausted its retry budget', async () => {
    await WebhookEvent.create({
      eventId: 'evt_exhausted', status: 'FAILED', attempts: 5, lastError: 'No payment found',
      payload: { eventId: 'evt_exhausted', providerTransactionId: 'sim_never', status: 'SUCCESS' },
    });
    await backdateEvent('evt_exhausted', HOUR);

    const summary = await reconcile();

    expect(summary.eventsDeadLettered).toBe(1);
    expect((await WebhookEvent.findOne({ eventId: 'evt_exhausted' })).status).toBe('DEAD');
  });

  test('is idempotent: a second run right after the first changes nothing', async () => {
    const { payment } = await pendingPayment();
    await backdate(Payment, payment._id, 'createdAt', 2 * HOUR);
    await reconcile();
    const second = await reconcile();
    expect(second).toEqual({ paymentsTimedOut: 0, bookingsExpired: 0, eventsReprocessed: 0, eventsDeadLettered: 0 });
  });
});

describe('Webhook server-side retry handling (queue available)', () => {
  const hook = (body) => request(app).post('/api/payments/webhook').send(body);

  test('a failing event is accepted (202), kept as FAILED, and a retry job is scheduled', async () => {
    const spy = jest.spyOn(jobs, 'enqueueWebhookRetry').mockResolvedValue(true);

    const res = await hook({ eventId: 'evt_q1', providerTransactionId: 'sim_not_yet', status: 'SUCCESS' });

    expect(res.status).toBe(202);
    expect(spy).toHaveBeenCalledWith('evt_q1');
    const ev = await WebhookEvent.findOne({ eventId: 'evt_q1' });
    expect(ev.status).toBe('FAILED');
    expect(ev.attempts).toBe(1);
    expect(ev.lastError).toMatch(/No payment found/);
  });

  test('the retry job later applies the SAME event once the payment exists', async () => {
    jest.spyOn(jobs, 'enqueueWebhookRetry').mockResolvedValue(true);
    await hook({ eventId: 'evt_q2', providerTransactionId: 'sim_later', status: 'SUCCESS' });

    // The payment row "appears" (the race that made the first attempt fail).
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const b = await createBooking(token, test._id);
    const bookingId = b.body.data.booking._id;
    await Payment.create({ booking: bookingId, amount: 500, status: 'PENDING', providerTransactionId: 'sim_later' });

    await processStoredEvent('evt_q2'); // what the BullMQ worker runs on each attempt

    expect((await WebhookEvent.findOne({ eventId: 'evt_q2' })).status).toBe('PROCESSED');
    expect((await Booking.findById(bookingId)).status).toBe('CONFIRMED');
  });

  test('a provider redelivery while a retry is pending is a no-op (no second job, no reprocessing)', async () => {
    const spy = jest.spyOn(jobs, 'enqueueWebhookRetry').mockResolvedValue(true);
    const body = { eventId: 'evt_q3', providerTransactionId: 'sim_nope', status: 'SUCCESS' };

    await hook(body);
    const again = await hook(body);

    expect(again.status).toBe(202);
    expect(again.body.message).toMatch(/in progress/i);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await WebhookEvent.findOne({ eventId: 'evt_q3' })).attempts).toBe(1);
  });

  test('a STALE unfinished event is taken over by a provider redelivery and applied', async () => {
    jest.spyOn(jobs, 'enqueueWebhookRetry').mockResolvedValue(true);
    const { bookingId, payment } = await pendingPayment();
    // Event was recorded as failed earlier, its retry job got lost, and time passed.
    await WebhookEvent.create({
      eventId: 'evt_stale', status: 'FAILED', attempts: 1, lastError: 'transient',
      payload: { eventId: 'evt_stale', providerTransactionId: payment.providerTransactionId, status: 'SUCCESS' },
    });
    await backdateEvent('evt_stale', HOUR);

    const res = await hook({ eventId: 'evt_stale', providerTransactionId: payment.providerTransactionId, status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect((await Booking.findById(bookingId)).status).toBe('CONFIRMED');
    expect((await WebhookEvent.findOne({ eventId: 'evt_stale' })).status).toBe('PROCESSED');
  });

  test('a dead-lettered event is acknowledged (200) but never re-applied', async () => {
    const { bookingId, payment } = await pendingPayment();
    await WebhookEvent.create({
      eventId: 'evt_dead', status: 'DEAD', attempts: 5, lastError: 'gave up',
      payload: { eventId: 'evt_dead', providerTransactionId: payment.providerTransactionId, status: 'SUCCESS' },
    });

    const res = await hook({ eventId: 'evt_dead', providerTransactionId: payment.providerTransactionId, status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/dead-lettered/i);
    expect((await Booking.findById(bookingId)).status).toBe('PENDING');
  });
});
