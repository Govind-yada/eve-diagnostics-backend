const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');

describe('Bookings', () => {
  test('an authenticated user can book a test; amount snapshots the test price', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest(750);

    const res = await createBooking(token, test._id);
    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('PENDING');
    expect(res.body.data.booking.amount).toBe(750);
  });

  test('rejects booking with a past appointment date', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ testId: test._id, appointmentDate: new Date(Date.now() - 86400000).toISOString() });

    expect(res.status).toBe(400);
  });

  test('rejects booking for a non-existent test', async () => {
    const { token } = await registerAndLogin();
    const res = await createBooking(token, '64b6f0f0f0f0f0f0f0f0f0f0');
    expect(res.status).toBe(404);
  });

  test('unauthenticated booking attempt is rejected', async () => {
    const { test } = await createCentreWithTest();
    const res = await request(app)
      .post('/api/bookings')
      .send({ testId: test._id, appointmentDate: new Date(Date.now() + 86400000).toISOString() });
    expect(res.status).toBe(401);
  });

  test("a user cannot view another user's booking", async () => {
    const owner = await registerAndLogin();
    const stranger = await registerAndLogin();
    const { test } = await createCentreWithTest();

    const bookingRes = await createBooking(owner.token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  test('a PENDING booking can be cancelled by its owner', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('CANCELLED');
  });

  test('a CANCELLED booking cannot be cancelled again', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    const bookingRes = await createBooking(token, test._id);
    const bookingId = bookingRes.body.data.booking._id;

    await request(app).patch(`/api/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`);
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  test('listing my bookings supports pagination and status filter', async () => {
    const { token } = await registerAndLogin();
    const { test } = await createCentreWithTest();
    await createBooking(token, test._id);
    await createBooking(token, test._id, new Date(Date.now() + 2 * 86400000));

    const res = await request(app)
      .get('/api/bookings/me?status=PENDING&limit=1&page=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.bookings).toHaveLength(1);
    expect(res.body.pagination.total).toBe(2);
  });
});
