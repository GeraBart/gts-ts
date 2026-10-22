/*
 * CSP-safe JSON Schema engine for GTS, built on json-schema-library (no code
 * generation from strings). Each `createSchemaEngine` call returns
 * an independent instance that owns its drafts, its per-dialect `$ref` remote
 * pool and its issue adapter; there is no module-level mutable state.
 *
 * GTS extensions applied to the draft-07 / 2019-09 / 2020-12 drafts:
 *  - `x-gts-ref` keyword (shared logic in `xGtsRefKeywordViolation`, `x-gts-ref.ts`);
 *  - `pattern` / `patternProperties` / `format: regex` through `compileSafePattern` (re2js);
 *  - GTS `date-time` / `time` / `regex` formats (ADR-0005) and the standard `uri`, `uri-reference`,
 *    `uri-template`, `hostname`, `ipv4`, `ipv6` formats the library lacks;
 *  - an `additionalProperties` validator without the library's `_id` blacklist.
 * Errors are mapped to the existing `ValidationIssue` shape.
 */

import {
  compileSchema,
  draft07,
  draft2019,
  draft2020,
  extendDraft,
  isSchemaNode,
  type Draft,
  type JsonError,
  type JsonSchemaValidatorParams,
  type Keyword,
  type SchemaNode,
} from 'json-schema-library';
import {
  isValidDateTime,
  isValidHostname,
  isValidIpv4,
  isValidIpv6,
  isValidRegex,
  isValidTimePart,
  isValidUri,
  isValidUriReference,
  isValidUriTemplate,
} from './gts-format-checkers';
import { compileSafePattern, RegexCompilationError } from './regex-engine';
import { dialectOf, type SchemaDialect } from './schema-dialect';
import type { ValidationIssue } from './types';
import { xGtsRefKeywordViolation } from './x-gts-ref';

// ---------------------------------------------------------------------------
// Issue adapter
// ---------------------------------------------------------------------------

type LibraryData = Record<string, any>;
type ParamExtractor = (data: LibraryData) => unknown;

interface IssueCodeRow {
  /** JSON Schema keyword reported as `ValidationIssue.keyword` (derived from the error data when dialect-dependent). */
  keyword: string | ((data: LibraryData) => string);
  /** `pointer`: the data pointer as is; `parent`: the pointer minus the offending child. */
  path: 'pointer' | 'parent';
  /** Param name to extractor; only these keys are ever emitted. */
  params: Record<string, ParamExtractor>;
}

/** Numeric-looking segments become numbers (array indexes are reported as numbers). */
const indexOrString = (segment: string): string | number => (/^\d+$/.test(segment) ? Number(segment) : segment);

