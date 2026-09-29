jest.mock('../../src/config/redis');
const redisConfig = require('../../src/config/redis');
const cache = require('../../src/utils/cache');

// Minimal in-memory stand-in for the ioredis calls the cache helper uses.
function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return 'OK'; },
    exists: async (k) => (store.has(k) ? 1 : 0),
    scan: async (_cursor, _match, pattern) => {
      const prefix = pattern.slice(0, -1); // strip trailing '*'
      return ['0', [...store.keys()].filter((k) => k.startsWith(prefix))];
    },
    del: async (...keys) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0),
  };
}

// A client whose every command fails, like a Redis outage.
const brokenRedis = () => {
  const boom = async () => { throw new Error('Stream isn\'t writeable'); };
  return { get: boom, set: boom, exists: boom, scan: boom, del: boom };
};

describe('cache helper', () => {
  test('without Redis configured it is a transparent no-op (loader always runs)', async () => {
    redisConfig.getRedis.mockReturnValue(null);
    const loader = jest.fn().mockResolvedValue({ v: 1 });
    const a = await cache.cached('k', 60, loader);
    const b = await cache.cached('k', 60, loader);
    expect(a).toEqual({ data: { v: 1 }, hit: false });
    expect(b.hit).toBe(false);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('read-through: first call MISS runs the loader, second call HIT does not', async () => {
    redisConfig.getRedis.mockReturnValue(fakeRedis());
    const loader = jest.fn().mockResolvedValue({ centres: [1, 2, 3] });
    const first = await cache.cached('centres:list', 60, loader);
    const second = await cache.cached('centres:list', 60, loader);
    expect(first.hit).toBe(false);
    expect(second).toEqual({ data: { centres: [1, 2, 3] }, hit: true });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('errors thrown by the loader propagate and are never cached', async () => {
    const redis = fakeRedis();
    redisConfig.getRedis.mockReturnValue(redis);
    await expect(cache.cached('bad', 60, async () => { throw new Error('404'); })).rejects.toThrow('404');
    expect(redis.store.size).toBe(0);
  });

  test('delPrefix removes only keys under the prefix', async () => {
    const redis = fakeRedis();
    redisConfig.getRedis.mockReturnValue(redis);
    await cache.set('centres:list:1', { a: 1 });
    await cache.set('centres:one:abc', { a: 2 });
    await cache.set('webhook:done:evt', 1);
    const removed = await cache.delPrefix('centres:');
    expect(removed).toBe(2);
    expect(await cache.get('centres:list:1')).toBeNull();
    expect(await cache.exists('webhook:done:evt')).toBe(true);
  });

  test('FAILS OPEN: a Redis outage never throws, it just behaves like a miss', async () => {
    redisConfig.getRedis.mockReturnValue(brokenRedis());
    const loader = jest.fn().mockResolvedValue('fresh');
    await expect(cache.cached('k', 60, loader)).resolves.toEqual({ data: 'fresh', hit: false });
    await expect(cache.set('k', 1)).resolves.toBe(false);
    await expect(cache.exists('k')).resolves.toBe(false);
    await expect(cache.delPrefix('centres:')).resolves.toBe(0);
  });
});
