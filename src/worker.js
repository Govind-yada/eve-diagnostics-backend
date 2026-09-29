
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { isRedisConfigured, closeRedis } = require('./config/redis');
const { startJobs, stopJobs } = require('./jobs');
const logger = require('./utils/logger');

async function main() {
  if (!isRedisConfigured()) {
    logger.error('REDIS_URL is required to run the worker');
    process.exit(1);
  }
  await connectDB(process.env.MONGO_URI);
  await startJobs();

  const shutdown = async (signal) => {
    logger.info(`${signal} received, stopping worker...`);
    await stopJobs().catch(() => { });
    await closeRedis().catch(() => { });
    await mongoose.disconnect().catch(() => { });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