/** Last path segment of a raw (unescaped) library pointer, unescaped. */
function lastPointerSegment(data: LibraryData): string {
  const pointer = String(data.pointer ?? '');
  const index = pointer.lastIndexOf('/');
  return index === -1 ? pointer.replace(/^#/, '') : pointer.slice(index + 1);
}

const from =
  (key: string): ParamExtractor =>
  (data) =>
    data[key];
const lit =
  (value: unknown): ParamExtractor =>
  () =>
    value;
const propertyOrKey: ParamExtractor = (data) => data.property ?? data.key;
const lastSegment: ParamExtractor = (data) => data.property ?? data.key ?? lastPointerSegment(data);
const schemaKey =
  (key: string): ParamExtractor =>
  (data) =>
    data.schema?.[key];
/** Ajv-style `contains` params: `minContains` defaults to 1 and `maxContains` is only present when declared. */
const containsParams = {
  minContains: (data: LibraryData) => data.schema?.minContains ?? 1,
  maxContains: schemaKey('maxContains'),
};
/** Draft-07 `dependencies` and 2019-09+ `dependentRequired` share one library code; Ajv names them differently. */
const dependencyKeyword = (data: LibraryData): string =>
  data.schema?.dependencies !== undefined
    ? 'dependencies'
    : data.missingProperty === undefined
      ? 'dependentSchemas'
      : 'dependentRequired';

function row(
  keyword: IssueCodeRow['keyword'],
  path: 'pointer' | 'parent',
  params: Record<string, ParamExtractor> = {}
): IssueCodeRow {
  return { keyword, path, params };
}
const fmt = (name: string): IssueCodeRow => row('format', 'pointer', { format: lit(name) });
const plain = (keyword: string): IssueCodeRow => row(keyword, 'pointer');

/**
 * Library error code to `ValidationIssue` mapping (seeded from the canonical
 * adapter code table). Completeness against the runtime `Draft.errors` map is
 * enforced by a unit test; an unmapped code makes the adapter throw.
 */
export const ISSUE_CODE_TABLE: Readonly<Record<string, IssueCodeRow>> = {
  'additional-items-error': row('additionalItems', 'parent', { limit: from('key') }),
  'additional-properties-error': row('additionalProperties', 'parent', { additionalProperty: propertyOrKey }),
  'all-of-error': plain('allOf'),
  'any-of-error': plain('anyOf'),
  'const-error': row('const', 'pointer', { allowedValue: from('expected') }),
  'contains-any-error': plain('contains'),
  'contains-array-error': plain('contains'),
  // Phase 3: Ajv reports `contains` (not minContains / maxContains) with minContains / maxContains params.
  // 11.6.14 never emits `contains-error` (a plain miss is `contains-min-error`); kept for the same shape.
  'contains-error': row('contains', 'pointer', containsParams),
  'contains-max-error': row('contains', 'pointer', containsParams),
  'contains-min-error': row('contains', 'pointer', containsParams),
  'enum-error': row('enum', 'pointer', { allowedValues: from('values') }),
  'exclusive-maximum-error': row('exclusiveMaximum', 'pointer', { comparison: lit('<'), limit: from('maximum') }),
  'exclusive-minimum-error': row('exclusiveMinimum', 'pointer', { comparison: lit('>'), limit: from('minimum') }),
  'forbidden-property-error': row('propertyNames', 'pointer', { propertyName: from('property') }),
  'format-date-error': fmt('date'),
  'format-date-time-error': fmt('date-time'),
  'format-duration-error': fmt('duration'),
  'format-email-error': fmt('email'),
  'format-hostname-error': fmt('hostname'),
  'format-idn-hostname-error': fmt('idn-hostname'),
  'format-ipv4-error': fmt('ipv4'),
  'format-ipv4-leading-zero-error': fmt('ipv4'),
  'format-ipv6-error': fmt('ipv6'),
  'format-ipv6-leading-zero-error': fmt('ipv6'),
  'format-iri-error': fmt('iri'),
  'format-iri-reference-error': fmt('iri-reference'),
  'format-json-pointer-error': fmt('json-pointer'),
  'format-regex-error': fmt('regex'),
  'format-time-error': fmt('time'),
  'format-uri-error': fmt('uri'),
  'format-uri-reference-error': fmt('uri-reference'),
  'format-uri-template-error': fmt('uri-template'),
  'format-url-error': fmt('url'),
  'format-uuid-error': fmt('uuid'),
  'invalid-data-error': plain('false schema'),
  'invalid-property-name-error': row('propertyNames', 'pointer', { propertyName: from('property') }),
  'max-items-error': row('maxItems', 'pointer', { limit: from('maximum') }),
  'max-length-error': row('maxLength', 'pointer', { limit: from('maxLength') }),
  'max-properties-error': row('maxProperties', 'pointer', { limit: from('maxProperties') }),
  'maximum-error': row('maximum', 'pointer', { comparison: lit('<='), limit: from('maximum') }),
  'min-items-error': row('minItems', 'pointer', { limit: from('minItems') }),
  'min-items-one-error': row('minItems', 'pointer', { limit: lit(1) }),
  'min-length-error': row('minLength', 'pointer', { limit: from('minLength') }),
  'min-length-one-error': row('minLength', 'pointer', { limit: lit(1) }),
  'min-properties-error': row('minProperties', 'pointer', { limit: from('minProperties') }),
  'minimum-error': row('minimum', 'pointer', { comparison: lit('>='), limit: from('minimum') }),
  'missing-array-item-error': plain('items'),
  // Phase 3: draft-07 Ajv reports `dependencies`; Ajv also adds property / depsCount / deps (not reproduced).
  'missing-dependency-error': row(dependencyKeyword, 'pointer', { missingProperty: from('missingProperty') }),
  // schema-style pointer (`<pointer>/oneOf/<i>`), not a data pointer: kept as is.
  'missing-one-of-declarator-error': plain('oneOf'),
  'missing-one-of-property-error': plain('oneOf'),
  'multiple-of-error': row('multipleOf', 'pointer', { multipleOf: from('multipleOf') }),
  'multiple-one-of-error': row('oneOf', 'pointer', {
    passingSchemas: (data) => (Array.isArray(data.matches) ? data.matches.map((m: any) => m?.index ?? m) : undefined),
  }),
  'no-additional-properties-error': row('additionalProperties', 'parent', { additionalProperty: propertyOrKey }),
  'not-error': plain('not'),
  'one-of-error': row('oneOf', 'pointer', { passingSchemas: lit(null) }),
  'one-of-property-error': plain('oneOf'),
  'pattern-error': row('pattern', 'pointer', { pattern: from('pattern') }),
  'pattern-properties-error': plain('patternProperties'),
  'ref-error': row('$ref', 'pointer', { ref: from('ref') }),
  'required-property-error': row('required', 'pointer', { missingProperty: from('key') }),
  // Phase 3: a type list stays an array, as Ajv reports it (consumers join it for display).
  'type-error': row('type', 'pointer', { type: from('expected') }),
  'undefined-value-error': plain('type'),
  // Phase 3: Ajv reports `limit` = index of the first unevaluated item (the child index of the pointer).
  'unevaluated-items-error': row('unevaluatedItems', 'parent', {
    limit: (data) => indexOrString(String(lastSegment(data))),
  }),
  'unevaluated-property-error': row('unevaluatedProperties', 'parent', { unevaluatedProperty: lastSegment }),
  'unique-items-error': row('uniqueItems', 'parent', {
    i: (data) => indexOrString(String(lastSegment(data))),
    j: (data) => {
      const duplicate = String(data.duplicatePointer ?? '');
      return indexOrString(duplicate.slice(duplicate.lastIndexOf('/') + 1));
    },
  }),
  'unknown-property-error': plain('properties'),
  'value-not-empty-error': row('required', 'pointer', { missingProperty: from('property') }),
  'schema-error': plain('schema'),
  'schema-warning': plain('annotation'),
  'deprecated-warning': plain('annotation'),
  'unknown-keyword-warning': plain('annotation'),
  'unknown-format-warning': plain('annotation'),
  'x-gts-ref': row('x-gts-ref', 'pointer', { pattern: from('pattern') }),
};

const escapeSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Split a raw library pointer (`/a/b/c`, segments unescaped) into its segments by
 * walking the instance, so keys containing `/` or `~` are not truncated.
 * Returns undefined when the pointer does not address existing data.
 */
function resolveSegments(rest: string, node: unknown): string[] | undefined {
  if (rest === '') return [];
  if (typeof node !== 'object' || node === null) return undefined;
  for (const key of Object.keys(node)) {
    const prefix = `/${key}`;
    if (rest === prefix || rest.startsWith(`${prefix}/`)) {
      const tail = resolveSegments(rest.slice(prefix.length), (node as Record<string, unknown>)[key]);
      if (tail !== undefined) return [key, ...tail];
    }
  }
  return undefined;
}

/** JSON Pointer (RFC 6901, no `#`, root `/`) for a library pointer. */
function toInstancePath(data: LibraryData, mode: 'pointer' | 'parent', instance: unknown): string {
  const raw = String(data.pointer ?? '#').replace(/^#/, '');
  const child = data.property ?? data.key;
  let segments = resolveSegments(raw, instance);
  if (mode === 'parent') {
    if (
      segments !== undefined &&
      segments.length > 0 &&
      (child === undefined || segments[segments.length - 1] === `${child}`)
    ) {
      segments = segments.slice(0, -1);
    } else {
      // Not addressable in the instance: strip the exact child suffix, else the last segment.
      const suffix = child === undefined ? undefined : `/${child}`;
      const parentRaw =
        suffix !== undefined && raw.endsWith(suffix)
          ? raw.slice(0, -suffix.length)
          : raw.slice(0, Math.max(raw.lastIndexOf('/'), 0));
      segments = parentRaw === '' ? [] : parentRaw.slice(1).split('/');
    }
  } else if (segments === undefined) {
    segments = raw === '' ? [] : raw.slice(1).split('/');
  }
  return segments.length === 0 ? '/' : `/${segments.map(escapeSegment).join('/')}`;
}

/**
 * Map one library error to a {@link ValidationIssue}. `instance` is the
 * validated data (used to recover escaped pointer segments). Throws on a code
 * missing from {@link ISSUE_CODE_TABLE}.
 */
export function adaptLibraryError(error: JsonError, instance?: unknown): ValidationIssue {
  const code = String(error.code);
  const entry = ISSUE_CODE_TABLE[code];
  if (entry === undefined) throw new Error(`Unmapped json-schema-library error code: ${code}`);
  const data = (error.data ?? {}) as LibraryData;
  const params: Record<string, unknown> = {};
  for (const [name, extract] of Object.entries(entry.params)) {
    const value = extract(data);
    if (value !== undefined) params[name] = value;
  }
  const message = code === 'schema-error' && typeof data.message === 'string' ? data.message : error.message;
  return {
    instancePath: toInstancePath(data, entry.path, instance),
    schemaPath: typeof data.schemaLocation === 'string' ? data.schemaLocation : '#',
    keyword: typeof entry.keyword === 'function' ? entry.keyword(data) : entry.keyword,
    message,
    params,
  };
}

// ---------------------------------------------------------------------------
// GTS keyword / format extensions
// ---------------------------------------------------------------------------

function findKeyword(draft: Draft, name: string): Keyword {
  const keyword = draft.keywords.find((candidate) => candidate.keyword === name);
  if (keyword === undefined) throw new Error(`json-schema-library draft lacks keyword '${name}'`);
  return keyword;
}

function regexSchemaError(node: SchemaNode, pointer: string, value: unknown, error: unknown): JsonError {
  const message = error instanceof Error ? error.message : String(error);
  return node.createError('schema-error', { pointer, schema: node.schema, value, message, cause: error });
}

function createXGtsRefKeyword(getSelectedTypeId: () => string | undefined): Keyword {
  return {
    id: 'x-gts-ref',
    keyword: 'x-gts-ref',
    addValidate: ({ schema }) => typeof schema['x-gts-ref'] === 'string',
    validate: ({ node, data, pointer = '#' }: JsonSchemaValidatorParams) => {
      const pattern = node.schema['x-gts-ref'];
      const reason = xGtsRefKeywordViolation(pattern, data, getSelectedTypeId);
      if (reason === null) return undefined;
      return node.createError('x-gts-ref', { pointer, schema: node.schema, value: data, pattern }, reason);
    },
  };
}

function createPatternKeyword(base: Keyword): Keyword {
  return {
    ...base,
    parse: (node: SchemaNode) => {
      const pattern = node.schema.pattern;
      if (pattern == null) return undefined;
      const pointer = node.schemaLocation;
      if (typeof pattern !== 'string') {
        return regexSchemaError(
          node,
          pointer,
          pattern,
          new Error(`Keyword 'pattern' must be a string - received '${typeof pattern}'`)
        );
      }
      try {
        node.pattern = compileSafePattern(pattern, 'u') as unknown as RegExp;
      } catch (error) {
        return regexSchemaError(node, pointer, pattern, error);
      }
      return undefined;
    },
  };
}

function createPatternPropertiesKeyword(base: Keyword): Keyword {
  return {
    ...base,
    parse: (node: SchemaNode) => {
      const { schema } = node;
      if (typeof schema.patternProperties !== 'object' || schema.patternProperties === null) return undefined;
      const names = Object.keys(schema.patternProperties);
      if (names.length === 0) return undefined;
      const compiled: NonNullable<SchemaNode['patternProperties']> = [];
      for (const name of names) {
        try {
          compiled.push({
            name,
            pattern: compileSafePattern(name, 'u') as unknown as RegExp,
            node: node.compileSchema(
              schema.patternProperties[name],
              `${node.evaluationPath}/patternProperties/${name}`,
              `${node.schemaLocation}/patternProperties/${name}`
            ),
          });
        } catch (error) {
          return regexSchemaError(node, `${node.schemaLocation}/patternProperties`, name, error);
        }
      }
      node.patternProperties = compiled;
      return compiled.flatMap(({ node: child }) => child.schemaValidation ?? []);
    },
  };
}

/**
 * `additionalProperties` validation without the library's `_id` property
 * blacklist (`settings.propertyBlacklist`, which lets `_id` bypass a closed
 * schema). Library-global settings are left untouched.
 */
function createAdditionalPropertiesKeyword(base: Keyword): Keyword {
  return {
    ...base,
    validate: ({ node, data, pointer = '#', path }: JsonSchemaValidatorParams) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
      const record = data as Record<string, unknown>;
      const patterns = node.patternProperties;
      const expected = node.properties ? Object.keys(node.properties) : [];
      const errors: ReturnType<NonNullable<Keyword['validate']>> = [];
      for (const property of Object.keys(record)) {
        if (patterns?.some(({ pattern }) => pattern.test(property))) continue;
        if (expected.includes(property)) continue;
        const value = record[property];
        if (value === undefined) continue;
        if (node.additionalProperties) {
          const result = node.additionalProperties.validate(value, `${pointer}/${property}`, path);
          (errors as unknown[]).push(...result.errors);
        } else {
          (errors as unknown[]).push(
            node.createError('no-additional-properties-error', {
              pointer: `${pointer}/${property}`,
              schema: node.schema,
              value: data,
              property,
              properties: expected,
            })
          );
        }
      }
      return errors;
    },
  };
}

/**
 * `properties` with own-property lookup: the library indexes `node.properties[name]`, so an
 * instance property named `__proto__` (or `constructor`) would resolve to `Object.prototype`.
 */
function createPropertiesKeyword(base: Keyword): Keyword {
  return {
    ...base,
    validate: ({ node, data, pointer = '#', path }: JsonSchemaValidatorParams) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
      const record = data as Record<string, unknown>;
      const properties = node.properties ?? {};
      const errors: ReturnType<NonNullable<Keyword['validate']>> = [];
      for (const property of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(properties, property)) continue;
        const value = record[property];
        if (value === undefined) continue;
        const result = properties[property].validate(value, `${pointer}/${property}`, path);
        (errors as unknown[]).push(...result.errors);
      }
      return errors;
    },
  };
}

