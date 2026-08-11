import { CompatibilityResult, CompatVerdict, GTS_URI_PREFIX } from './types';
import { GtsStore } from './store';
import { Gts } from './gts';

/**
 * Type Schema Evolution Compatibility (GTS spec 0.13 §4.2 - §4.5).
 *
 * Compatibility is defined by accepted-instance-set inclusion (§4.3):
 *
 *   backward: Valid(old) subset-of Valid(new)
 *   forward:  Valid(new) subset-of Valid(old)
 *   full:     Valid(old) == Valid(new)
 *
 * Both directions are therefore the same question asked twice, so the engine
 * implements a single primitive - `subsumes(outer, inner)`, "does `outer`
 * accept every instance `inner` accepts" - and runs it in both directions.
 * Each relation is reported as the tri-state `compatible` / `incompatible` /
 * `unknown`; `unknown` preserves an inconclusive check rather than conflating
 * it with incompatibility.
 */

/** JSON Schema keywords that carry documentation only and never change Valid(S) (§4.3). */
const ANNOTATION_KEYWORDS = new Set([
  'title',
  'description',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
  '$comment',
  '$id',
  '$$id',
  '$schema',
  '$$schema',
  '$defs',
  'definitions',
  // Draft-07 treats `format` as an annotation unless assertion is enabled.
  'format',
]);

/** Keywords the subsumption engine reasons about directly. */
const MODELED_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'unevaluatedProperties',
  'items',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'allOf',
  '$ref',
  '$$ref',
]);

/**
 * Constraining keywords the engine does not model. When these differ between
 * the two schemas the comparison is inconclusive and yields `unknown` rather
 * than a guessed verdict.
 */
const UNMODELED_ASSERTIONS = [
  'oneOf',
  'anyOf',
  'not',
  'if',
  'then',
  'else',
  'pattern',
  'patternProperties',
  'propertyNames',
  'dependencies',
  'dependentSchemas',
  'dependentRequired',
  'multipleOf',
  'contains',
  'additionalItems',
  'uniqueItems',
  // Enforced against instances by OP#6, but the engine does not model whether
  // one reference pattern subsumes another.
  'x-gts-ref',
];

const MAX_DEPTH = 32;

/** A schema whose accepted set is everything, used for undeclared properties of an open model. */
const ANY_SCHEMA = true;

type Schema = any;

/** Worst-case combination: incompatible dominates unknown, which dominates compatible. */
function worst(a: CompatVerdict, b: CompatVerdict): CompatVerdict {
  if (a === 'incompatible' || b === 'incompatible') return 'incompatible';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return 'compatible';
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((k) => k in b && deepEqual(a[k], b[k]));
}

/**
 * `x-gts-*` keywords describe the type rather than the instance, so they do not
 * change Valid(S) - with one exception. `x-gts-ref` is enforced against
 * instances during OP#6 validation, which makes it an assertion: two schemas
 * whose reference patterns accept disjoint targets do not accept the same
 * instances. It is therefore never stripped, and is compared as an unmodeled
 * assertion instead.
 */
function isStrippableGtsKeyword(key: string): boolean {
  return key.startsWith('x-gts-') && key !== 'x-gts-ref';
}

/** Strip annotations and GTS keywords so that documentation-only edits compare equal. */
function stripAnnotations(schema: Schema): Schema {
  if (typeof schema === 'boolean') return schema;
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(stripAnnotations);

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(key) || isStrippableGtsKeyword(key)) continue;
    out[key] = stripAnnotations(value);
  }
  return out;
}

function isEmptySchema(schema: Schema): boolean {
  if (schema === true) return true;
  if (typeof schema !== 'object' || schema === null) return false;
  return Object.keys(stripAnnotations(schema)).length === 0;
}

function typeSet(schema: Schema): Set<string> | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const type = schema.type;
  if (type === undefined) return null;
  return new Set(Array.isArray(type) ? type : [type]);
}

/** `number` also accepts every `integer`, so widen the accepting side. */
function widenNumeric(types: Set<string>): Set<string> {
  const out = new Set(types);
  if (out.has('number')) out.add('integer');
  return out;
}

