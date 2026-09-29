const { getRedis } = require('../config/redis');
const logger = require('./logger');

const PREFIX = 'eve:';
const DEFAULT_TTL_SECONDS = () => Number(process.env.CACHE_TTL_SECONDS || 60);

// Every helper FAILS OPEN: if Redis is missing, down, or errors, we behave as
// a cache miss / no-op. Caching is an optimisation, never a dependency.

async function get(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache get failed — treating as miss');
    return null;
  }
}

async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS()) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
    return true;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache set failed — ignoring');
    return false;
  }
}

async function exists(key) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.exists(PREFIX + key)) === 1;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache exists failed — treating as miss');
    return false;
  }
}

// Deletes every key under a prefix (used to invalidate a whole family of
// cached list/detail responses after an admin write).
async function delPrefix(prefix) {
  const redis = getRedis();
  if (!redis) return 0;
  let removed = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIX}${prefix}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length) removed += await redis.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.warn({ err: err.message, prefix }, 'cache invalidation failed — entries expire via TTL');
  }
  return removed;
}

// Read-through helper. Errors thrown by the loader propagate and are never cached.
async function cached(key, ttlSeconds, loader) {
  const hit = await get(key);
  if (hit !== null) return { data: hit, hit: true };
  const data = await loader();
  await set(key, data, ttlSeconds);
  return { data, hit: false };
}

module.exports = { get, set, exists, delPrefix, cached };