type FormatFn = (params: JsonSchemaValidatorParams) => ReturnType<NonNullable<Keyword['validate']>>;

function gtsFormat(code: string, isValid: (value: string) => boolean): FormatFn {
  return ({ node, data, pointer = '#' }) => {
    if (typeof data !== 'string' || isValid(data)) return undefined;
    return node.createError(code, { value: data, pointer, schema: node.schema });
  };
}

function buildDraft(base: Draft, getSelectedTypeId: () => string | undefined): Draft {
  return extendDraft(base, {
    keywords: [
      createXGtsRefKeyword(getSelectedTypeId),
      createPatternKeyword(findKeyword(base, 'pattern')),
      createPatternPropertiesKeyword(findKeyword(base, 'patternProperties')),
      createAdditionalPropertiesKeyword(findKeyword(base, 'additionalProperties')),
      createPropertiesKeyword(findKeyword(base, 'properties')),
    ],
    errors: { 'x-gts-ref': 'Value does not match x-gts-ref pattern' },
    formats: {
      'date-time': gtsFormat('format-date-time-error', isValidDateTime),
      time: gtsFormat('format-time-error', isValidTimePart),
      regex: gtsFormat('format-regex-error', isValidRegex),
      uri: gtsFormat('format-uri-error', isValidUri),
      'uri-reference': gtsFormat('format-uri-reference-error', isValidUriReference),
      'uri-template': gtsFormat('format-uri-template-error', isValidUriTemplate),
      hostname: gtsFormat('format-hostname-error', isValidHostname),
      ipv4: gtsFormat('format-ipv4-error', isValidIpv4),
      ipv6: gtsFormat('format-ipv6-error', isValidIpv6),
    },
  });
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface SchemaEngineOptions {
  /** Type currently being validated (without `gts://`), read on every `x-gts-ref` evaluation. */
  getSelectedTypeId: () => string | undefined;
}

export interface CompiledSchema {
  /** Validate `data`; returns issues (empty when valid). Throws raw errors (for example an invalid `$ref`). */
  validate(data: unknown): ValidationIssue[];
}

export interface SchemaEngine {
  /** Register (or replace) a schema in its dialect's `$ref` pool under `id`. */
  addEngineSchema(schema: Record<string, any>, id: string): void;
  /** Remove `id` from every dialect pool. */
  removeEngineSchema(id: string): void;
  /** Drop `id` from the pools, then re-add `schema` when given. */
  refreshEngineForKey(id: string, schema?: Record<string, any>): void;
  /**
   * Compile `schema`; throws raw errors (unresolved `$ref`, out-of-profile pattern, unsupported dialect).
   * Pass `cacheKey` (the registered entity id) ONLY for a registered entity's own unmodified schema:
   * the result is then cached per dialect + key until the next pool mutation. Without it nothing is cached.
   */
  compile(schema: Record<string, any>, cacheKey?: string): CompiledSchema;
  /** Drop every cached compiled schema. */
  clear(): void;
  /** Number of cached compiled schemas (bounded by live registered entities). */
  cacheSize(): number;
  /** Convenience: compile then validate. */
  validate(schema: Record<string, any>, data: unknown): ValidationIssue[];
  /** Meta-validate a schema document (library `schemaErrors`). */
  validateSchemaDocument(schema: Record<string, any>): ValidationIssue[];
}

const HOST_ID = 'gts://__schema_engine_host__';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The three GTS-extended drafts the engine validates with (exported so tests can read their runtime `errors` maps). */
export function buildEngineDrafts(getSelectedTypeId: () => string | undefined): Record<SchemaDialect, Draft> {
  return {
    'draft-07': buildDraft(draft07, getSelectedTypeId),
    '2019-09': buildDraft(draft2019, getSelectedTypeId),
    '2020-12': buildDraft(draft2020, getSelectedTypeId),
  };
}

export function createSchemaEngine(options: SchemaEngineOptions): SchemaEngine {
  const drafts = buildEngineDrafts(options.getSelectedTypeId);
  const pools: Record<SchemaDialect, Map<string, Record<string, any>>> = {
    'draft-07': new Map(),
    '2019-09': new Map(),
    '2020-12': new Map(),
  };

  // The remote host (every pooled schema of one dialect) is rebuilt only after the pool changed,
  // not on every compile: building it is O(pool) and dominated validation cost in large stores.
  const hosts: Partial<Record<SchemaDialect, ReturnType<typeof compileSchema>>> = {};

  // Compiled registered schemas, keyed by `<dialect>|<entity id>` (never by schema object). A compiled
  // node embeds the remotes it resolved, so any pool mutation clears the whole cache.
  const cache = new Map<string, CompiledSchema>();

  function hostFor(dialect: SchemaDialect, schema: Record<string, any>): ReturnType<typeof compileSchema> {
    let host = hosts[dialect];
    if (host === undefined) {
      host = compileSchema({ $schema: schema.$schema, $id: HOST_ID }, { drafts: [drafts[dialect]] });
      for (const [id, pooled] of pools[dialect]) {
        // addRemoteSchema rewrites `$id`; hand it a copy so pooled/registry schemas stay untouched.
        const copy = clone(pooled);
        host.addRemoteSchema(typeof copy.$id === 'string' ? copy.$id : id, copy);
      }
      hosts[dialect] = host;
    }
    return host;
  }

  function build(schema: Record<string, any>): { root: ReturnType<typeof compileSchema>; ownErrors: JsonError[] } {
    const dialect = dialectOf(schema);
    const draft = drafts[dialect];
    const host = hostFor(dialect, schema);
    const hostErrorCount = host.schemaErrors?.length ?? 0;
    const root = compileSchema(clone(schema), {
      drafts: [draft],
      remote: host,
      throwOnInvalidRef: true,
      throwOnInvalidSchema: false,
    });
    const all = root.schemaErrors ?? [];
    return { root, ownErrors: hostErrorCount > 0 ? all.slice(0, all.length - hostErrorCount) : all };
  }

  /**
   * The library resolves `$ref` lazily; resolve every reachable `$ref` eagerly so an
   * unresolved reference fails at compile time with a raw error (never a validation result).
   */
  function assertRefsResolve(root: SchemaNode): void {
    const queue: SchemaNode[] = [root];
    const seen = new Set<SchemaNode>();
    for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
      if (seen.has(current)) continue;
      seen.add(current);
      for (const node of current.toSchemaNodes()) {
        if (node.$ref == null) continue;
        const resolved = node.resolveRef();
        if (!isSchemaNode(resolved)) {
          throw new Error(`Invalid $ref: Could not resolve $ref '${String(node.schema.$ref)}'`);
        }
        queue.push(resolved.context.rootNode);
      }
    }
  }

  return {
    addEngineSchema(schema, id) {
      const dialect = dialectOf(schema);
      pools[dialect].set(id, clone(schema));
      delete hosts[dialect];
      cache.clear();
    },
    removeEngineSchema(id) {
      for (const dialect of Object.keys(pools) as SchemaDialect[]) {
        if (pools[dialect].delete(id)) delete hosts[dialect];
      }
      cache.clear();
    },
    refreshEngineForKey(id, schema) {
      this.removeEngineSchema(id);
      if (schema !== undefined) this.addEngineSchema(schema, id);
    },
    clear() {
      cache.clear();
    },
    cacheSize() {
      return cache.size;
    },
    compile(schema, cacheKey) {
      const key = cacheKey === undefined ? undefined : `${dialectOf(schema)}|${cacheKey}`;
      const hit = key === undefined ? undefined : cache.get(key);
      if (hit !== undefined) return hit;
      const { root, ownErrors } = build(schema);
      for (const error of ownErrors) {
        const cause = (error.data as LibraryData | undefined)?.cause;
        if (cause instanceof RegexCompilationError) throw cause;
      }
      // A malformed schema (for example a `null` subschema) must fail at compile time, as it did
      // under Ajv, instead of being silently ignored during validation.
      if (ownErrors.length > 0) throw new Error(ownErrors.map((error) => error.message).join('; '));
      assertRefsResolve(root);
      const compiled: CompiledSchema = {
        validate: (data) => root.validate(data).errors.map((error) => adaptLibraryError(error, data)),
      };
      if (key !== undefined) cache.set(key, compiled);
      return compiled;
    },
    validate(schema, data) {
      return this.compile(schema).validate(data);
    },
    validateSchemaDocument(schema) {
      return build(schema).ownErrors.map((error) => adaptLibraryError(error));
    },
  };
}