/**
 * Intersects two `type` keywords, or returns null when they are disjoint - the
 * conjunction then accepts nothing, and the caller collapses the whole schema
 * to `false` rather than keeping one side and pretending it is satisfiable.
 */
function intersectTypes(a: any, b: any): any | null {
  const setA = new Set(Array.isArray(a) ? a : [a]);
  const setB = widenNumeric(new Set(Array.isArray(b) ? b : [b]));
  const both = Array.from(widenNumeric(setA)).filter((t) => setB.has(t));
  // Prefer the most specific surviving type (integer over number).
  if (both.includes('integer') && both.includes('number')) {
    return 'integer';
  }
  if (both.length === 0) return null;
  return both.length === 1 ? both[0] : both;
}

/** The finite value set a schema pins down via `const` / `enum`, or null if unconstrained. */
function fixedValues(schema: Schema): any[] | null {
  if (typeof schema !== 'object' || schema === null) return null;
  if ('const' in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum;
  return null;
}

type ContentModel = 'open' | 'closed' | 'partial';

function contentModel(schema: Schema): ContentModel {
  if (typeof schema !== 'object' || schema === null) return 'open';
  const ap = schema.additionalProperties;
  const up = schema.unevaluatedProperties;
  if (ap === false || up === false) return 'closed';
  if (ap === undefined || ap === true || isEmptySchema(ap)) return 'open';
  return 'partial';
}

/**
 * The schema an undeclared property must satisfy, or null when the level
 * rejects undeclared properties outright.
 */
function undeclaredSchema(schema: Schema): Schema | null {
  const model = contentModel(schema);
  if (model === 'closed') return null;
  if (model === 'open') return ANY_SCHEMA;
  return schema.additionalProperties;
}

/** Conjunction of two schemas, used to flatten `allOf` and `$ref` into one effective schema. */
function mergeSchemas(a: Schema, b: Schema): Schema {
  if (a === false || b === false) return false;
  const left = a === true || a === undefined ? {} : a;
  const right = b === true || b === undefined ? {} : b;
  if (typeof left !== 'object' || typeof right !== 'object') return left;

  const out: Record<string, any> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!(key in out)) {
      out[key] = value;
      continue;
    }
    const current = out[key];
    switch (key) {
      case 'required':
        out[key] = Array.from(new Set([...(current || []), ...(value as any[])]));
        break;
      case 'properties': {
        const merged: Record<string, any> = { ...current };
        for (const [prop, propSchema] of Object.entries(value as Record<string, any>)) {
          merged[prop] = prop in merged ? mergeSchemas(merged[prop], propSchema) : propSchema;
        }
        out[key] = merged;
        break;
      }
      case 'additionalProperties':
      case 'unevaluatedProperties':
        if (current === false || value === false) out[key] = false;
        else if (current === true || current === undefined) out[key] = value;
        else if (value === true) out[key] = current;
        else out[key] = mergeSchemas(current, value);
        break;
      case 'type': {
        const intersection = intersectTypes(current, value);
        // Disjoint types across `allOf` branches: the conjunction is the
        // unsatisfiable schema, which accepts no instance at all.
        if (intersection === null) return false;
        out[key] = intersection;
        break;
      }
      case 'enum':
        // Schemas are registered without meta-validation, so a branch may carry
        // a malformed keyword. Keep the left-hand value rather than throwing;
        // the divergence then surfaces through the normal comparison.
        if (Array.isArray(current) && Array.isArray(value)) {
          out[key] = current.filter((x) => value.some((y) => deepEqual(x, y)));
        }
        break;
      case 'items':
        out[key] = mergeSchemas(current, value);
        break;
      case 'minimum':
      case 'exclusiveMinimum':
      case 'minLength':
      case 'minItems':
        if (typeof current === 'number' && typeof value === 'number') {
          out[key] = Math.max(current, value);
        }
        break;
      case 'maximum':
      case 'exclusiveMaximum':
      case 'maxLength':
      case 'maxItems':
        if (typeof current === 'number' && typeof value === 'number') {
          out[key] = Math.min(current, value);
        }
        break;
      default:
        // Keep the left-hand value; unmodeled divergence surfaces as `unknown`.
        break;
    }
  }
  return out;
}

