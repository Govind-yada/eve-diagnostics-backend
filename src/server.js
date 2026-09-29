require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const { initRedis, closeRedis } = require('./config/redis');
const { startJobs, stopJobs } = require('./jobs');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB(process.env.MONGO_URI);
    await initRedis(); // optional: enables caching when REDIS_URL is set
    // Workers run inside the API process by default; set RUN_JOBS_IN_API=false
    // and run `npm run worker` as a separate process to scale them independently.
    if (process.env.RUN_JOBS_IN_API !== 'false') await startJobs();

    const server = app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`);
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await stopJobs().catch(() => {});
        await closeRedis().catch(() => {});
        await mongoose.disconnect().catch(() => {});
        process.exit(0);
      });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
