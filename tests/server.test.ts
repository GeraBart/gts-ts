import { GtsServer } from '../src/server/server';

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';

describe('POST /type-schemas', () => {
  test('rejects a type_id that does not end with the required "~" (spec 2.1 / 11.1 Rule C.1)', async () => {
    const server = new GtsServer({ host: '127.0.0.1', port: 0, verbose: 0 });

    const response = await server.instance.inject({
      method: 'POST',
      url: '/type-schemas',
      payload: {
        // Missing the trailing '~' that a GTS Type Identifier must have.
        type_id: 'gts.x.unit.srv.notype.v1',
        type_schema: { $$schema: DRAFT7, type: 'object' },
      },
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/type_id/);

    await server.stop();
  });

  test('accepts a well-formed type_id ending with "~"', async () => {
    const server = new GtsServer({ host: '127.0.0.1', port: 0, verbose: 0 });

    const response = await server.instance.inject({
      method: 'POST',
      url: '/type-schemas',
      payload: {
        type_id: 'gts.x.unit.srv.goodtype.v1~',
        type_schema: { $$schema: DRAFT7, type: 'object' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);

    await server.stop();
  });
});

describe('GET /openapi', () => {
  test('documents every route actually registered on the server', async () => {
    const server = new GtsServer({ host: '127.0.0.1', port: 0, verbose: 0 });
    await server.instance.ready();

    // Fastify (v5) does not expose a plain list-of-routes API: `printRoutes()`
    // only returns a pretty-printed tree, and `hasRoute()` checks one route
    // at a time. So this list is hard-coded and MUST be kept in sync with the
    // `this.fastify.get/post(...)` calls in `GtsServer.registerRoutes()`
    // (src/server/server.ts). Each entry is cross-checked against
    // `hasRoute()` below, so a stale entry here fails the test rather than
    // silently drifting from the real route table.
    const registeredRoutes: Array<{ method: 'GET' | 'POST'; url: string; openApiPath: string }> = [
      { method: 'GET', url: '/health', openApiPath: '/health' },
      { method: 'GET', url: '/entities', openApiPath: '/entities' },
      { method: 'POST', url: '/entities', openApiPath: '/entities' },
      { method: 'GET', url: '/entities/:id', openApiPath: '/entities/{id}' },
      { method: 'POST', url: '/entities/bulk', openApiPath: '/entities/bulk' },
      { method: 'POST', url: '/type-schemas', openApiPath: '/type-schemas' },
      { method: 'GET', url: '/validate-id', openApiPath: '/validate-id' },
      { method: 'POST', url: '/extract-id', openApiPath: '/extract-id' },
      { method: 'GET', url: '/parse-id', openApiPath: '/parse-id' },
      { method: 'GET', url: '/match-id-pattern', openApiPath: '/match-id-pattern' },
      { method: 'GET', url: '/uuid', openApiPath: '/uuid' },
      { method: 'POST', url: '/validate-instance', openApiPath: '/validate-instance' },
      { method: 'GET', url: '/resolve-relationships', openApiPath: '/resolve-relationships' },
      { method: 'GET', url: '/compatibility', openApiPath: '/compatibility' },
      { method: 'POST', url: '/cast', openApiPath: '/cast' },
      { method: 'GET', url: '/query', openApiPath: '/query' },
      { method: 'GET', url: '/attr', openApiPath: '/attr' },
      { method: 'POST', url: '/validate-type-schema', openApiPath: '/validate-type-schema' },
      { method: 'POST', url: '/validate-entity', openApiPath: '/validate-entity' },
      { method: 'GET', url: '/openapi', openApiPath: '/openapi' },
    ];

    for (const route of registeredRoutes) {
      expect(server.instance.hasRoute({ method: route.method, url: route.url })).toBe(true);
    }

    const response = await server.instance.inject({ method: 'GET', url: '/openapi' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const paths = body.paths;

    for (const route of registeredRoutes) {
      expect(paths).toHaveProperty(route.openApiPath);
    }

    // Regression: the reported version must track package.json, not a
    // hard-coded literal that can drift from the published version.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(body.info.version).toBe(require('../package.json').version);

    await server.stop();
  });
});