/**
 * Resolves a schema to its effective form at one level: `$ref` targets and
 * `allOf` branches are merged in, per §4.4 ("classify the level from the
 * resolved effective schema"). Nested subschemas stay unresolved and are
 * resolved lazily when they are compared.
 */
class SchemaResolver {
  private unresolved = false;

  constructor(private store: GtsStore) {}

  /** True when any `$ref` encountered so far could not be resolved. */
  get hadUnresolvedRef(): boolean {
    return this.unresolved;
  }

  resolve(schema: Schema, depth = 0): Schema {
    if (schema === false) return false;
    if (schema === true || schema === undefined || schema === null) return {};
    if (typeof schema !== 'object') return {};
    if (depth > MAX_DEPTH) return {};

    const { allOf, $ref, $$ref, ...rest } = schema as Record<string, any>;
    let effective: Schema = rest;

    const ref = $ref || $$ref;
    if (typeof ref === 'string') {
      const target = this.lookupRef(ref);
      if (target === null) {
        this.unresolved = true;
      } else {
        effective = mergeSchemas(this.resolve(target, depth + 1), effective);
      }
    }

    if (Array.isArray(allOf)) {
      for (const branch of allOf) {
        effective = mergeSchemas(effective, this.resolve(branch, depth + 1));
      }
    }

    return effective;
  }

  private lookupRef(ref: string): Schema | null {
    // Local pointers are not followed; they are left to the unmodeled check.
    if (ref.startsWith('#')) return null;

    const id = ref.startsWith(GTS_URI_PREFIX) ? ref.substring(GTS_URI_PREFIX.length) : ref;
    if (!Gts.isValidGtsID(id)) return null;

    const entity = this.store.get(id);
    if (!entity || !entity.isSchema || !entity.content) return null;
    return entity.content;
  }
}

class SubsumptionChecker {
  private resolver: SchemaResolver;

  constructor(store: GtsStore) {
    this.resolver = new SchemaResolver(store);
  }

  /**
   * A reference the resolver could not follow (a local JSON pointer, or a GTS
   * identifier that is not registered) means part of the schema was never
   * compared. Any `compatible` reached under that condition is downgraded to
   * `unknown` so the check fails closed rather than passing on the strength of
   * the fragment that happened to be visible.
   */
  private finalize(verdict: CompatVerdict): CompatVerdict {
    return this.resolver.hadUnresolvedRef && verdict === 'compatible' ? 'unknown' : verdict;
  }

  /** Verdict for `Valid(inner) subset-of Valid(outer)`. */
  subsumes(outerRaw: Schema, innerRaw: Schema, depth = 0): CompatVerdict {
    if (depth > MAX_DEPTH) return 'unknown';

    const outer = this.resolver.resolve(outerRaw, depth);
    const inner = this.resolver.resolve(innerRaw, depth);

    if (inner === false) return this.finalize('compatible'); // accepts nothing, trivially included
    if (outer === false) return 'incompatible';
    if (isEmptySchema(outer)) return this.finalize('compatible'); // accepts everything

    const outerNorm = stripAnnotations(outer);
    const innerNorm = stripAnnotations(inner);
    if (deepEqual(outerNorm, innerNorm)) return this.finalize('compatible');

    let verdict: CompatVerdict = 'compatible';
    verdict = worst(verdict, this.compareTypes(outerNorm, innerNorm));
    verdict = worst(verdict, this.compareFixedValues(outerNorm, innerNorm));
    verdict = worst(verdict, this.compareBounds(outerNorm, innerNorm));
    verdict = worst(verdict, this.compareObjects(outerNorm, innerNorm, depth));
    verdict = worst(verdict, this.compareArrays(outerNorm, innerNorm, depth));
    verdict = worst(verdict, this.compareUnmodeled(outerNorm, innerNorm));

    return this.finalize(verdict);
  }

