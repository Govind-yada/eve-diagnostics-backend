const Redis = require('ioredis');
const logger = require('../utils/logger');

let client = null;

// Redis is OPTIONAL. Without REDIS_URL the cache is a no-op and background
// jobs are disabled — the API keeps working exactly as before.
const isRedisConfigured = () => Boolean(process.env.REDIS_URL);

// Shared client used for caching. Commands fail fast (no offline queue) when
// Redis is unreachable so a Redis outage can never slow down or break requests.
function getRedis() {
  if (!isRedisConfigured()) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    client.on('error', (err) => logger.warn({ err: err.message }, 'Redis error — cache is failing open'));
  }
  return client;
}

// Resolves once the cache connection is ready (or after timeoutMs, whichever first).
async function initRedis(timeoutMs = 2000) {
  const redis = getRedis();
  if (!redis || redis.status === 'ready') return redis;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    redis.once('ready', () => { clearTimeout(timer); resolve(); });
  });
  return redis;
}

// BullMQ requires its own connections with maxRetriesPerRequest: null.
function createBullConnection() {
  return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
}

async function closeRedis() {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit().catch(() => c.disconnect());
}

module.exports = { isRedisConfigured, getRedis, initRedis, createBullConnection, closeRedis };
