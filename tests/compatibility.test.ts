import { GTS, CompatVerdict } from '../src';

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';

/**
 * Table-driven transcription of GTS spec 0.13 §4.5, "Type Schema Evolution
 * Compatibility Rules".
 *
 * Each row states a single change between two successive definitions of one
 * type identity and the verdict the spec gives for each relation. These are
 * pinned here rather than left to the gts-spec conformance suite alone: the
 * suite needs Python and a running server, and the rules below are the part of
 * 0.13 most likely to be silently broken by a refactor of the subsumption
 * engine (0.12 gave the opposite answer for several of these rows).
 */
interface Row {
  change: string;
  old: Record<string, any>;
  new: Record<string, any>;
  backward: CompatVerdict;
  forward: CompatVerdict;
  full: CompatVerdict;
}

const OPEN = {};
const CLOSED = { additionalProperties: false };

const ROWS: Row[] = [
  {
    change: 'updating description/examples',
    old: { required: ['a'], properties: { a: { type: 'string', description: 'first' } }, ...CLOSED },
    new: {
      required: ['a'],
      properties: { a: { type: 'string', description: 'second', examples: ['x'] } },
      ...CLOSED,
    },
    backward: 'compatible',
    forward: 'compatible',
    full: 'compatible',
  },
  {
    change: 'adding optional property (open model)',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    new: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...OPEN },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'adding optional property (closed model)',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'adding new required property (open model)',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    new: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...OPEN },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'adding new required property (closed model)',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    new: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'removing optional property (open model)',
    old: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...OPEN },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'removing optional property (closed model)',
    old: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'removing required property definition (open model)',
    old: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...OPEN },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'removing required property definition (closed model)',
    old: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'closing an open object',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'opening a closed object',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: true },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'widening a schema-valued unevaluatedProperties to fully open',
    old: {
      required: ['a'],
      properties: { a: { type: 'string' } },
      unevaluatedProperties: { type: 'string' },
    },
    new: { required: ['a'], properties: { a: { type: 'string' } }, ...OPEN },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'changing required property to optional',
    old: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'changing optional property to required',
    old: { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    new: { required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'adding new enum value',
    old: { required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y'] } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y', 'z'] } }, ...CLOSED },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'removing enum value',
    old: { required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y', 'z'] } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y'] } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'changing a const value',
    old: { required: ['a'], properties: { a: { type: 'string', const: 'A' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', const: 'B' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'widening numeric type (integer -> number)',
    old: { required: ['a'], properties: { a: { type: 'integer' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'number' } }, ...CLOSED },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'narrowing numeric type (number -> integer)',
    old: { required: ['a'], properties: { a: { type: 'number' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'integer' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'relaxing constraints (increasing max)',
    old: { required: ['a'], properties: { a: { type: 'string', maxLength: 10 } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', maxLength: 100 } }, ...CLOSED },
    backward: 'compatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'tightening constraints (decreasing max)',
    old: { required: ['a'], properties: { a: { type: 'string', maxLength: 100 } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', maxLength: 10 } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'dropping maxLength for an enum whose members are all within it',
    old: { required: ['a'], properties: { a: { type: 'string', maxLength: 100 } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', enum: ['gold', 'platinum'] } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'compatible',
    full: 'incompatible',
  },
  {
    change: 'dropping maxLength for an enum with a member outside it',
    old: { required: ['a'], properties: { a: { type: 'string', maxLength: 5 } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'string', enum: ['short', 'way-too-long-value'] } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'renaming property',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    new: { required: ['b'], properties: { b: { type: 'string' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
  {
    change: 'changing property type (incompatible)',
    old: { required: ['a'], properties: { a: { type: 'string' } }, ...CLOSED },
    new: { required: ['a'], properties: { a: { type: 'number' } }, ...CLOSED },
    backward: 'incompatible',
    forward: 'incompatible',
    full: 'incompatible',
  },
];

describe('OP#8 - Type Schema Evolution Compatibility (spec 0.13 §4.5)', () => {
  ROWS.forEach((row, index) => {
    test(`${row.change}: backward=${row.backward}, forward=${row.forward}, full=${row.full}`, () => {
      const gts = new GTS({ validateRefs: false });
      const oldId = `gts.x.unit.compat.case${index}.v1.0~`;
      const newId = `gts.x.unit.compat.case${index}.v1.1~`;

      gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', ...row.old });
      gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', ...row.new });

      const result = gts.checkCompatibility(oldId, newId);

      expect({
        backward: result.backward_compatibility,
        forward: result.forward_compatibility,
        full: result.full_compatibility,
      }).toEqual({ backward: row.backward, forward: row.forward, full: row.full });
    });
  });
});

describe('OP#8 - inconclusive checks report `unknown`', () => {
  test('a differing unmodeled assertion is unknown, not incompatible', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.unknown.pattern.v1.0~';
    const newId = 'gts.x.unit.unknown.pattern.v1.1~';

    // `pattern` is a real constraint the engine does not model, so it cannot
    // decide inclusion either way.
    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', pattern: '^foo' } },
      additionalProperties: false,
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', pattern: '^bar' } },
      additionalProperties: false,
    });

    const result = gts.checkCompatibility(oldId, newId);

    expect(result.backward_compatibility).toBe('unknown');
    expect(result.forward_compatibility).toBe('unknown');
    expect(result.full_compatibility).toBe('unknown');
    // `unknown` is not evidence of incompatibility, but it is not a pass either.
    expect(result.is_fully_compatible).toBe(false);
  });

  test('a const already matching the old pattern lets the new schema drop it, forward-compatibly', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.unknown.patternconst.v1.0~';
    const newId = 'gts.x.unit.unknown.patternconst.v1.1~';

    // `pattern` is still compared by exact equality in general (see the test
    // above), but a `const`/`enum` value the new schema pins down that
    // already satisfies the old pattern makes dropping the pattern itself
    // harmless from the "does everything new could ever hold also satisfy
    // old" angle - i.e. forward compatibility, `subsumes(oldSchema,
    // newSchema)`. (Backward asks the opposite question - "does everything
    // old could ever hold also satisfy new" - and stays `incompatible`
    // here regardless of this fix, because narrowing to one `const` value
    // legitimately excludes strings old admitted.)
    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', pattern: '^[a-z]+$' } },
      additionalProperties: false,
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', const: 'hello' } },
      additionalProperties: false,
    });

    const result = gts.checkCompatibility(oldId, newId);

    expect(result.forward_compatibility).toBe('compatible');
    expect(result.backward_compatibility).toBe('incompatible');
  });

  test('a const that does not match the old pattern stays unknown, not forward-compatible', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.unknown.patternconstbad.v1.0~';
    const newId = 'gts.x.unit.unknown.patternconstbad.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', pattern: '^[a-z]+$' } },
      additionalProperties: false,
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', const: 'HELLO' } },
      additionalProperties: false,
    });

    const result = gts.checkCompatibility(oldId, newId);

    expect(result.forward_compatibility).toBe('unknown');
    expect(result.is_fully_compatible).toBe(false);
  });

  test('an unresolvable type identifier is unknown rather than incompatible', () => {
    const gts = new GTS({ validateRefs: false });

    const result = gts.checkCompatibility('gts.x.unit.unknown.missing.v1.0~', 'gts.x.unit.unknown.missing.v1.1~');

    expect(result.backward_compatibility).toBe('unknown');
    expect(result.forward_compatibility).toBe('unknown');
    expect(result.full_compatibility).toBe('unknown');
    // One reason per missing side, each reported once.
    expect(result.incompatibility_reasons).toEqual([
      'Old type schema not found: gts.x.unit.unknown.missing.v1.0~',
      'New type schema not found: gts.x.unit.unknown.missing.v1.1~',
    ]);
  });

  test('a bound that is present but not numeric is unknown', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.unknown.bound.v1.0~';
    const newId = 'gts.x.unit.unknown.bound.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string', maxLength: 10 } },
      additionalProperties: false,
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string', maxLength: 'ten' } },
      additionalProperties: false,
    });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });
});

