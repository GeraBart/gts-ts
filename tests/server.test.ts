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
