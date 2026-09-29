const { Worker } = require('bullmq');
const { createBullConnection } = require('../config/redis');
const logger = require('../utils/logger');
const { WEBHOOK_QUEUE, MAINTENANCE_QUEUE } = require('./queues');
const { processStoredEvent, markDead } = require('../services/webhookService');
const { reconcile } = require('./reconcile');

function startWorkers() {
  const connections = [createBullConnection(), createBullConnection()];
  const webhookWorker = new Worker(
    WEBHOOK_QUEUE,
    async (job) => { await processStoredEvent(job.data.eventId); },
    { connection: connections[0], concurrency: 5 }
  );
  webhookWorker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await markDead(job.data.eventId, err).catch((e) => logger.error({ err: e.message }, 'markDead failed'));
    } else if (job) {
      logger.warn({ eventId: job.data.eventId, attempt: job.attemptsMade, err: err.message }, 'Webhook retry failed; will back off');
    }
  });
  webhookWorker.on('error', (err) => logger.warn({ err: err.message }, 'webhook worker error'));

  const maintenanceWorker = new Worker(MAINTENANCE_QUEUE, async () => reconcile(), {
    connection: connections[1],
  });
  maintenanceWorker.on('error', (err) => logger.warn({ err: err.message }, 'maintenance worker error'));

  return { webhookWorker, maintenanceWorker, connections };
}

async function stopWorkers(workers) {
  if (!workers) return;
  await Promise.all([workers.webhookWorker.close(), workers.maintenanceWorker.close()]);
  await Promise.all(workers.connections.map((c) => c.quit().catch(() => c.disconnect())));
}

module.exports = { startWorkers, stopWorkers };
