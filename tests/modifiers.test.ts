import { GTS, GtsModifiers } from '../src';

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';

describe('GTS Type Schema Modifiers (spec §9.11)', () => {
  describe('reading the modifiers', () => {
    test('only the literal `true` enables a modifier', () => {
      expect(GtsModifiers.isFinal({ 'x-gts-final': true })).toBe(true);
      expect(GtsModifiers.isFinal({ 'x-gts-final': false })).toBe(false);
      expect(GtsModifiers.isFinal({})).toBe(false);
      // A non-boolean is invalid, and must not be read as truthy.
      expect(GtsModifiers.isFinal({ 'x-gts-final': 'yes' })).toBe(false);

      expect(GtsModifiers.isAbstract({ 'x-gts-abstract': true })).toBe(true);
      expect(GtsModifiers.isAbstract({ 'x-gts-abstract': false })).toBe(false);
      expect(GtsModifiers.isAbstract({})).toBe(false);
    });
  });

  describe('validateDeclaration', () => {
    test('accepts absent, false and true declarations', () => {
      expect(GtsModifiers.validateDeclaration({})).toBeNull();
      expect(GtsModifiers.validateDeclaration({ 'x-gts-final': true })).toBeNull();
      expect(GtsModifiers.validateDeclaration({ 'x-gts-abstract': true })).toBeNull();
      expect(GtsModifiers.validateDeclaration({ 'x-gts-final': true, 'x-gts-abstract': false })).toBeNull();
    });

    test('rejects non-boolean values', () => {
      expect(GtsModifiers.validateDeclaration({ 'x-gts-final': 'yes' })).toContain('x-gts-final');
      expect(GtsModifiers.validateDeclaration({ 'x-gts-abstract': 1 })).toContain('x-gts-abstract');
    });

    test('rejects the meaningless final + abstract combination', () => {
      const error = GtsModifiers.validateDeclaration({ 'x-gts-final': true, 'x-gts-abstract': true });
      expect(error).toMatch(/must not declare both/);
    });
  });

  describe('findMisplacedKeywords', () => {
    test('accepts all four keywords at the document top level', () => {
      expect(
        GtsModifiers.findMisplacedKeywords({
          $$id: 'gts.x.unit.mod.top.v1~',
          type: 'object',
          'x-gts-final': true,
          'x-gts-traits-schema': { type: 'object', properties: { a: { type: 'string' } } },
          'x-gts-traits': { a: 'value' },
        })
      ).toEqual([]);
    });

    test('rejects a modifier nested in an allOf entry', () => {
      const found = GtsModifiers.findMisplacedKeywords({
        type: 'object',
        allOf: [{ $$ref: 'gts://gts.x.unit.mod.base.v1~' }, { type: 'object', 'x-gts-final': true }],
      });
      expect(found).toEqual(['allOf[1]/x-gts-final']);
    });

    test('rejects a keyword nested in a property subschema', () => {
      const found = GtsModifiers.findMisplacedKeywords({
        type: 'object',
        properties: { nested: { type: 'object', 'x-gts-traits': { topicRef: 'x' } } },
      });
      expect(found).toEqual(['properties/nested/x-gts-traits']);
    });

    test('rejects a keyword nested in a definitions entry', () => {
      const found = GtsModifiers.findMisplacedKeywords({
        type: 'object',
        definitions: { Sub: { type: 'object', 'x-gts-abstract': true } },
      });
      expect(found).toEqual(['definitions/Sub/x-gts-abstract']);
    });

    test('reports every misplacement, not just the first', () => {
      const found = GtsModifiers.findMisplacedKeywords({
        type: 'object',
        allOf: [{ 'x-gts-abstract': true }],
        properties: { nested: { 'x-gts-final': true } },
      });
      expect(found).toHaveLength(2);
    });

    test('does not descend into the values of the top-level keywords', () => {
      // A trait *value* that happens to be keyed like a keyword is ordinary
      // data, and a trait-schema body may legitimately carry x-gts-* members.
      expect(
        GtsModifiers.findMisplacedKeywords({
          type: 'object',
          'x-gts-traits': { 'x-gts-final': 'just a string value' },
          'x-gts-traits-schema': { type: 'object', properties: { 'x-gts-abstract': { type: 'boolean' } } },
        })
      ).toEqual([]);
    });
  });
});

