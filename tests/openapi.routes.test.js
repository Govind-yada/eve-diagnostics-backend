const { app, request } = require('./helpers');
const spec = require('../src/docs/openapi');

const METHODS = ['get', 'post', 'patch', 'put', 'delete'];
const documented = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const m of METHODS) if (item[m]) documented.push(`${m.toUpperCase()} /api${path}`);
}

function mountPath(layer) {
  const m = layer.regexp.source.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/);
  return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
}
function registeredRoutes() {
  const out = [];
  for (const layer of app._router.stack) {
    if (layer.name !== 'router') continue;
    const base = mountPath(layer);
    if (!base.startsWith('/api/')) continue;
    for (const sub of layer.handle.stack) {
      if (!sub.route) continue;
      const suffix = sub.route.path === '/' ? '' : sub.route.path.replace(/:(\w+)/g, '{$1}');
      for (const method of Object.keys(sub.route.methods)) out.push(`${method.toUpperCase()} ${base}${suffix}`);
    }
  }
  return out;
}

describe('API documentation matches the real routes', () => {
  test('every registered route is documented, and every documented operation is registered', () => {
    const real = registeredRoutes().sort();
    expect(real.length).toBeGreaterThan(10);
    expect(real).toEqual([...documented].sort());
  });

  test.each(documented)('%s is reachable (not a "Route not found" 404)', async (line) => {
    const [method, path] = line.split(' ');
    const url = path.replace(/\{[^}]+\}/g, '64b6f0f0f0f0f0f0f0f0f0f0');
    const res = await request(app)[method.toLowerCase()](url).send({});
    expect(res.status === 404 && /^Route not found/.test(res.body.message || '')).toBe(false);
  });

  test('GET /api-docs.json serves the spec', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toEqual(Object.keys(spec.paths));
  });
});
