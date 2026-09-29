const request = require('supertest');
const app = require('../src/app');
const Centre = require('../src/models/Centre');
const DiagnosticTest = require('../src/models/DiagnosticTest');

async function registerAndLogin(overrides = {}) {
  const user = {
    name: 'Test Patient',
    email: `patient_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/signup').send(user);
  return { token: res.body.data.token, user: res.body.data.user };
}

async function createCentreWithTest(price = 500) {
  const centre = await Centre.create({
    name: 'Test Centre',
    location: { address: '1 Main St', city: 'Testville' },
  });
  const test = await DiagnosticTest.create({ centre: centre._id, name: 'CBC', price });
  return { centre, test };
}

async function createBooking(token, testId, appointmentDate = new Date(Date.now() + 86400000)) {
  const res = await request(app)
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ testId, appointmentDate: appointmentDate.toISOString() });
  return res;
}

module.exports = { registerAndLogin, createCentreWithTest, createBooking, app, request };
