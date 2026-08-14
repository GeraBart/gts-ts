import { GTS } from '../src';

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';

/**
 * OP#13 - trait merge and completeness (spec §9.7.5, ADR-0002/0003/0004).
 *
 * The document-level trait keywords always sit at the schema top level, so the
 * helpers below place them there rather than inside the `allOf` overlay.
 */
function baseType(id: string, topLevel: Record<string, any> = {}) {
  return {
    $$id: id,
    $$schema: DRAFT7,
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    ...topLevel,
  };
}

function derivedType(id: string, baseId: string, topLevel: Record<string, any> = {}) {
  return {
    $$id: id,
    $$schema: DRAFT7,
    type: 'object',
    allOf: [{ $$ref: `gts://${baseId}` }, { type: 'object' }],
    ...topLevel,
  };
}

describe('OP#13 - trait value merge is RFC 7396 JSON Merge Patch', () => {
  test('null deletes an inherited value, and the schema default re-applies', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.nulldef.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: { retention: { type: 'string', default: 'P7D' } },
          required: ['retention'],
        },
        'x-gts-traits': { retention: 'P30D' },
      })
    );
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { retention: null } }));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('null deleting a required trait with no default fails for a concrete type', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.nullreq.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: { topicRef: { type: 'string' } },
          required: ['topicRef'],
        },
        'x-gts-traits': { topicRef: 'events' },
      })
    );
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { topicRef: null } }));

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('object-valued traits merge recursively, preserving keys the descendant omits', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.nested.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: {
            routing: {
              type: 'object',
              properties: { topic: { type: 'string' }, partitionKey: { type: 'string' } },
              required: ['topic', 'partitionKey'],
            },
          },
          required: ['routing'],
        },
        'x-gts-traits': { routing: { topic: 'events', partitionKey: 'userId' } },
      })
    );
    // Overrides only `topic`; `partitionKey` must survive or `required` fails.
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { routing: { topic: 'orders' } } }));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('arrays replace wholesale rather than concatenating', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.arr.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    // maxItems 3 admits the base value and the descendant value, but not a
    // concatenation of the two - so passing proves replacement.
    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
          required: ['tags'],
        },
        'x-gts-traits': { tags: ['a', 'b', 'c'] },
      })
    );
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { tags: ['only'] } }));

    expect(gts.validateEntity(baseId).ok).toBe(true);
    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('a descendant may restate an inherited value idempotently', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.idem.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: { retention: { type: 'string' } },
          required: ['retention'],
        },
        'x-gts-traits': { retention: 'P30D' },
      })
    );
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { retention: 'P30D' } }));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });
});

describe('OP#13 - locking is `const`, not a bespoke immutability rule (ADR-0004)', () => {
  const schemaWithLock = {
    type: 'object',
    properties: { indexed: { type: 'boolean', const: true }, topicRef: { type: 'string' } },
    required: ['indexed'],
  };

  test('a descendant overriding a const-locked trait fails', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.lock.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId, { 'x-gts-traits-schema': schemaWithLock, 'x-gts-traits': { indexed: true } }));
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { indexed: false } }));

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('a descendant may freely override a trait that is not locked', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.free.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': schemaWithLock,
        'x-gts-traits': { indexed: true, topicRef: 'audit' },
      })
    );
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { topicRef: 'notification' } }));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });
});

describe('OP#13 - completeness is keyed on x-gts-abstract (ADR-0003)', () => {
  const requiresPriority = {
    'x-gts-traits-schema': {
      type: 'object',
      properties: { priority: { type: 'integer' } },
      required: ['priority'],
    },
  };

  test('a concrete type with an unresolved required trait fails', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.concrete.v1~';
    gts.register(baseType(baseId, requiresPriority));

    expect(gts.validateEntity(baseId).ok).toBe(false);
  });

  test('an abstract type with the same unresolved trait passes', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.abstract.v1~';
    gts.register(baseType(baseId, { ...requiresPriority, 'x-gts-abstract': true }));

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });

  test('a concrete descendant of an abstract base must close the gap', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.closegap.v1~';
    const openKid = `${baseId}x.unit._.open.v1~`;
    const closedKid = `${baseId}x.unit._.closed.v1~`;

    gts.register(baseType(baseId, { ...requiresPriority, 'x-gts-abstract': true }));
    gts.register(derivedType(openKid, baseId));
    gts.register(derivedType(closedKid, baseId, { 'x-gts-traits': { priority: 5 } }));

    expect(gts.validateEntity(openKid).ok).toBe(false);
    expect(gts.validateEntity(closedKid).ok).toBe(true);
  });

  test('a trait-schema default satisfies the completeness check', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.default.v1~';
    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: { priority: { type: 'integer', default: 3 } },
          required: ['priority'],
        },
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });
});

describe('OP#13 - boolean trait schemas (ADR-0002)', () => {
  test('`false` permits a descendant that declares no traits', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.false.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId, { 'x-gts-traits-schema': false }));
    gts.register(derivedType(kidId, baseId));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('`false` rejects any descendant that declares traits', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.falsetr.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId, { 'x-gts-traits-schema': false }));
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { retention: 'P30D' } }));

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('`false` rejects traits on an abstract descendant too', () => {
    // Prohibition bans traits across the whole subtree; it is not a
    // completeness rule, so the abstract exemption must not bypass it.
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.falseabs.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId, { 'x-gts-traits-schema': false }));
    gts.register(derivedType(kidId, baseId, { 'x-gts-abstract': true, 'x-gts-traits': { retention: 'P30D' } }));

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('`true` permits arbitrary traits', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.true.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId, { 'x-gts-traits-schema': true }));
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { anything: 42, other: 'value' } }));

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('trait values with no trait-schema anywhere in the chain are rejected', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.noschema.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(baseType(baseId));
    gts.register(derivedType(kidId, baseId, { 'x-gts-traits': { retention: 'P30D' } }));

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });
});