describe('OP#8 - malformed schemas degrade instead of throwing', () => {
  // Schemas are registered without JSON Schema meta-validation, so the engine
  // has to survive keywords of the wrong shape.
  test('a non-array enum reached through allOf does not crash the check', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.malformed.enum.v1.0~';
    const newId = 'gts.x.unit.malformed.enum.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      allOf: [{ properties: { a: { enum: ['x'] } } }, { properties: { a: { enum: 'not-an-array' } } }],
    });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', properties: { a: { enum: ['x', 'y'] } } });

    expect(() => gts.checkCompatibility(oldId, newId)).not.toThrow();
  });

  test('a non-array enum makes the comparison inconclusive, not unconstrained', () => {
    // `fixedValues()` only recognises array enums, so a malformed one used to
    // read as "this schema pins nothing down" and compared as compatible.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.malformed.enumshape.v1.0~';
    const newId = 'gts.x.unit.malformed.enumshape.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'string', enum: 'open' });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'string' });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });

  test('a modeled keyword of the wrong shape makes the comparison inconclusive', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.malformed.reqshape.v1.0~';
    const newId = 'gts.x.unit.malformed.reqshape.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', required: 'a', properties: { a: {} } });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', required: ['a'], properties: { a: {} } });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });

  test('a schema that cannot be compared at all reports unknown', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.malformed.cyclic.v1.0~';
    const newId = 'gts.x.unit.malformed.cyclic.v1.1~';

    const cyclic: any = { $$id: oldId, $$schema: DRAFT7, type: 'object', properties: {} };
    cyclic.properties.self = cyclic; // a structure JSON could never carry

    gts.register(cyclic);
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', properties: { self: { type: 'string' } } });

    const result = gts.checkCompatibility(oldId, newId);
    expect(['unknown', 'incompatible']).toContain(result.full_compatibility);
  });
});

