const { app, request } = require('./helpers');

describe('Auth', () => {
  test('signup creates a user and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Alice',
      email: 'alice@test.com',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('alice@test.com');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('signup rejects duplicate email', async () => {
    await request(app).post('/api/auth/signup').send({
      name: 'Alice',
      email: 'dupe@test.com',
      password: 'password123',
    });
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Alice 2',
      email: 'dupe@test.com',
      password: 'password123',
    });
    expect(res.status).toBe(409);
  });

  test('signup rejects invalid input (short password)', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Bob',
      email: 'bob@test.com',
      password: '123',
    });
    expect(res.status).toBe(400);
  });

  test('login succeeds with correct credentials', async () => {
    await request(app).post('/api/auth/signup').send({
      name: 'Carol',
      email: 'carol@test.com',
      password: 'password123',
    });
    const res = await request(app).post('/api/auth/login').send({
      email: 'carol@test.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  test('login fails with wrong password', async () => {
    await request(app).post('/api/auth/signup').send({
      name: 'Dave',
      email: 'dave@test.com',
      password: 'password123',
    });
    const res = await request(app).post('/api/auth/login').send({
      email: 'dave@test.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  test('protected route rejects requests with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('protected route rejects an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage.token.here');
    expect(res.status).toBe(401);
  });
});
