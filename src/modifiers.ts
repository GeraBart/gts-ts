/**
 * GTS Type Schema Modifiers - `x-gts-final` / `x-gts-abstract` (spec §9.11),
 * plus the shared document-level keyword placement rule (§9.7.1 / §9.11.5).
 *
 * - `x-gts-final: true`   - the type cannot be inherited from.
 * - `x-gts-abstract: true` - the type cannot be directly instantiated.
 *
 * Both are type-level keywords: they describe the GTS Type as a whole and are
 * only meaningful at the top level of the schema document. The same is true of
 * the two trait keywords, so the placement check covers all four.
 */

import { MAX_SCHEMA_DEPTH } from './types';
import { SCHEMA_KEYWORD_POSITIONS } from './compatibility';

export const X_GTS_FINAL = 'x-gts-final';
export const X_GTS_ABSTRACT = 'x-gts-abstract';
export const X_GTS_TRAITS = 'x-gts-traits';
export const X_GTS_TRAITS_SCHEMA = 'x-gts-traits-schema';

/**
 * The four keywords that describe the type as a whole and therefore MUST sit at
 * the top level of the schema document (§9.7.1, §9.11.2 item 5, §9.11.3 item 6).
 */
export const DOCUMENT_LEVEL_KEYWORDS = [X_GTS_FINAL, X_GTS_ABSTRACT, X_GTS_TRAITS_SCHEMA, X_GTS_TRAITS];

export class GtsModifiers {
  /** True when the schema declares `x-gts-final: true`; `false`/absent are no-ops. */
  static isFinal(schema: any): boolean {
    return this.readModifier(schema, X_GTS_FINAL) === true;
  }

  /** True when the schema declares `x-gts-abstract: true`; `false`/absent are no-ops. */
  static isAbstract(schema: any): boolean {
    return this.readModifier(schema, X_GTS_ABSTRACT) === true;
  }

  private static readModifier(schema: any, keyword: string): unknown {
    if (!schema || typeof schema !== 'object') return undefined;
    return schema[keyword];
  }

  /**
   * Checks the declaration of the modifiers on a single schema document:
   * non-boolean values and the meaningless `final + abstract` combination are
   * both invalid (§9.11.1). Returns an error message, or null when valid.
   */
  static validateDeclaration(schema: any): string | null {
    if (!schema || typeof schema !== 'object') return null;

    for (const keyword of [X_GTS_FINAL, X_GTS_ABSTRACT]) {
      const value = schema[keyword];
      if (value !== undefined && typeof value !== 'boolean') {
        return `${keyword} must be a boolean, got ${JSON.stringify(value)}`;
      }
    }

    if (schema[X_GTS_FINAL] === true && schema[X_GTS_ABSTRACT] === true) {
      return `a schema must not declare both ${X_GTS_FINAL} and ${X_GTS_ABSTRACT}`;
    }

    return null;
  }

  /**
   * Finds document-level GTS keywords that were placed inside a subschema
   * (an `allOf` entry, a `properties` value, a `definitions` entry, ...).
   * Such a keyword attaches to a subschema rather than to the type and MUST be
   * rejected rather than silently ignored.
   *
   * Returns the JSON paths of the misplaced keywords, empty when correct.
   */
  static findMisplacedKeywords(schema: any): string[] {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];

    const found: string[] = [];
    for (const [key, value] of Object.entries(schema)) {
      // The top-level occurrences are the correct placement. Their values are
      // trait data or a trait subschema, never a place for further keywords.
      if (DOCUMENT_LEVEL_KEYWORDS.includes(key)) continue;
      this.scanSubschemas(key, value, key, found, 0);
    }
    return found;
  }

  /**
   * Scans a *schema position* (never a data position) for misplaced keywords.
   * Position-aware for the same reason `compatibility.ts`'s `stripAnnotations`
   * walk is: `{ properties: { 'x-gts-abstract': {...} } }` names a property
   * called `x-gts-abstract`, not an occurrence of the keyword, and must not be
   * flagged.
   */
  private static scan(node: any, path: string, found: string[], depth: number): void {
    if (!node || typeof node !== 'object') return;

    // The guard bounds recursion on pathological input. Stopping silently would
    // let a misplaced keyword below the limit through, so it fails closed: the
    // unscanned subtree is itself reported and the document is rejected.
    if (depth > MAX_SCHEMA_DEPTH) {
      found.push(`${path} (nesting exceeds ${MAX_SCHEMA_DEPTH} levels; cannot verify keyword placement)`);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => this.scan(item, `${path}[${index}]`, found, depth + 1));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}/${key}`;
      if (DOCUMENT_LEVEL_KEYWORDS.includes(key)) {
        found.push(childPath);
        continue;
      }
      this.scanSubschemas(key, value, childPath, found, depth);
    }
  }

  /** Recurses into `key`'s value only through the schema-bearing positions it defines. */
  private static scanSubschemas(key: string, value: any, path: string, found: string[], depth: number): void {
    // `dependencies` (draft-07) is heterogeneous per-entry: each map entry is
    // either a schema (schema dependency form) or a plain array of property
    // names (property dependency form). `compatibility.ts`'s KEYWORDS table
    // can't express that split without regressing its malformed-shape
    // detection for the array form, so it's handled locally here instead:
    // only the schema-shaped entries are schema positions worth scanning.
    if (key === 'dependencies') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, sub] of Object.entries(value)) {
          if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
            this.scan(sub, `${path}/${name}`, found, depth + 1);
          }
        }
      }
      return;
    }

    switch (SCHEMA_KEYWORD_POSITIONS[key]) {
      case 'schema':
        this.scan(value, path, found, depth + 1);
        break;
      case 'schemaList':
        if (Array.isArray(value))
          value.forEach((item, index) => this.scan(item, `${path}[${index}]`, found, depth + 1));
        break;
      case 'schemaMap':
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, sub] of Object.entries(value)) {
            this.scan(sub, `${path}/${name}`, found, depth + 1);
          }
        }
        break;
      default:
        // A data or unmodeled position: never a place a document-level keyword
        // can legitimately occur, and never a place to look for one either.
        break;
    }
  }
}