describe('OP#8 - assertions that are not annotations', () => {
  test('a differing x-gts-ref pattern is not treated as documentation', () => {
    // x-gts-ref is enforced against instances by OP#6, so two schemas whose
    // reference patterns accept disjoint targets do not accept the same
    // instances - the engine must not strip it along with the other x-gts-*.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.xref.evt.v1.0~';
    const newId = 'gts.x.unit.xref.evt.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { ref: { type: 'string', 'x-gts-ref': 'gts.x.unit.alpha.*' } },
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { ref: { type: 'string', 'x-gts-ref': 'gts.x.unit.beta.*' } },
    });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });

  test('an identical x-gts-ref still compares as compatible', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.xrefsame.evt.v1.0~';
    const newId = 'gts.x.unit.xrefsame.evt.v1.1~';
    const body = {
      type: 'object',
      properties: { ref: { type: 'string', 'x-gts-ref': 'gts.x.unit.alpha.*' } },
      additionalProperties: false,
    };

    gts.register({ $$id: oldId, $$schema: DRAFT7, ...body });
    gts.register({ $$id: newId, $$schema: DRAFT7, ...body });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('compatible');
  });
});

describe('OP#8 - unresolvable references fail closed', () => {
  test('a local JSON pointer the engine cannot follow reports unknown', () => {
    // Both documents look identical once `$ref` is dropped and `definitions`
    // is stripped, but the pointed-at subschemas differ.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.localref.t.v1.0~';
    const newId = 'gts.x.unit.localref.t.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      definitions: { T: { type: 'string' } },
      $$ref: '#/definitions/T',
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      definitions: { T: { type: 'number' } },
      $$ref: '#/definitions/T',
    });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });

  test('a $ref to an unregistered GTS type reports unknown', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.deadref.t.v1.0~';
    const newId = 'gts.x.unit.deadref.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', properties: { a: { type: 'string' } } });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string' } },
      allOf: [{ $$ref: 'gts://gts.x.unit.deadref.absent.v1~' }],
    });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });

  test('a local $ref nested under `properties`, reached via a shared $defs entry, is not silently skipped', () => {
    // Both documents are byte-identical once `$defs` is stripped (both use
    // the exact same `properties: { x: { $ref: '#/$defs/T' } }`), so the
    // `deepEqual` fast path in `subsumes()` must not be allowed to fire
    // before the local ref nested under `properties.x` - whose target
    // genuinely differs between the two schemas - is accounted for.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.localref.nested.v1.0~';
    const newId = 'gts.x.unit.localref.nested.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      $defs: { T: { type: 'string' } },
      properties: { x: { $ref: '#/$defs/T' } },
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      $defs: { T: { type: 'number' } },
      properties: { x: { $ref: '#/$defs/T' } },
    });

    const result = gts.checkCompatibility(oldId, newId);
    expect(result.backward_compatibility).toBe('unknown');
    expect(result.forward_compatibility).toBe('unknown');
  });

  test('a genuinely ref-free, identical schema still takes the deepEqual fast path', () => {
    // Regression guard for the fix above: schemas with no local `$ref`
    // anywhere must still be recognised as trivially compatible.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.norefidentical.t.v1.0~';
    const newId = 'gts.x.unit.norefidentical.t.v1.1~';
    const body = { type: 'object', properties: { x: { type: 'string' } } };

    gts.register({ $$id: oldId, $$schema: DRAFT7, ...body });
    gts.register({ $$id: newId, $$schema: DRAFT7, ...body });

    const result = gts.checkCompatibility(oldId, newId);
    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('compatible');
  });
});