  private compareTypes(outer: Schema, inner: Schema): CompatVerdict {
    const outerTypes = typeSet(outer);
    if (outerTypes === null) return 'compatible'; // outer accepts any type
    const innerTypes = typeSet(inner);
    if (innerTypes === null) return 'incompatible'; // inner accepts types outer rejects

    const accepted = widenNumeric(outerTypes);
    return Array.from(innerTypes).every((t) => accepted.has(t)) ? 'compatible' : 'incompatible';
  }

  private compareFixedValues(outer: Schema, inner: Schema): CompatVerdict {
    const outerValues = fixedValues(outer);
    if (outerValues === null) return 'compatible'; // outer does not pin values down
    const innerValues = fixedValues(inner);
    if (innerValues === null) return 'incompatible'; // inner admits values outside outer's set

    return innerValues.every((v) => outerValues.some((o) => deepEqual(o, v))) ? 'compatible' : 'incompatible';
  }

  private compareBounds(outer: Schema, inner: Schema): CompatVerdict {
    const BOUND_KEYWORDS = [
      'minimum',
      'exclusiveMinimum',
      'maximum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
    ];

    // A bound present but not numeric is a malformed schema, not a constraint
    // the engine can reason about, so the comparison is inconclusive.
    const malformed = (schema: Schema, key: string) => key in schema && typeof schema[key] !== 'number';
    for (const key of BOUND_KEYWORDS) {
      if (malformed(outer, key) || malformed(inner, key)) return 'unknown';
    }

    // The inclusive and exclusive forms constrain the same axis, so they are
    // normalized to (value, exclusive) before being compared. Without this,
    // `minimum: 0` and `exclusiveMinimum: 0` look like unrelated keywords even
    // though `x > 0` is a strict subset of `x >= 0`.
    const axes: Array<{ inclusive: string; exclusive?: string; isLower: boolean }> = [
      { inclusive: 'minimum', exclusive: 'exclusiveMinimum', isLower: true },
      { inclusive: 'maximum', exclusive: 'exclusiveMaximum', isLower: false },
      { inclusive: 'minLength', isLower: true },
      { inclusive: 'maxLength', isLower: false },
      { inclusive: 'minItems', isLower: true },
      { inclusive: 'maxItems', isLower: false },
    ];

    for (const axis of axes) {
      const outerBound = this.readBound(outer, axis);
      if (outerBound === null) continue; // outer constrains nothing on this axis
      const innerBound = this.readBound(inner, axis);
      if (innerBound === null) return 'incompatible'; // inner is unbounded where outer is not

      if (!this.isAtLeastAsStrict(innerBound, outerBound, axis.isLower)) return 'incompatible';
    }

    return 'compatible';
  }

  /** The effective bound on one axis as `(value, exclusive)`, or null when unconstrained. */
  private readBound(
    schema: Schema,
    axis: { inclusive: string; exclusive?: string; isLower: boolean }
  ): { value: number; exclusive: boolean } | null {
    const inclusive = schema[axis.inclusive];
    const exclusive = axis.exclusive ? schema[axis.exclusive] : undefined;

    const candidates: Array<{ value: number; exclusive: boolean }> = [];
    if (typeof inclusive === 'number') candidates.push({ value: inclusive, exclusive: false });
    if (typeof exclusive === 'number') candidates.push({ value: exclusive, exclusive: true });
    if (candidates.length === 0) return null;

    // Both forms present: the tighter one wins, matching `allOf` conjunction.
    return candidates.reduce((strictest, candidate) =>
      this.isAtLeastAsStrict(candidate, strictest, axis.isLower) ? candidate : strictest
    );
  }

  private isAtLeastAsStrict(
    candidate: { value: number; exclusive: boolean },
    reference: { value: number; exclusive: boolean },
    isLower: boolean
  ): boolean {
    if (candidate.value === reference.value) {
      // At the same value, excluding the endpoint is the stricter constraint.
      return candidate.exclusive || !reference.exclusive;
    }
    return isLower ? candidate.value > reference.value : candidate.value < reference.value;
  }

