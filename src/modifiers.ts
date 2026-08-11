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
      this.scan(value, key, found, 0);
    }
    return found;
  }

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
      this.scan(value, childPath, found, depth + 1);
    }
  }
}