describe('OP#8 - $defs content is documentation, never compared', () => {
  test('malformed content inside $defs does not force an otherwise-comparable pair to unknown', () => {
    // `$defs` is annotation-kind (stripped before comparison), so a malformed
    // value inside it - a number where a schema/boolean belongs - must not
    // make an otherwise identical, otherwise well-formed comparison
    // inconclusive: the engine never reads that content for the verdict.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.defsmalformed.t.v1.0~';
    const newId = 'gts.x.unit.defsmalformed.t.v1.1~';
    const body = { type: 'object', $defs: { Note: 1 }, properties: { a: { type: 'string' } } };

    gts.register({ $$id: oldId, $$schema: DRAFT7, ...body });
    gts.register({ $$id: newId, $$schema: DRAFT7, ...body });

    const result = gts.checkCompatibility(oldId, newId);
    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('compatible');
  });

  test('a genuinely malformed keyword in a compared position still forces unknown', () => {
    // Narrow-scope guard: the annotation skip in `hasMalformedKeyword` must
    // only cover annotation-kind keywords like `$defs`; a malformed value in
    // a real, compared position (`properties`) must still degrade to unknown.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.propsmalformed.t.v1.0~';
    const newId = 'gts.x.unit.propsmalformed.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', properties: { a: 'not-a-schema' } });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', properties: { a: { type: 'string' } } });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });
});

describe('OP#8 - contradictory allOf branches are unsatisfiable', () => {
  test('disjoint types across allOf collapse to a schema accepting nothing', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.disjoint.t.v1.0~';
    const newId = 'gts.x.unit.disjoint.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, allOf: [{ type: 'string' }, { type: 'number' }] });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'string' });

    const result = gts.checkCompatibility(oldId, newId);
    // Valid(old) is empty, so it is included in Valid(new) but not vice versa.
    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('incompatible');
    expect(result.full_compatibility).toBe('incompatible');
  });
});