  private compareObjects(outer: Schema, inner: Schema, depth: number): CompatVerdict {
    const outerProps: Record<string, any> = outer.properties || {};
    const innerProps: Record<string, any> = inner.properties || {};
    const hasObjectKeywords =
      'properties' in outer ||
      'properties' in inner ||
      'required' in outer ||
      'required' in inner ||
      'additionalProperties' in outer ||
      'additionalProperties' in inner;
    if (!hasObjectKeywords) return 'compatible';

    // Outer may not demand a property the inner schema allows to be absent.
    const outerRequired: string[] = outer.required || [];
    const innerRequired = new Set<string>(inner.required || []);
    for (const name of outerRequired) {
      if (!innerRequired.has(name)) return 'incompatible';
    }

    let verdict: CompatVerdict = 'compatible';

    const outerUndeclared = undeclaredSchema(outer);
    const innerUndeclared = undeclaredSchema(inner);

    const names = new Set([...Object.keys(outerProps), ...Object.keys(innerProps)]);
    for (const name of names) {
      const innerPropSchema = name in innerProps ? innerProps[name] : innerUndeclared;
      // The inner schema cannot carry this property at all - nothing to check.
      if (innerPropSchema === null) continue;

      const outerPropSchema = name in outerProps ? outerProps[name] : outerUndeclared;
      if (outerPropSchema === null) return 'incompatible';

      verdict = worst(verdict, this.subsumes(outerPropSchema, innerPropSchema, depth + 1));
      if (verdict === 'incompatible') return verdict;
    }

    // Property names declared by neither schema.
    if (innerUndeclared !== null) {
      if (outerUndeclared === null) return 'incompatible';
      verdict = worst(verdict, this.subsumes(outerUndeclared, innerUndeclared, depth + 1));
    }

    return verdict;
  }

  private compareArrays(outer: Schema, inner: Schema, depth: number): CompatVerdict {
    if (!('items' in outer) && !('items' in inner)) return 'compatible';
    const outerItems = outer.items;
    const innerItems = inner.items;
    // Tuple-form `items` is not modeled.
    if (Array.isArray(outerItems) || Array.isArray(innerItems)) {
      return deepEqual(outerItems, innerItems) ? 'compatible' : 'unknown';
    }
    return this.subsumes(
      outerItems === undefined ? ANY_SCHEMA : outerItems,
      innerItems === undefined ? ANY_SCHEMA : innerItems,
      depth + 1
    );
  }

  private compareUnmodeled(outer: Schema, inner: Schema): CompatVerdict {
    for (const key of UNMODELED_ASSERTIONS) {
      const inOuter = key in outer;
      const inInner = key in inner;
      if (!inOuter && !inInner) continue;
      if (!deepEqual(outer[key], inner[key])) return 'unknown';
    }

    // Any other keyword we neither model nor recognise as an annotation.
    const extraKeys = new Set(
      [...Object.keys(outer), ...Object.keys(inner)].filter(
        (k) => !MODELED_KEYWORDS.has(k) && !UNMODELED_ASSERTIONS.includes(k)
      )
    );
    for (const key of extraKeys) {
      if (!deepEqual(outer[key], inner[key])) return 'unknown';
    }

    return 'compatible';
  }
}

export class GtsCompatibility {
  /**
   * Compares two schema documents directly (rather than by identifier) and
   * reports both evolution relations.
   */
  static compareSchemas(
    store: GtsStore,
    oldSchema: Schema,
    newSchema: Schema
  ): { backward: CompatVerdict; forward: CompatVerdict } {
    return {
      backward: new SubsumptionChecker(store).subsumes(newSchema, oldSchema),
      forward: new SubsumptionChecker(store).subsumes(oldSchema, newSchema),
    };
  }

