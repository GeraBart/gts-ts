import {
  GTS,
  GtsStore,
  createJsonEntity,
  isValidGtsID,
  validateGtsID,
  parseGtsID,
  matchIDPattern,
  idToUUID,
  extractID,
} from '../src';

describe('GTS Core Operations', () => {
  describe('OP#1 - ID Validation', () => {
    test('validates correct GTS IDs', () => {
      expect(isValidGtsID('gts.vendor.pkg.ns.type.v1~')).toBe(true);
      // v0.7: Single-segment instances are prohibited, must use chained IDs
      expect(isValidGtsID('gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0')).toBe(true);
      // Chained identifiers per spec section 2.2
      expect(isValidGtsID('gts.x.core.events.type.v1~ven.app._.custom_event.v1~')).toBe(true);
      expect(isValidGtsID('gts.x.core.events.topic.v1~ven.app._.custom_event_topic.v1.2')).toBe(true);
    });

    test('rejects invalid GTS IDs', () => {
      expect(isValidGtsID('invalid')).toBe(false);
      expect(isValidGtsID('GTS.vendor.pkg.ns.type.v1~')).toBe(false);
      expect(isValidGtsID('gts.vendor-pkg.ns.type.v1~')).toBe(false);
      expect(isValidGtsID('gts.vendor.pkg.ns.type')).toBe(false);
    });

    test('rejects single-segment instance IDs (v0.7)', () => {
      // Single-segment instance IDs are prohibited in v0.7
      expect(isValidGtsID('gts.vendor.pkg.ns.type.v1.0')).toBe(false);
      expect(isValidGtsID('gts.vendor.pkg.ns.type.v1.2')).toBe(false);
    });

    test('validateGtsID returns detailed validation result', () => {
      const validResult = validateGtsID('gts.vendor.pkg.ns.type.v1~');
      expect(validResult.ok).toBe(true);
      expect(validResult.valid).toBe(true);
      expect(validResult.error).toBe('');

      const invalidResult = validateGtsID('invalid.id');
      expect(invalidResult.ok).toBe(false);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain('Invalid GTS identifier');
    });
  });

  describe('OP#2 - ID Extraction', () => {
    test('extracts GTS ID from instance', () => {
      const instance = {
        gtsId: 'gts.vendor.pkg.ns.type.v1.0',
        name: 'Test Instance',
      };

      const result = extractID(instance);
      expect(result.id).toBe('gts.vendor.pkg.ns.type.v1.0');
      expect(result.is_type_schema).toBe(false);
    });

    test('extracts GTS ID from schema', () => {
      const schema = {
        $$id: 'gts.vendor.pkg.ns.type.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
      };

      const result = extractID(schema);
      expect(result.id).toBe('gts.vendor.pkg.ns.type.v1~');
      expect(result.is_type_schema).toBe(true);
    });

    test('handles GTS URI prefix', () => {
      const schema = {
        $id: 'gts://gts.vendor.pkg.ns.type.v1~',
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      };

      const result = extractID(schema);
      expect(result.id).toBe('gts.vendor.pkg.ns.type.v1~');
      expect(result.is_type_schema).toBe(true);
    });
  });

  describe('OP#3 - ID Parsing', () => {
    test('parses GTS ID into segments', () => {
      const result = parseGtsID('gts.vendor.pkg.ns.type.v1~');
      expect(result.ok).toBe(true);
      expect(result.segments).toHaveLength(1);

      const segment = result.segments[0];
      expect(segment.vendor).toBe('vendor');
      expect(segment.package).toBe('pkg');
      expect(segment.namespace).toBe('ns');
      expect(segment.type).toBe('type');
      expect(segment.verMajor).toBe(1);
      expect(segment.verMinor).toBeUndefined();
      expect(segment.isType).toBe(true);
    });

    test('parses instance ID with minor version', () => {
      const result = parseGtsID('gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.2');
      expect(result.ok).toBe(true);

      const segment = result.segments[1];
      expect(segment.verMajor).toBe(1);
      expect(segment.verMinor).toBe(2);
      expect(segment.isType).toBe(false);
    });

    test('parses chained identifiers', () => {
      const result = parseGtsID('gts.x.core.events.type.v1~ven.app._.custom_event.v1~');
      expect(result.ok).toBe(true);
      expect(result.segments).toHaveLength(2);

      // First segment - base type
      expect(result.segments[0].vendor).toBe('x');
      expect(result.segments[0].package).toBe('core');
      expect(result.segments[0].namespace).toBe('events');
      expect(result.segments[0].type).toBe('type');
      expect(result.segments[0].verMajor).toBe(1);
      expect(result.segments[0].isType).toBe(true);

      // Second segment - derived type
      expect(result.segments[1].vendor).toBe('ven');
      expect(result.segments[1].package).toBe('app');
      expect(result.segments[1].namespace).toBe('_'); // placeholder
      expect(result.segments[1].type).toBe('custom_event');
      expect(result.segments[1].verMajor).toBe(1);
      expect(result.segments[1].isType).toBe(true);
    });
  });

  describe('OP#4 - Pattern Matching', () => {
    test('matches exact patterns', () => {
      const candidate = 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0';
      const pattern = 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0';
      const result = matchIDPattern(candidate, pattern);
      expect(result.match).toBe(true);
    });

    test('matches wildcard patterns', () => {
      const candidate = 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0';
      const pattern = 'gts.vendor.pkg.*';
      const result = matchIDPattern(candidate, pattern);
      expect(result.match).toBe(true);
    });

    test('rejects non-matching patterns', () => {
      const candidate = 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0';
      const pattern = 'gts.other.pkg.*';
      const result = matchIDPattern(candidate, pattern);
      expect(result.match).toBe(false);
    });

    test('matches partial wildcards', () => {
      const candidate = 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0';
      const pattern = 'gts.vendor.pkg.ns.*';
      const result = matchIDPattern(candidate, pattern);
      expect(result.match).toBe(true);
    });
  });

  describe('OP#5 - UUID Generation', () => {
    test('generates deterministic UUID from GTS ID', () => {
      const result1 = idToUUID('gts.vendor.pkg.ns.type.v1~');
      const result2 = idToUUID('gts.vendor.pkg.ns.type.v1~');

      expect(result1.uuid).toBe(result2.uuid);
      expect(result1.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('generates different UUIDs for different IDs', () => {
      const result1 = idToUUID('gts.vendor.pkg.ns.type.v1~');
      const result2 = idToUUID('gts.vendor.pkg.ns.type.v2~');

      expect(result1.uuid).not.toBe(result2.uuid);
    });
  });
});

describe('GTS Store Operations', () => {
  let gts: GTS;

  beforeEach(() => {
    gts = new GTS({ validateRefs: false });
  });

  describe('OP#6 - Schema Validation', () => {
    test('validates instance against schema', () => {
      const schema = {
        $$id: 'gts.test.pkg.ns.person.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const validInstance = {
        gtsId: 'gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0',
        $schema: 'gts.test.pkg.ns.person.v1~',
        name: 'John Doe',
        age: 30,
      };

      const invalidInstance = {
        gtsId: 'gts.test.pkg.ns.person.v1~test.pkg.ns.jane.v1.1',
        $schema: 'gts.test.pkg.ns.person.v1~',
        age: 30,
      };

      gts.register(schema);
      gts.register(validInstance);
      gts.register(invalidInstance);

      const validResult = gts.validateInstance('gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0');
      expect(validResult.ok).toBe(true);

      const invalidResult = gts.validateInstance('gts.test.pkg.ns.person.v1~test.pkg.ns.jane.v1.1');
      expect(invalidResult.ok).toBe(false);
      expect(invalidResult.error).toContain('required');
    });
  });

  describe('OP#7 - Relationship Resolution', () => {
    test('resolves relationships between entities', () => {
      const schema = {
        $$id: 'gts.test.pkg.ns.person.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          friend: { $ref: 'gts://gts.test.pkg.ns.person.v1~' },
        },
      };

      const instance = {
        gtsId: 'gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0',
        $schema: 'gts.test.pkg.ns.person.v1~',
        name: 'John',
        friend: { $ref: 'gts.test.pkg.ns.person.v1~test.pkg.ns.jane.v1.1' },
      };

      gts.register(schema);
      gts.register(instance);

      const result = gts.resolveRelationships('gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0');
      expect(result.relationships).toContain('gts.test.pkg.ns.person.v1~');
      expect(result.brokenReferences).toContain('gts.test.pkg.ns.person.v1~test.pkg.ns.jane.v1.1');
    });
  });

  describe('OP#8 - Compatibility Checking', () => {
    test('reports adding an optional property to an open model as forward-only', () => {
      const schemaV1 = {
        $$id: 'gts.test.pkg.ns.person.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const schemaV2 = {
        $$id: 'gts.test.pkg.ns.person.v2~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string' },
        },
        required: ['name'],
      };

      gts.register(schemaV1);
      gts.register(schemaV2);

      const result = gts.checkCompatibility('gts.test.pkg.ns.person.v1~', 'gts.test.pkg.ns.person.v2~', 'backward');

      // Spec 0.13 §4.5: the old open schema already accepted arbitrary values
      // under `email`, so the added property schema is not backward compatible.
      expect(result.backward_compatibility).toBe('incompatible');
      expect(result.forward_compatibility).toBe('compatible');
      expect(result.full_compatibility).toBe('incompatible');
    });

    test('reports annotation-only changes as fully compatible', () => {
      const schemaV1 = {
        $$id: 'gts.test.pkg.ns.doc.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { name: { type: 'string', description: 'The name' } },
        required: ['name'],
        additionalProperties: false,
      };

      const schemaV2 = {
        $$id: 'gts.test.pkg.ns.doc.v2~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { name: { type: 'string', description: 'A better description' } },
        required: ['name'],
        additionalProperties: false,
      };

      gts.register(schemaV1);
      gts.register(schemaV2);

      const result = gts.checkCompatibility('gts.test.pkg.ns.doc.v1~', 'gts.test.pkg.ns.doc.v2~');
      expect(result.full_compatibility).toBe('compatible');
      expect(result.is_fully_compatible).toBe(true);
    });

    test('detects incompatible changes', () => {
      const schemaV1 = {
        $$id: 'gts.test.pkg.ns.person.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const schemaV2 = {
        $$id: 'gts.test.pkg.ns.person.v2~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          fullName: { type: 'string' },
        },
        required: ['fullName'],
      };

      gts.register(schemaV1);
      gts.register(schemaV2);

      const result = gts.checkCompatibility('gts.test.pkg.ns.person.v1~', 'gts.test.pkg.ns.person.v2~', 'backward');
      expect(result.is_fully_compatible).toBe(false);
      expect(result.incompatibility_reasons.length).toBeGreaterThan(0);
    });
  });

  describe('OP#12 - derivation form', () => {
    test('an allOf $ref to an unrelated type does not stand in for the chain parent', () => {
      // Only a reference to the chain parent inherits its constraints. Without
      // one, the derived schema has to restate them (ADR-0001 variant 2c), so
      // dropping a required field and opening a closed base must fail.
      gts.register({
        $$id: 'gts.test.pkg.ns.strict.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['a', 'b'],
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        additionalProperties: false,
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.unrelated.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.strict.v1~test.pkg._.lax.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' } },
        additionalProperties: true,
        allOf: [{ $$ref: 'gts://gts.test.pkg.ns.unrelated.v1~' }],
      });

      expect(gts.validateEntity('gts.test.pkg.ns.strict.v1~test.pkg._.lax.v1~').ok).toBe(false);
    });
  });

  describe('OP#12 - inheritance through a top-level $ref', () => {
    test('a derived type that is exactly its parent via top-level $ref is valid', () => {
      // ADR-0001 leaves the derivation body free; `{$ref: parent}` means
      // "identical to the parent", which trivially satisfies derivation.
      gts.register({
        $$id: 'gts.test.pkg.ns.tlbase.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['a', 'b'],
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        additionalProperties: false,
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.tlbase.v1~test.pkg._.kid.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        $$ref: 'gts://gts.test.pkg.ns.tlbase.v1~',
      });

      expect(gts.validateEntity('gts.test.pkg.ns.tlbase.v1~test.pkg._.kid.v1~').ok).toBe(true);
    });
  });

  describe('OP#9 - a cast succeeds only if its result fits the target', () => {
    beforeEach(() => {
      gts.register({
        $$id: 'gts.test.pkg.ns.shape.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' } },
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.shape.v2~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'number' } },
      });
    });

    test('fails when the casted value does not satisfy the target type', () => {
      gts.register({ id: 'gts.test.pkg.ns.shape.v1~test.pkg._.bad.v1', a: 'not-a-number' });

      const result = gts.castInstance('gts.test.pkg.ns.shape.v1~test.pkg._.bad.v1', 'gts.test.pkg.ns.shape.v2~');

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/must be number/);
    });

    test('succeeds when the casted value does satisfy the target type', () => {
      gts.register({ id: 'gts.test.pkg.ns.shape.v1~test.pkg._.good.v1', a: 42 });

      const result = gts.castInstance('gts.test.pkg.ns.shape.v1~test.pkg._.good.v1', 'gts.test.pkg.ns.shape.v2~');

      expect(result.ok).toBe(true);
    });
  });

  describe('OP#9 - cast responses name the target consistently', () => {
    test('a failed cast still reports to_type_id', () => {
      const store = new GtsStore({ validateRefs: false });
      store.register(
        createJsonEntity({
          $$id: 'gts.test.pkg.ns.castsrc.v1~',
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      );
      store.register(createJsonEntity({ id: 'gts.test.pkg.ns.castsrc.v1~test.pkg._.item.v1' }));

      // The target type is not registered, so this takes a failure path.
      const result: Record<string, any> = store.castInstance(
        'gts.test.pkg.ns.castsrc.v1~test.pkg._.item.v1',
        'gts.test.pkg.ns.missing.v2~'
      );

      expect(result.ok).toBe(false);
      expect(result.to_type_id).toBe('gts.test.pkg.ns.missing.v2~');
      expect(result).not.toHaveProperty('to_schema_id');
    });
  });

  describe('OP#9 - casting never lands on an abstract type', () => {
    test('rejects a cast whose target is x-gts-abstract, mirroring direct instantiation', () => {
      const store = new GtsStore({ validateRefs: false });
      store.register(
        createJsonEntity({
          $$id: 'gts.test.pkg.ns.castabs.v1~',
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      );
      store.register(
        createJsonEntity({
          $$id: 'gts.test.pkg.ns.castabs.v2~',
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          'x-gts-abstract': true,
        })
      );
      store.register(createJsonEntity({ id: 'gts.test.pkg.ns.castabs.v1~test.pkg._.item.v1' }));

      const result: Record<string, any> = store.castInstance(
        'gts.test.pkg.ns.castabs.v1~test.pkg._.item.v1',
        'gts.test.pkg.ns.castabs.v2~'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/abstract/i);
    });
  });

  describe('OP#9 - Version Casting', () => {
    test('casts instance between compatible versions', () => {
      const schemaV1 = {
        $$id: 'gts.test.pkg.ns.person.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const schemaV2 = {
        $$id: 'gts.test.pkg.ns.person.v2~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string', default: '' },
        },
        required: ['name'],
      };

      // A document carrying `$schema` is a schema, so an instance identifies
      // its type through the chained `id` instead.
      const instance = {
        id: 'gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0',
        name: 'John',
        age: 30,
      };

      gts.register(schemaV1);
      gts.register(schemaV2);
      gts.register(instance);

      const result = gts.castInstance('gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0', 'gts.test.pkg.ns.person.v2~');

      expect(result.ok).toBe(true);
      expect(result.result).toBeDefined();
      // The target's default is materialized into the casted instance.
      expect(result.result.email).toBe('');
      expect(result.result.name).toBe('John');
    });

    test('casts to a derived target that pulls its parent in through allOf', () => {
      gts.register({
        $$id: 'gts.test.pkg.ns.staff.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      });
      // Derived types are `allOf: [{$ref: parent}, …]` by construction, so a
      // cast that reads `properties` without resolving the ref sees nothing
      // and drops every value.
      gts.register({
        $$id: 'gts.test.pkg.ns.staff.v1~test.pkg._.employee.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        allOf: [
          { $$ref: 'gts://gts.test.pkg.ns.staff.v1~' },
          { type: 'object', properties: { dept: { type: 'string', default: 'unassigned' } } },
        ],
      });
      gts.register({ id: 'gts.test.pkg.ns.staff.v1~test.pkg.ns.ann.v1.0', name: 'Ann', age: 41 });

      const result = gts.castInstance(
        'gts.test.pkg.ns.staff.v1~test.pkg.ns.ann.v1.0',
        'gts.test.pkg.ns.staff.v1~test.pkg._.employee.v1~'
      );

      expect(result.ok).toBe(true);
      expect(result.result).toMatchObject({ name: 'Ann', age: 41, dept: 'unassigned' });
    });

    test('casts to a target whose allOf reaches the same shared ancestor through two branches', () => {
      // Diamond-shaped hierarchy: `mid` and `sibling` both compose `ancestor`,
      // and the target composes both `mid` and `sibling`. Flattening the
      // target must revisit `ancestor` at most once so its property survives
      // exactly once - not duplicated, not dropped - regardless of how many
      // paths reach it.
      gts.register({
        $$id: 'gts.test.pkg.ns.ancestor.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { shared: { type: 'string', default: 'from-ancestor' } },
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.mid.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        allOf: [{ $$ref: 'gts://gts.test.pkg.ns.ancestor.v1~' }],
        properties: { fromMid: { type: 'string', default: 'mid' } },
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.sibling.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        allOf: [{ $$ref: 'gts://gts.test.pkg.ns.ancestor.v1~' }],
        properties: { fromSibling: { type: 'string', default: 'sibling' } },
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.diamondtarget.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        allOf: [{ $$ref: 'gts://gts.test.pkg.ns.mid.v1~' }, { $$ref: 'gts://gts.test.pkg.ns.sibling.v1~' }],
        properties: { direct: { type: 'string', default: 'direct' } },
      });
      gts.register({
        $$id: 'gts.test.pkg.ns.diamondsource.v1~',
        $$schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
      });
      gts.register({ id: 'gts.test.pkg.ns.diamondsource.v1~test.pkg.ns.item.v1.0' });

      const result = gts.castInstance(
        'gts.test.pkg.ns.diamondsource.v1~test.pkg.ns.item.v1.0',
        'gts.test.pkg.ns.diamondtarget.v1~'
      );

      expect(result.ok).toBe(true);
      expect(result.result).toMatchObject({
        shared: 'from-ancestor',
        fromMid: 'mid',
        fromSibling: 'sibling',
        direct: 'direct',
      });
    });
  });

  describe('OP#10 - Query Execution', () => {
    test('queries entities with patterns', () => {
      gts.register({
        gtsId: 'gts.vendor.pkg1.ns.type.v1~vendor.pkg1.ns.instance.v1.0',
        data: 'test1',
      });
      gts.register({
        gtsId: 'gts.vendor.pkg2.ns.type.v1~vendor.pkg2.ns.instance.v1.0',
        data: 'test2',
      });
      gts.register({
        gtsId: 'gts.other.pkg.ns.type.v1~other.pkg.ns.instance.v1.0',
        data: 'test3',
      });

      const result = gts.query('gts.vendor.*');
      expect(result.count).toBe(2);
      const ids = result.items.map((item: any) => item.gtsId);
      expect(ids).toContain('gts.vendor.pkg1.ns.type.v1~vendor.pkg1.ns.instance.v1.0');
      expect(ids).toContain('gts.vendor.pkg2.ns.type.v1~vendor.pkg2.ns.instance.v1.0');
    });

    test('supports wildcard patterns', () => {
      gts.register({ gtsId: 'gts.a.b.c.d.v1~a.b.c.d.v1.0' });
      gts.register({ gtsId: 'gts.a.b.c.e.v1~a.b.c.e.v1.0' });
      gts.register({ gtsId: 'gts.a.x.c.d.v1~a.x.c.d.v1.0' });

      const result = gts.query('gts.a.b.*');
      expect(result.count).toBe(2);
      const ids = result.items.map((item: any) => item.gtsId);
      expect(ids).toContain('gts.a.b.c.d.v1~a.b.c.d.v1.0');
      expect(ids).toContain('gts.a.b.c.e.v1~a.b.c.e.v1.0');
    });
  });

  describe('OP#11 - Attribute Access', () => {
    test('retrieves attribute values', () => {
      // A bare, un-chained id (no `~`-marked type segment) is a prohibited
      // single-segment instance id per `Gts.parseGtsID` - use the same
      // chained shape as the other instance fixtures in this file.
      const instanceId = 'gts.test.pkg.ns.person.v1~test.pkg.ns.john.v1.0';
      const instance = {
        gtsId: instanceId,
        name: 'John Doe',
        address: {
          city: 'New York',
          country: 'USA',
        },
      };

      gts.register(instance);

      const nameResult = gts.getAttribute(`${instanceId}@name`);
      expect(nameResult.resolved).toBe(true);
      expect(nameResult.value).toBe('John Doe');

      const cityResult = gts.getAttribute(`${instanceId}@address.city`);
      expect(cityResult.resolved).toBe(true);
      expect(cityResult.value).toBe('New York');

      const missingResult = gts.getAttribute(`${instanceId}@missing`);
      expect(missingResult.resolved).toBe(false);
    });
  });

  describe('register() rejects malformed entity ids', () => {
    // A malformed id would otherwise silently break every ancestor-chain
    // computation downstream (`buildSchemaChain` and friends), which then
    // fail open by treating the entity as if it had no ancestors at all -
    // so `register()` must reject it up front, for every entity kind and
    // regardless of `validateRefs`.
    test('rejects a schema id with an extra dot-segment before the version', () => {
      // 5 dot-segments before `v1~` - GTS ids take exactly 4
      // (vendor.package.namespace.type).
      const malformedId = 'gts.x.unit.tr.nestedorphanbug.base.v1~';
      expect(() =>
        gts.register({
          $$id: malformedId,
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      ).toThrow(`Invalid GTS entity id: '${malformedId}'`);
    });

    test('rejects a version missing the leading v', () => {
      const malformedId = 'gts.vendor.pkg.ns.type.1~';
      expect(() =>
        gts.register({
          $$id: malformedId,
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      ).toThrow(`Invalid GTS entity id: '${malformedId}'`);
    });

    test('rejects a chained schema id missing the trailing tilde', () => {
      const malformedId = 'gts.vendor.pkg.ns.type.v1';
      expect(() =>
        gts.register({
          $$id: malformedId,
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      ).toThrow(`Invalid GTS entity id: '${malformedId}'`);
    });

    test('rejects an empty string id', () => {
      expect(() => gts.register({ gtsId: '' })).toThrow("Invalid GTS entity id: ''");
    });
  });

  describe('register() accepts anonymous instances by plain UUID (gts-spec §3.7)', () => {
    // §3.7 permits a non-schema instance to be identified by a plain UUID
    // in its `id` field, resolving its schema via a separate `type` field
    // rather than by the id's own GTS-chain shape - register() must accept
    // this shape instead of rejecting it as a malformed GTS id.
    test('accepts a non-schema instance with a plain UUID id and a `type` field', () => {
      const uuidId = '7a1d2f34-5678-49ab-9012-abcdef123456';
      expect(() =>
        gts.register({
          type: 'gts.x.test6anon.events.type.v1~x.commerce.orders.order_placed.v1.0~',
          id: uuidId,
          tenantId: '11111111-2222-3333-8444-555555555555',
          occurredAt: '2025-09-20T18:35:00Z',
          payload: { orderId: 'af0e3c1b-8f1e-4a27-9a9b-b7b9b70c1f01' },
        })
      ).not.toThrow();
    });

    test('still rejects a SCHEMA whose id is a plain UUID (not a valid GTS Type id)', () => {
      // The UUID exception is instance-only - a schema must always carry a
      // well-formed GTS Type ID.
      const uuidId = '7a1d2f34-5678-49ab-9012-abcdef123456';
      expect(() =>
        gts.register({
          $$id: uuidId,
          $$schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
        })
      ).toThrow(`Invalid GTS entity id: '${uuidId}'`);
    });

    test('still rejects an id that is neither a valid GTS id nor a valid UUID', () => {
      const malformedId = 'not-a-valid-id-at-all';
      expect(() =>
        gts.register({
          gtsId: malformedId,
          name: 'irrelevant',
        })
      ).toThrow(`Invalid GTS entity id: '${malformedId}'`);
    });
  });

  // x-gts-ref combinator tests (oneOf/anyOf/allOf) are in the canonical gts-spec test suite

  describe('OP#12 - Wildcard Validation (v0.7)', () => {
    test('validates wildcard patterns', () => {
      const result = validateGtsID('gts.vendor.pkg.*');
      expect(result.ok).toBe(true);
      expect(result.is_wildcard).toBe(true);
    });

    test('rejects wildcards not at token boundaries', () => {
      expect(isValidGtsID('gts.vendor.pkg.a*')).toBe(false);
      expect(isValidGtsID('gts.vendor.pkg.*a')).toBe(false);
    });

    test('rejects wildcards in middle of chain', () => {
      expect(isValidGtsID('gts.vendor.*.ns.type.v1~')).toBe(false);
    });

    test('allows wildcards at end of chain', () => {
      expect(isValidGtsID('gts.vendor.pkg.ns.type.v1~vendor.*')).toBe(true);
    });
  });

  describe('OP#13 - Schema Detection (v0.7)', () => {
    test('detects schema with $schema field', () => {
      const schema = {
        $id: 'gts.vendor.pkg.ns.type.v1~',
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      };
      const result = extractID(schema);
      expect(result.is_type_schema).toBe(true);
    });

    test('does not detect schema without $schema field', () => {
      const notSchema = {
        $id: 'gts.vendor.pkg.ns.type.v1~',
        type: 'object',
        properties: {},
      };
      const result = extractID(notSchema);
      expect(result.is_type_schema).toBe(false);
    });

    test('detects schema with GTS $schema reference', () => {
      const schema = {
        $id: 'gts.vendor.pkg.ns.derived.v1~',
        $schema: 'gts://gts.vendor.pkg.ns.type.v1~',
        type: 'object',
      };
      const result = extractID(schema);
      expect(result.is_type_schema).toBe(true);
    });
  });

  describe('OP#14 - Schema ID Extraction (v0.7)', () => {
    test('extracts type_id from chain for instances without explicit schema field', () => {
      const instance = {
        gtsId: 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0',
        data: 'test',
      };
      const result = extractID(instance);
      // type_id is extracted from the chain
      expect(result.type_id).toBe('gts.vendor.pkg.ns.type.v1~');
    });

    test('extracts type_id from chained instance ID', () => {
      const instance = {
        gtsId: 'gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0',
        $schema: 'gts.vendor.pkg.ns.type.v1~',
        data: 'test',
      };
      const result = extractID(instance);
      expect(result.type_id).toBe('gts.vendor.pkg.ns.type.v1~');
    });

    test('extracts parent type from derived schema chain', () => {
      const schema = {
        $id: 'gts.x.core.events.type.v1~x.commerce.orders.order_placed.v1.0~',
        $schema: 'gts://gts.x.core.events.type.v1~',
        type: 'object',
      };
      const result = extractID(schema);
      expect(result.type_id).toBe('gts.x.core.events.type.v1~');
    });
  });

  describe('OP#15 - ParseResult Fields (v0.7)', () => {
    test('parseGtsID successfully parses type IDs', () => {
      const result = parseGtsID('gts.vendor.pkg.ns.type.v1~');
      expect(result.ok).toBe(true);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].isType).toBe(true);
    });

    test('parseGtsID successfully parses wildcard patterns', () => {
      const result = parseGtsID('gts.vendor.pkg.*');
      expect(result.ok).toBe(true);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].isWildcard).toBe(true);
    });

    test('parseGtsID successfully parses chained instance IDs', () => {
      const result = parseGtsID('gts.vendor.pkg.ns.type.v1~vendor.pkg.ns.instance.v1.0');
      expect(result.ok).toBe(true);
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].isType).toBe(true);
      expect(result.segments[1].isType).toBe(false);
    });
  });
});
