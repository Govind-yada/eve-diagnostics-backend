// Populates the database with a couple of centres/tests and an admin user
// for quick manual testing. Run with: npm run seed
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Centre = require('../models/Centre');
const DiagnosticTest = require('../models/DiagnosticTest');
const logger = require('./logger');

async function seed() {
  await connectDB(process.env.MONGO_URI);

  await Promise.all([User.deleteMany({}), Centre.deleteMany({}), DiagnosticTest.deleteMany({})]);

  const admin = await User.create({
    name: 'Admin',
    email: 'admin@eve.health',
    password: 'admin123',
    role: 'admin',
  });

  const centre = await Centre.create({
    name: 'EVE Diagnostics — Koramangala',
    location: { address: '80 Feet Road', city: 'Bengaluru', state: 'KA', pincode: '560095' },
  });

  const tests = await DiagnosticTest.insertMany([
    { centre: centre._id, name: 'Complete Blood Count (CBC)', price: 350 },
    { centre: centre._id, name: 'Lipid Profile', price: 700 },
    { centre: centre._id, name: 'Thyroid Panel (T3 T4 TSH)', price: 550 },
  ]);

  logger.info({ admin: admin.email, centre: centre.name, tests: tests.length }, 'Seed complete');
  process.exit(0);
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
