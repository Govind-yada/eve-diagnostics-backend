const { app, request, createCentreWithTest } = require('./helpers');

describe('Centres & Tests', () => {
  test('lists centres with pagination metadata', async () => {
    await createCentreWithTest();
    await createCentreWithTest();

    const res = await request(app).get('/api/centres?page=1&limit=1');
    expect(res.status).toBe(200);
    expect(res.body.data.centres).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  test('getting a single centre includes its tests', async () => {
    const { centre } = await createCentreWithTest(999);
    const res = await request(app).get(`/api/centres/${centre._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tests[0].price).toBe(999);
  });

  test('returns 404 for a non-existent centre', async () => {
    const res = await request(app).get('/api/centres/64b6f0f0f0f0f0f0f0f0f0f0');
    expect(res.status).toBe(404);
  });

  test('rejects a malformed centre id with 400 (invalid ObjectId -> CastError)', async () => {
    const res = await request(app).get('/api/centres/not-a-valid-id');
    expect(res.status).toBe(400);
  });
});