  static checkCompatibility(
    store: GtsStore,
    oldId: string,
    newId: string,
    _mode: 'backward' | 'forward' | 'full' = 'full'
  ): CompatibilityResult {
    const normalizedOld = this.normalizeId(oldId);
    const normalizedNew = this.normalizeId(newId);

    const oldEntity = store.get(normalizedOld);
    const newEntity = store.get(normalizedNew);

    const missing: string[] = [];
    if (!oldEntity) missing.push(`Old type schema not found: ${oldId}`);
    else if (!oldEntity.isSchema) missing.push(`Old entity is not a type schema: ${oldId}`);
    if (!newEntity) missing.push(`New type schema not found: ${newId}`);
    else if (!newEntity.isSchema) missing.push(`New entity is not a type schema: ${newId}`);

    if (missing.length > 0) {
      // The check cannot be performed, which is inconclusive rather than incompatible.
      return this.buildResult(normalizedOld, normalizedNew, 'unknown', 'unknown', missing, missing);
    }

    const oldSchema = oldEntity!.content;
    const newSchema = newEntity!.content;

    try {
      // backward: Valid(old) subset-of Valid(new); forward: Valid(new) subset-of Valid(old).
      const { backward, forward } = this.compareSchemas(store, oldSchema, newSchema);

      return this.buildResult(
        normalizedOld,
        normalizedNew,
        backward,
        forward,
        backward === 'compatible' ? [] : [`Backward compatibility is ${backward}`],
        forward === 'compatible' ? [] : [`Forward compatibility is ${forward}`]
      );
    } catch (error) {
      // Schemas are registered without meta-validation, so a malformed document
      // can reach the engine. That makes the check inconclusive - it must not
      // take the caller down with it.
      const reason = `Compatibility check failed: ${error instanceof Error ? error.message : String(error)}`;
      return this.buildResult(normalizedOld, normalizedNew, 'unknown', 'unknown', [reason], []);
    }
  }

  private static normalizeId(id: string): string {
    return id.startsWith(GTS_URI_PREFIX) ? id.substring(GTS_URI_PREFIX.length) : id;
  }

  /** Full compatibility holds only when both directions hold (§4.3). */
  private static fullVerdict(backward: CompatVerdict, forward: CompatVerdict): CompatVerdict {
    if (backward === 'incompatible' || forward === 'incompatible') return 'incompatible';
    if (backward === 'unknown' || forward === 'unknown') return 'unknown';
    return 'compatible';
  }

  private static buildResult(
    oldId: string,
    newId: string,
    backward: CompatVerdict,
    forward: CompatVerdict,
    backwardErrors: string[],
    forwardErrors: string[]
  ): CompatibilityResult {
    const full = this.fullVerdict(backward, forward);

    return {
      old: oldId,
      new: newId,
      backward_compatibility: backward,
      forward_compatibility: forward,
      full_compatibility: full,
      from: oldId,
      to: newId,
      direction: this.inferDirection(oldId, newId),
      added_properties: [],
      removed_properties: [],
      changed_properties: [],
      is_fully_compatible: full === 'compatible',
      is_backward_compatible: backward === 'compatible',
      is_forward_compatible: forward === 'compatible',
      // A reason that applies to both directions is reported once.
      incompatibility_reasons: Array.from(new Set([...backwardErrors, ...forwardErrors])),
      backward_errors: backwardErrors,
      forward_errors: forwardErrors,
    };
  }

  private static inferDirection(fromId: string, toId: string): string {
    try {
      const fromGtsId = Gts.parseGtsID(fromId);
      const toGtsId = Gts.parseGtsID(toId);

      if (!fromGtsId.segments.length || !toGtsId.segments.length) {
        return 'unknown';
      }

      const fromSeg = fromGtsId.segments[fromGtsId.segments.length - 1];
      const toSeg = toGtsId.segments[toGtsId.segments.length - 1];

      if (fromSeg.verMajor < toSeg.verMajor) return 'upgrade';
      if (fromSeg.verMajor > toSeg.verMajor) return 'downgrade';
      if ((fromSeg.verMinor || 0) < (toSeg.verMinor || 0)) return 'upgrade';
      if ((fromSeg.verMinor || 0) > (toSeg.verMinor || 0)) return 'downgrade';

      return 'same';
    } catch {
      return 'unknown';
    }
  }
}
