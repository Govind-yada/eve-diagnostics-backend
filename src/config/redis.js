const Redis = require('ioredis');
const logger = require('../utils/logger');

let client = null;

const isRedisConfigured = () => Boolean(process.env.REDIS_URL);

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

async function initRedis(timeoutMs = 2000) {
  const redis = getRedis();
  if (!redis || redis.status === 'ready') return redis;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    redis.once('ready', () => { clearTimeout(timer); resolve(); });
  });
  return redis;
}

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
