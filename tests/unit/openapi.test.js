const spec = require('../../src/docs/openapi');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const operations = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const m of METHODS) if (item[m]) operations.push({ path, method: m, op: item[m], item });
}

function collectRefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') out.push(v); else collectRefs(v, out);
    }
  }
  return out;
}

describe('OpenAPI spec', () => {
  test('every $ref resolves to a defined schema', () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) {
      const name = r.replace('#/components/schemas/', '');
      expect(spec.components.schemas[name]).toBeDefined();
    }
  });

  test.each(operations.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]))('%s is fully described', (_label, { op }) => {
    expect(op.summary).toBeTruthy();
    expect(Object.keys(op.responses).length).toBeGreaterThan(0);
  });

  test.each(operations.filter((o) => o.op.security).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]))(
    '%s (secured) documents a 401',
    (_label, { op }) => { expect(op.responses[401]).toBeDefined(); }
  );

  test('every {pathParam} is declared as a parameter', () => {
    for (const { path, op, item } of operations) {
      const declared = [...(item.parameters || []), ...(op.parameters || [])].filter((p) => p.in === 'path').map((p) => p.name);
      const used = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const u of used) expect(declared).toContain(u);
    }
  });

  test('operations that take a body declare a requestBody', () => {
    for (const { method, op } of operations) {
      if (['post', 'patch'].includes(method) && !/cancel/.test(op.summary.toLowerCase()) && !/me/.test(op.summary.toLowerCase())) {
        // every write endpoint here (except cancel) takes JSON
        expect(op.requestBody).toBeDefined();
      }
    }
  });
});
