const { app, request, registerAndLogin, createCentreWithTest, createBooking } = require('./helpers');
const User = require('../src/models/User');

// The auth middleware loads the user from the DB on every request, so
// promoting a user in the DB takes effect for their existing token.
async function adminToken() {
  const { token, user } = await registerAndLogin();
  await User.updateOne({ _id: user._id }, { role: 'admin' });
  return token;
}

const centreBody = { name: 'Admin Centre', location: { address: '2 Side St', city: 'Pune' } };

describe('Centre & test management (admin)', () => {
  test('a patient cannot create a centre (403)', async () => {
    const { token } = await registerAndLogin();
    const res = await request(app).post('/api/centres').set('Authorization', `Bearer ${token}`).send(centreBody);
    expect(res.status).toBe(403);
  });

  test('anonymous users cannot create a centre (401)', async () => {
    const res = await request(app).post('/api/centres').send(centreBody);
    expect(res.status).toBe(401);
  });

  test('an admin can create a centre and add a test to it', async () => {
    const token = await adminToken();
    const c = await request(app).post('/api/centres').set('Authorization', `Bearer ${token}`).send(centreBody);
    expect(c.status).toBe(201);

    const t = await request(app)
      .post(`/api/centres/${c.body.data.centre._id}/tests`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lipid Profile', price: 700 });
    expect(t.status).toBe(201);
    expect(t.body.data.test.price).toBe(700);
  });

  test('rejects a negative test price (400)', async () => {
    const token = await adminToken();
    const { centre } = await createCentreWithTest();
    const res = await request(app)
      .post(`/api/centres/${centre._id}/tests`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', price: -5 });
    expect(res.status).toBe(400);
  });

  test('changing a test price does NOT change the amount of an existing booking', async () => {
    const admin = await adminToken();
    const { token } = await registerAndLogin();
    const { centre, test } = await createCentreWithTest(500);
    const booking = await createBooking(token, test._id);

    const upd = await request(app)
      .patch(`/api/centres/${centre._id}/tests/${test._id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ price: 900 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.test.price).toBe(900);

    const got = await request(app)
      .get(`/api/bookings/${booking.body.data.booking._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(got.body.data.booking.amount).toBe(500);
  });

  test('deleting a centre soft-deletes it and hides it from the public list', async () => {
    const admin = await adminToken();
    const { centre } = await createCentreWithTest();
    const del = await request(app).delete(`/api/centres/${centre._id}`).set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/centres');
    expect(list.body.data.centres).toHaveLength(0);
  });

  test('a patient cannot update or delete a test (403)', async () => {
    const { token } = await registerAndLogin();
    const { centre, test } = await createCentreWithTest();
    const patch = await request(app)
      .patch(`/api/centres/${centre._id}/tests/${test._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1 });
    const del = await request(app)
      .delete(`/api/centres/${centre._id}/tests/${test._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(patch.status).toBe(403);
    expect(del.status).toBe(403);
  });

  test('city filter treats input literally (regex metacharacters do not match everything)', async () => {
    await createCentreWithTest(); // city: Testville
    const res = await request(app).get('/api/centres').query({ city: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.data.centres).toHaveLength(0);

    const ok = await request(app).get('/api/centres').query({ city: 'testville' });
    expect(ok.body.data.centres).toHaveLength(1);
  });
});
