const { Queue } = require('bullmq');
const { isRedisConfigured, createBullConnection } = require('../config/redis');
const logger = require('../utils/logger');

const WEBHOOK_QUEUE = 'webhook-retry';
const MAINTENANCE_QUEUE = 'maintenance';

let queues = null;

// Queues exist only when Redis is configured. Callers treat `null`/`false`
// as "no background processing available" and fall back to inline behaviour.
function getQueues() {
  if (!isRedisConfigured()) return null;
  if (!queues) {
    const connection = createBullConnection();
    queues = {
      connection,
      webhook: new Queue(WEBHOOK_QUEUE, { connection }),
      maintenance: new Queue(MAINTENANCE_QUEUE, { connection }),
    };
  }
  return queues;
}

// Schedules a server-side retry with exponential backoff. Returns true if the
// job was accepted, false if there is no queue (or Redis rejected it).
// jobId = eventId so scheduling the same event twice never creates two jobs.
async function enqueueWebhookRetry(eventId) {
  const q = getQueues();
  if (!q) return false;
  try {
    await q.webhook.add(
      'retry-webhook',
      { eventId },
      {
        jobId: `webhook-retry-${String(eventId).replace(/:/g, '_')}`, // BullMQ forbids ':' in custom ids
        attempts: Number(process.env.WEBHOOK_RETRY_ATTEMPTS || 5),
        backoff: { type: 'exponential', delay: Number(process.env.WEBHOOK_RETRY_BASE_DELAY_MS || 2000) },
        removeOnComplete: true,
        removeOnFail: 500,
      }
    );
    return true;
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'Could not enqueue webhook retry');
    return false;
  }
}

// Repeating housekeeping job (see reconcile.js). Upserting makes this idempotent across restarts.
async function scheduleReconciliation() {
  const q = getQueues();
  if (!q) return false;
  const every = Number(process.env.RECONCILE_INTERVAL_SECONDS || 300) * 1000;
  await q.maintenance.upsertJobScheduler('reconcile-schedule', { every }, { name: 'reconcile' });
  return true;
}

async function closeQueues() {
  if (!queues) return;
  const q = queues;
  queues = null;
  await Promise.all([q.webhook.close(), q.maintenance.close()]);
  await q.connection.quit().catch(() => q.connection.disconnect());
}

module.exports = {
  WEBHOOK_QUEUE,
  MAINTENANCE_QUEUE,
  getQueues,
  enqueueWebhookRetry,
  scheduleReconciliation,
  closeQueues,
};