describe('OP#8 - inclusive and exclusive bounds are the same axis', () => {
  const register = (gts: GTS, id: string, bound: Record<string, number>) =>
    gts.register({
      $$id: id,
      $$schema: DRAFT7,
      type: 'object',
      properties: { n: { type: 'number', ...bound } },
      additionalProperties: false,
    });

  test('tightening minimum:0 to exclusiveMinimum:0 is forward compatible only', () => {
    const gts = new GTS({ validateRefs: false });
    register(gts, 'gts.x.unit.bounds.excl.v1.0~', { minimum: 0 });
    register(gts, 'gts.x.unit.bounds.excl.v1.1~', { exclusiveMinimum: 0 });

    const result = gts.checkCompatibility('gts.x.unit.bounds.excl.v1.0~', 'gts.x.unit.bounds.excl.v1.1~');
    // `x > 0` is a strict subset of `x >= 0`.
    expect(result.forward_compatibility).toBe('compatible');
    expect(result.backward_compatibility).toBe('incompatible');
  });

  test('relaxing exclusiveMaximum:10 to maximum:10 is backward compatible only', () => {
    const gts = new GTS({ validateRefs: false });
    register(gts, 'gts.x.unit.bounds.incl.v1.0~', { exclusiveMaximum: 10 });
    register(gts, 'gts.x.unit.bounds.incl.v1.1~', { maximum: 10 });

    const result = gts.checkCompatibility('gts.x.unit.bounds.incl.v1.0~', 'gts.x.unit.bounds.incl.v1.1~');
    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('incompatible');
  });

  test('the same bound expressed identically stays fully compatible', () => {
    const gts = new GTS({ validateRefs: false });
    register(gts, 'gts.x.unit.bounds.same.v1.0~', { exclusiveMinimum: 5 });
    register(gts, 'gts.x.unit.bounds.same.v1.1~', { exclusiveMinimum: 5 });

    expect(
      gts.checkCompatibility('gts.x.unit.bounds.same.v1.0~', 'gts.x.unit.bounds.same.v1.1~').full_compatibility
    ).toBe('compatible');
  });
});

describe('OP#8 - the keyword table is the single source of truth', () => {
  test('unevaluatedProperties closes a type, on every code path that reads it', () => {
    // It was previously honoured by contentModel() but invisible to the object
    // guard and to the unmodeled catch-all, so closing a type this way read as
    // fully compatible in both directions.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.unevald.t.v1.0~';
    const newId = 'gts.x.unit.unevald.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', properties: { a: { type: 'string' } } });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string' } },
      unevaluatedProperties: false,
    });

    const result = gts.checkCompatibility(oldId, newId);
    expect(result.backward_compatibility).toBe('incompatible');
    expect(result.forward_compatibility).toBe('compatible');
  });

  test('additionalProperties: true makes the level open even alongside a schema-valued unevaluatedProperties', () => {
    // unevaluatedProperties only applies to properties that properties /
    // patternProperties / additionalProperties did not already evaluate.
    // additionalProperties: true evaluates every remaining property, so
    // unevaluatedProperties can never actually apply here - the level is
    // fully open, not partially restricted by unevaluatedProperties's schema.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.apalwaysopen.t.v1.0~';
    const newId = 'gts.x.unit.apalwaysopen.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', properties: {} });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: {},
      additionalProperties: true,
      unevaluatedProperties: { type: 'number' },
    });

    const result = gts.checkCompatibility(oldId, newId);
    expect(result.forward_compatibility).toBe('compatible');
  });

  test('an unrecognised keyword fails closed to unknown rather than being ignored', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.newkw.t.v1.0~';
    const newId = 'gts.x.unit.newkw.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'string', 'x-some-future-assertion': 'a' });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'string', 'x-some-future-assertion': 'b' });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });
});

describe('OP#8 - the walker distinguishes schema positions from data', () => {
  test('a property whose name matches an annotation keyword is not stripped', () => {
    // Inside `properties` the keys are user-chosen names. Treating `title` as
    // the annotation keyword deleted the property and made the two schemas
    // normalize to the same thing.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.datakw.t.v1.0~';
    const newId = 'gts.x.unit.datakw.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, type: 'object', properties: { title: { type: 'string' } } });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object', properties: { title: { type: 'number' } } });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('incompatible');
  });

  test('annotations are still stripped where a schema is expected', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.datakw.ann.v1.0~';
    const newId = 'gts.x.unit.datakw.ann.v1.1~';

    gts.register({
      $$id: oldId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string', title: 'One' } },
      additionalProperties: false,
    });
    gts.register({
      $$id: newId,
      $$schema: DRAFT7,
      type: 'object',
      properties: { a: { type: 'string', title: 'Two' } },
      additionalProperties: false,
    });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('compatible');
  });

  test('restating the same type across allOf branches does not narrow it', () => {
    // `number` intersected with `number` must stay `number`; widening both
    // sides collapsed it to `integer`.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.restate.t.v1.0~';
    const newId = 'gts.x.unit.restate.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, allOf: [{ type: 'number' }, { type: 'number' }] });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'number' });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('compatible');
  });

  test.each([
    ['a non-array allOf', { type: 'object', allOf: { type: 'string' } }],
    ['a non-string $$ref', { type: 'object', $$ref: 123 }],
    ['a property schema that is not a schema', { type: 'object', properties: { name: 1 } }],
  ])('%s makes the comparison inconclusive', (_label, body) => {
    // These are dropped during resolution, so without an explicit check they
    // read as "no constraint" and compare as compatible.
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.badcomp.t.v1.0~';
    const newId = 'gts.x.unit.badcomp.t.v1.1~';

    gts.register({ $$id: oldId, $$schema: DRAFT7, ...(body as Record<string, any>) });
    gts.register({ $$id: newId, $$schema: DRAFT7, type: 'object' });

    expect(gts.checkCompatibility(oldId, newId).full_compatibility).toBe('unknown');
  });
});