describe('x-gts-final / x-gts-abstract enforcement through the registry', () => {
  const base = (id: string, extra: Record<string, any> = {}) => ({
    $$id: id,
    $$schema: DRAFT7,
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    ...extra,
  });

  const derived = (id: string, baseRef: string, extra: Record<string, any> = {}) => ({
    $$id: id,
    $$schema: DRAFT7,
    type: 'object',
    allOf: [{ $$ref: `gts://${baseRef}` }, { type: 'object' }],
    ...extra,
  });

  test('a final base cannot be extended', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.fin.v1~', { 'x-gts-final': true }));
    gts.register(derived('gts.x.unit.fa.fin.v1~x.unit._.kid.v1~', 'gts.x.unit.fa.fin.v1~'));

    const result = gts.validateEntity('gts.x.unit.fa.fin.v1~x.unit._.kid.v1~');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/final/);
  });

  test('finality does not propagate to siblings of the final type', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.sib.v1~'));
    gts.register(derived('gts.x.unit.fa.sib.v1~x.unit._.fin.v1~', 'gts.x.unit.fa.sib.v1~', { 'x-gts-final': true }));
    gts.register(derived('gts.x.unit.fa.sib.v1~x.unit._.other.v1~', 'gts.x.unit.fa.sib.v1~'));

    expect(gts.validateEntity('gts.x.unit.fa.sib.v1~x.unit._.other.v1~').ok).toBe(true);
  });

  test('a mid-chain final type blocks its own descendants', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.mid.v1~'));
    gts.register(derived('gts.x.unit.fa.mid.v1~x.unit._.m.v1~', 'gts.x.unit.fa.mid.v1~', { 'x-gts-final': true }));
    gts.register(
      derived('gts.x.unit.fa.mid.v1~x.unit._.m.v1~x.unit._.leaf.v1~', 'gts.x.unit.fa.mid.v1~x.unit._.m.v1~')
    );

    expect(gts.validateEntity('gts.x.unit.fa.mid.v1~x.unit._.m.v1~x.unit._.leaf.v1~').ok).toBe(false);
  });

  test('x-gts-final: false is a no-op', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.nofin.v1~', { 'x-gts-final': false }));
    gts.register(derived('gts.x.unit.fa.nofin.v1~x.unit._.kid.v1~', 'gts.x.unit.fa.nofin.v1~'));

    expect(gts.validateEntity('gts.x.unit.fa.nofin.v1~x.unit._.kid.v1~').ok).toBe(true);
  });

  test('an abstract type rejects direct instances but allows derivation', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.abs.v1~', { 'x-gts-abstract': true }));
    gts.register(derived('gts.x.unit.fa.abs.v1~x.unit._.concrete.v1~', 'gts.x.unit.fa.abs.v1~'));

    // Derivation from an abstract base is exactly what it is for.
    expect(gts.validateEntity('gts.x.unit.fa.abs.v1~x.unit._.concrete.v1~').ok).toBe(true);

    gts.register({ id: 'gts.x.unit.fa.abs.v1~x.unit._.direct.v1' });
    const direct = gts.validateInstance('gts.x.unit.fa.abs.v1~x.unit._.direct.v1');
    expect(direct.ok).toBe(false);
    expect(direct.error).toMatch(/abstract/);

    // An instance of the concrete derived type is fine.
    gts.register({ id: 'gts.x.unit.fa.abs.v1~x.unit._.concrete.v1~x.unit._.ok.v1' });
    expect(gts.validateInstance('gts.x.unit.fa.abs.v1~x.unit._.concrete.v1~x.unit._.ok.v1').ok).toBe(true);
  });

  test('an abstract type rejects a combined anonymous instance', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.anon.v1~', { 'x-gts-abstract': true }));
    const anonId = 'gts.x.unit.fa.anon.v1~c1d2e3f4-5678-4abc-8def-aabbccddeeff';
    gts.register({ id: anonId, type: 'gts.x.unit.fa.anon.v1~' });

    expect(gts.validateInstance(anonId).ok).toBe(false);
  });

  test('a malformed modifier declaration fails validation', () => {
    const gts = new GTS({ validateRefs: false });
    gts.register(base('gts.x.unit.fa.bad.v1~', { 'x-gts-final': true, 'x-gts-abstract': true }));

    expect(gts.validateEntity('gts.x.unit.fa.bad.v1~').ok).toBe(false);
  });
});
