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

  test('an unresolvable type identifier is unknown rather than incompatible', () => {
    const gts = new GTS({ validateRefs: false });

    const result = gts.checkCompatibility('gts.x.unit.unknown.missing.v1.0~', 'gts.x.unit.unknown.missing.v1.1~');

    expect(result.backward_compatibility).toBe('unknown');
    expect(result.forward_compatibility).toBe('unknown');
    expect(result.full_compatibility).toBe('unknown');
    expect(result.incompatibility_reasons.length).toBeGreaterThan(0);
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