describe('OP#8 - identifiers and reference resolution', () => {
  test('accepts gts:// URI form for either identifier', () => {
    const gts = new GTS({ validateRefs: false });
    const oldId = 'gts.x.unit.uri.evt.v1.0~';
    const newId = 'gts.x.unit.uri.evt.v1.1~';

    const body = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    };
    gts.register({ $$id: oldId, $$schema: DRAFT7, ...body });
    gts.register({ $$id: newId, $$schema: DRAFT7, ...body });

    const result = gts.checkCompatibility(`gts://${oldId}`, `gts://${newId}`);

    expect(result.full_compatibility).toBe('compatible');
    expect(result.old).toBe(oldId);
    expect(result.new).toBe(newId);
  });

  test('a widened $ref target makes the containing type backward-only compatible', () => {
    const gts = new GTS({ validateRefs: false });

    gts.register({
      $$id: 'gts.x.unit.ref.target.v1.0~',
      $$schema: DRAFT7,
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string', enum: ['a', 'b'] } },
    });
    gts.register({
      $$id: 'gts.x.unit.ref.target.v1.1~',
      $$schema: DRAFT7,
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string', enum: ['a', 'b', 'c'] } },
    });
    gts.register({
      $$id: 'gts.x.unit.ref.holder.v1.0~',
      $$schema: DRAFT7,
      type: 'object',
      required: ['detail'],
      properties: { detail: { $$ref: 'gts://gts.x.unit.ref.target.v1.0~' } },
    });
    gts.register({
      $$id: 'gts.x.unit.ref.holder.v1.1~',
      $$schema: DRAFT7,
      type: 'object',
      required: ['detail'],
      properties: { detail: { $$ref: 'gts://gts.x.unit.ref.target.v1.1~' } },
    });

    const result = gts.checkCompatibility('gts.x.unit.ref.holder.v1.0~', 'gts.x.unit.ref.holder.v1.1~');

    // The verdict follows the effective resolved schemas, not the identifiers.
    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('incompatible');
  });
});

