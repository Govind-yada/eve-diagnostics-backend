const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const WebhookEvent = require('../src/models/WebhookEvent');

describe('Payments — synchronous simulation', () => {
  test('successful payment confirms the booking (PAYMENT_SUCCESS_RATE=1 in test env)', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('SUCCESS');
    expect(res.body.data.booking.status).toBe('CONFIRMED');
  });

  test('a forced-failure payment marks the booking FAILED, not CONFIRMED', async () => {
    process.env.PAYMENT_SUCCESS_RATE = '0';
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId });

    expect(res.status).toBe(402);
    expect(res.body.data.payment.status).toBe('FAILED');
    expect(res.body.data.booking.status).toBe('FAILED');
    process.env.PAYMENT_SUCCESS_RATE = '1';
  });

  test('cannot pay for a booking that does not belong to you', async () => {
    const owner = await registerAndLogin();
    const stranger = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(owner.token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ bookingId });
    expect(res.status).toBe(403);
  });

  test('cannot pay again for an already-CONFIRMED booking', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({ bookingId });
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId });
    expect(res.status).toBe(409);
  });

  test('cannot pay for a non-existent booking', async () => {
    const { token } = await registerAndLogin();
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId: '64b6f0f0f0f0f0f0f0f0f0f0' });
    expect(res.status).toBe(404);
  });
});

describe('Payment webhook — idempotency (core requirement)', () => {
  async function setupPendingPayment() {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const initRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId, async: true });

    expect(initRes.status).toBe(202);
    return { bookingId, providerTransactionId: initRes.body.data.payment.providerTransactionId };
  }

  test('a webhook SUCCESS event confirms the booking', async () => {
    const { bookingId, providerTransactionId } = await setupPendingPayment();

    const res = await request(app).post('/api/payments/webhook').send({
      eventId: 'evt_1',
      providerTransactionId,
      status: 'SUCCESS',
    });

    expect(res.status).toBe(200);
    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('CONFIRMED');
  });

  test('replaying the exact same webhook event is a no-op (no duplicate side effects)', async () => {
    const { bookingId, providerTransactionId } = await setupPendingPayment();
    const payload = { eventId: 'evt_replay', providerTransactionId, status: 'SUCCESS' };

    const first = await request(app).post('/api/payments/webhook').send(payload);
    const second = await request(app).post('/api/payments/webhook').send(payload);
    const third = await request(app).post('/api/payments/webhook').send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    // Only one WebhookEvent should have been persisted for this eventId.
    const events = await WebhookEvent.find({ eventId: 'evt_replay' });
    expect(events).toHaveLength(1);

    // Only one Payment should exist and it should be SUCCESS exactly once.
    const payments = await Payment.find({ providerTransactionId });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('SUCCESS');

    // Booking should be CONFIRMED, not corrupted by repeated processing.
    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('CONFIRMED');
  });

  test('a webhook cannot override a booking that was already finalized differently', async () => {
    const { bookingId, providerTransactionId } = await setupPendingPayment();

    // First event confirms it.
    await request(app)
      .post('/api/payments/webhook')
      .send({ eventId: 'evt_a', providerTransactionId, status: 'SUCCESS' });

    // A conflicting event (different eventId, same transaction) arrives —
    // e.g. a provider bug. Our Payment-level PENDING guard prevents flip-flop.
    const res = await request(app)
      .post('/api/payments/webhook')
      .send({ eventId: 'evt_b', providerTransactionId, status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already finalized/i);

    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('CONFIRMED'); // unchanged
  });

  test('webhook for an unknown providerTransactionId returns 404', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .send({ eventId: 'evt_unknown', providerTransactionId: 'sim_does_not_exist', status: 'SUCCESS' });
    expect(res.status).toBe(404);
  });

  test('webhook rejects an invalid status value', async () => {
    const { providerTransactionId } = await setupPendingPayment();
    const res = await request(app)
      .post('/api/payments/webhook')
      .send({ eventId: 'evt_bad', providerTransactionId, status: 'MAYBE' });
    expect(res.status).toBe(400);
  });

  test('a failed webhook does not burn the eventId: the provider retry is still processed', async () => {
    const payload = { eventId: 'evt_early', providerTransactionId: 'sim_not_created_yet', status: 'SUCCESS' };

    // Event arrives before the payment exists -> 404, and must NOT be remembered as "processed".
    const first = await request(app).post('/api/payments/webhook').send(payload);
    expect(first.status).toBe(404);
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_early' })).toBe(0);

    // Payment now exists; the provider retries the SAME eventId and it must be applied.
    const { bookingId, providerTransactionId } = await setupPendingPayment();
    const retry = await request(app)
      .post('/api/payments/webhook')
      .send({ ...payload, providerTransactionId });
    expect(retry.status).toBe(200);
    expect((await Booking.findById(bookingId)).status).toBe('CONFIRMED');
  });

  test('a retry heals a half-applied event (payment finalized but booking left PENDING)', async () => {
    const { bookingId, providerTransactionId } = await setupPendingPayment();

    // Simulate a crash between the Payment update and the Booking update.
    await Payment.updateOne({ providerTransactionId }, { status: 'SUCCESS' });
    expect((await Booking.findById(bookingId)).status).toBe('PENDING');

    const res = await request(app)
      .post('/api/payments/webhook')
      .send({ eventId: 'evt_heal', providerTransactionId, status: 'SUCCESS' });
    expect(res.status).toBe(200);
    expect((await Booking.findById(bookingId)).status).toBe('CONFIRMED');
  });

  test('a second payment cannot be started while one is already in progress', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const first = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({ bookingId, async: true });
    const second = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({ bookingId, async: true });
    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(await Payment.countDocuments({ booking: bookingId })).toBe(1);
  });
});