describe('OP#13 - the effective trait schema must stay satisfiable', () => {
  test('a descendant may narrow an inherited trait', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.narrow.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'string' } } },
        'x-gts-abstract': true,
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'string', maxLength: 8 } } },
        'x-gts-abstract': true,
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('a descendant redeclaring a trait with a disjoint type fails, even when abstract', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.conflict.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'string' } } },
        'x-gts-abstract': true,
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'integer' } } },
        'x-gts-abstract': true,
      })
    );

    // Satisfiability is a property of the composed schema, so the abstract
    // exemption (which covers completeness only) does not hide it.
    const result = gts.validateEntity(kidId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot be satisfied/);
  });

  test('sibling allOf branches may reference the same trait schema', () => {
    // Cycle detection tracks the active recursion path; two siblings pointing
    // at one common trait schema is reuse, not recursion.
    const gts = new GTS({ validateRefs: false });
    const commonId = 'gts.x.unit.tr.common.v1~';
    const baseId = 'gts.x.unit.tr.siblings.v1~';

    gts.register(baseType(commonId, { type: 'object', properties: { k: { type: 'string' } } }));
    gts.register(
      baseType(baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { allOf: [{ $$ref: `gts://${commonId}` }, { $$ref: `gts://${commonId}` }] },
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });

  test('a genuinely recursive trait schema is still rejected', () => {
    const gts = new GTS({ validateRefs: false });
    const selfId = 'gts.x.unit.tr.selfref.v1~';

    gts.register(baseType(selfId, { 'x-gts-traits-schema': { $$ref: `gts://${selfId}` } }));

    expect(gts.validateEntity(selfId).ok).toBe(false);
  });

  test('abstract types are not exempt from an impossible const across the chain', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.constclash.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { k: { const: 'a' } } },
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { k: { const: 'b' } } },
      })
    );

    const result = gts.validateEntity(kidId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no value satisfies/);
  });

  test('abstract types are not exempt from crossed bounds across the chain', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.boundclash.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { n: { type: 'integer', minimum: 10 } } },
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { n: { type: 'integer', maximum: 5 } } },
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('exclusive and inclusive bounds that cross are detected', () => {
    // `exclusiveMinimum: 10` and `maximum: 10` share no value; comparing raw
    // minimum against raw maximum missed it.
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.exclbound.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', required: ['n'], properties: { n: { exclusiveMinimum: 10 } } },
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', required: ['n'], properties: { n: { maximum: 10 } } },
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('bounds that merely narrow are still satisfiable', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.okbound.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { n: { minimum: 0, maximum: 100 } } },
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-abstract': true,
        'x-gts-traits-schema': { type: 'object', properties: { n: { minimum: 10, maximum: 20 } } },
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });

  test('defaults nested under an object trait are materialized', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.nesteddefault.v1~';

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          required: ['routing'],
          properties: {
            routing: {
              type: 'object',
              required: ['topic'],
              properties: { topic: { type: 'string', default: 'orders' } },
            },
          },
        },
        'x-gts-traits': { routing: {} },
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });

  test('an optional trait object with a partly-defaulted subtree stays absent', () => {
    // ADR-0003 licenses materializing declared defaults, not inventing values.
    // Conjuring an absent *optional* object validates a subtree the author never
    // supplied, which rejected a type that is legitimately silent there.
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.optsubtree.v1~';

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          properties: {
            routing: {
              type: 'object',
              required: ['topic', 'partitionKey'],
              properties: { topic: { type: 'string', default: 'orders' }, partitionKey: { type: 'string' } },
            },
          },
        },
        'x-gts-traits': {},
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });

  test('a required trait object is materialized from its subtree defaults', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.reqsubtree.v1~';

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          required: ['routing'],
          properties: {
            routing: {
              type: 'object',
              required: ['topic'],
              properties: { topic: { type: 'string', default: 'orders' } },
            },
          },
        },
        'x-gts-traits': {},
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(true);
  });

  test('a required trait object whose subtree cannot be completed still fails', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.reqgap.v1~';

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          required: ['routing'],
          properties: {
            routing: {
              type: 'object',
              required: ['topic', 'key'],
              properties: { topic: { type: 'string', default: 'orders' }, key: { type: 'string' } },
            },
          },
        },
        'x-gts-traits': {},
      })
    );

    expect(gts.validateEntity(baseId).ok).toBe(false);
  });

  test('a closed descendant trait-schema must not orphan an ancestor trait', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.orphan.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'string' } } },
        'x-gts-abstract': true,
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          additionalProperties: false,
          properties: { topicRef: { type: 'string' } },
        },
        'x-gts-abstract': true,
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(false);
  });

  test('restating the ancestor trait makes the closed descendant valid', () => {
    const gts = new GTS({ validateRefs: false });
    const baseId = 'gts.x.unit.tr.restate.v1~';
    const kidId = `${baseId}x.unit._.kid.v1~`;

    gts.register(
      baseType(baseId, {
        'x-gts-traits-schema': { type: 'object', properties: { retention: { type: 'string' } } },
        'x-gts-abstract': true,
      })
    );
    gts.register(
      derivedType(kidId, baseId, {
        'x-gts-traits-schema': {
          type: 'object',
          additionalProperties: false,
          properties: { retention: { type: 'string' }, topicRef: { type: 'string' } },
        },
        'x-gts-abstract': true,
      })
    );

    expect(gts.validateEntity(kidId).ok).toBe(true);
  });
});