describe('OP#8 - SchemaResolver.resolve() is bounded by a path-count budget', () => {
  // `SchemaResolver.resolve()` does not cache resolved `$ref` targets across
  // sibling `allOf` branches: a diamond ancestor reached through more than
  // one path is re-resolved from scratch every time (caching by target id is
  // unsound here - the same ancestor can legitimately be reached at
  // different depths, and `resolve()`'s own `MAX_SCHEMA_DEPTH` bailout must
  // be evaluated fresh at each). Without a cache, a diamond-shaped `allOf`/
  // `$ref` graph makes `resolve()` itself - independent of anything
  // downstream - cost time exponential in the number of root-to-leaf paths
  // through it. `resolve()` counts every `$ref` follow and `allOf` branch
  // recursion against the same shared `MAX_SCHEMA_PATHS` budget (10,000)
  // `resolveTraitSchemaRefs` uses, and bails out the same way this class
  // already bails out on `MAX_SCHEMA_DEPTH`: marking the affected branch
  // unresolved so the verdict fails closed (`unknown`, or an already-
  // conservative `incompatible`), never returning a false `compatible`.

  const baseType = (id: string, extra: Record<string, unknown> = {}) => ({
    $$id: id,
    $$schema: DRAFT7,
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    ...extra,
  });

  test('a chain where every level doubles its composition paths is rejected fast, not with a multi-second/OOM resolve', () => {
    // Each level's `allOf` is `[{$$ref: prev}, {$$ref: prev}]` - the same
    // ancestor referenced twice - so composition paths double exactly once
    // per level. 12 levels alone (2^12 = 4096 branch points, each also
    // following a `$ref`) already clears the 10,000-path budget, so this
    // stays small and fast even though, pre-fix, this exact shape measured
    // in the tens of seconds by 30 levels.
    const gts = new GTS({ validateRefs: false });

    const prev = 'gts.x.unit.compatpathbudget.a0.v1~';
    gts.register(baseType(prev));

    const DEPTH = 12;
    let cur = prev;
    for (let i = 1; i <= DEPTH; i++) {
      const next = `gts.x.unit.compatpathbudget.a${i}.v1~`;
      gts.register(baseType(next, { allOf: [{ $$ref: `gts://${cur}` }, { $$ref: `gts://${cur}` }] }));
      cur = next;
    }

    const start = Date.now();
    const result = gts.checkCompatibility(cur, cur);
    const elapsedMs = Date.now() - start;

    // Fail-closed: never a false `compatible` once the budget is exceeded.
    expect(result.backward_compatibility).not.toBe('compatible');
    expect(result.forward_compatibility).not.toBe('compatible');
    // Well under a second - this must fail fast, not hang.
    expect(elapsedMs).toBeLessThan(500);
  });

  test('a legitimate, well under-budget doubling chain still resolves to a genuine compatible verdict', () => {
    // Control for the guard above, using the same doubling shape at a depth
    // (8 levels, 256 paths) nowhere near the 10,000-path budget.
    const gts = new GTS({ validateRefs: false });

    const prev = 'gts.x.unit.compatpathbudgetok.a0.v1~';
    gts.register(baseType(prev));

    const DEPTH = 8;
    let cur = prev;
    for (let i = 1; i <= DEPTH; i++) {
      const next = `gts.x.unit.compatpathbudgetok.a${i}.v1~`;
      gts.register(baseType(next, { allOf: [{ $$ref: `gts://${cur}` }, { $$ref: `gts://${cur}` }] }));
      cur = next;
    }

    const start = Date.now();
    const result = gts.checkCompatibility(cur, cur);
    const elapsedMs = Date.now() - start;

    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('compatible');
    expect(elapsedMs).toBeLessThan(500);
  });

  test('a legitimate, realistic two-ancestor diamond chain resolves correctly and quickly', () => {
    // Control using the shape a real derivation hierarchy would actually
    // take: level i's `allOf` reaches both level i-1 and level i-2. This
    // grows far more slowly than the doubling shape above (it follows
    // Fibonacci-rate growth in composition paths, not 2^n), so a
    // meaningfully large hierarchy (14 levels) still resolves to a genuine
    // answer well within the path budget.
    const gts = new GTS({ validateRefs: false });

    const prevA = 'gts.x.unit.compatdiamondok.a0.v1~';
    const prevB = 'gts.x.unit.compatdiamondok.b0.v1~';
    gts.register(baseType(prevA, { properties: { id: { type: 'string' }, p0: { type: 'string' } } }));
    gts.register(baseType(prevB, { properties: { id: { type: 'string' }, q0: { type: 'string' } } }));

    const DEPTH = 14;
    let a = prevA;
    let b = prevB;
    for (let i = 1; i <= DEPTH; i++) {
      const next = `gts.x.unit.compatdiamondok.a${i}.v1~`;
      gts.register(baseType(next, { allOf: [{ $$ref: `gts://${a}` }, { $$ref: `gts://${b}` }] }));
      b = a;
      a = next;
    }

    const start = Date.now();
    const result = gts.checkCompatibility(a, a);
    const elapsedMs = Date.now() - start;

    expect(result.backward_compatibility).toBe('compatible');
    expect(result.forward_compatibility).toBe('compatible');
    expect(elapsedMs).toBeLessThan(500);
  });
});
