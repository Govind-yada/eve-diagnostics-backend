const { isRedisConfigured } = require('../config/redis');
const logger = require('../utils/logger');
const { scheduleReconciliation, closeQueues } = require('./queues');
const { startWorkers, stopWorkers } = require('./workers');

let workers = null;

async function startJobs() {
  if (!isRedisConfigured()) {
    logger.info('REDIS_URL not set — background jobs disabled (webhook retries rely on the provider)');
    return false;
  }
  if (!workers) workers = startWorkers();
  await scheduleReconciliation();
  logger.info('Background workers started (webhook retry + reconciliation)');
  return true;
}

async function stopJobs() {
  await stopWorkers(workers);
  workers = null;
  await closeQueues();
}

module.exports = { startJobs, stopJobs };
