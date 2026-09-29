const mongoose = require('mongoose');

let mongoServer;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.PAYMENT_SUCCESS_RATE = '1'; // deterministic: always succeed unless overridden per-test
  process.env.NODE_ENV = 'test';

  if (process.env.MONGO_TEST_URI) {
    // Use an externally provided MongoDB (docker, CI service container, etc.).
    await mongoose.connect(process.env.MONGO_TEST_URI);
  } else {
    // Default: ephemeral in-memory MongoDB (downloads a mongod binary on first run).
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});
