# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-10

Upgrades the implementation from GTS spec **v0.8** to **[v0.13.1](https://github.com/GlobalTypeSystem/gts-spec/releases/tag/v0.13.1)**.

Spec 0.12 renamed the core terminology (GTS Type / GTS Type Schema / GTS Instance) and
0.13 issued a correction to the compatibility rules, so this release contains breaking
changes to both the HTTP API and the library API.

### Breaking - HTTP API

| Before | After |
| --- | --- |
| `POST /schemas` with the schema as the body | `POST /type-schemas` with `{ "type_id", "type_schema" }` |
| `POST /validate-schema` with `{ "schema_id" }` | `POST /validate-type-schema` with `{ "type_id" }` |
| `GET /compatibility?old_schema_id=&new_schema_id=` | `GET /compatibility?old_type_id=&new_type_id=` |
| `POST /cast` with `{ "instance_id", "to_schema_id" }` | `POST /cast` with `{ "instance_id", "to_type_id" }` |
| `/extract-id` returned `schema_id`, `selected_schema_id_field`, `is_schema` | returns `type_id`, `selected_type_id_field`, `is_type_schema` |
| `/parse-id` returned `is_schema` | returns `is_type_schema`, plus a new `is_type` field |

`GET /compatibility` now returns the tri-state verdicts required by §4.3:

```jsonc
{
  "old": "gts.x.core.events.type.v1.0~",
  "new": "gts.x.core.events.type.v1.1~",
  "backward_compatibility": "compatible",   // compatible | incompatible | unknown
  "forward_compatibility": "incompatible",
  "full_compatibility": "incompatible"
}
```

The previous boolean fields (`is_backward_compatible`, `is_forward_compatible`,
`is_fully_compatible`) are still present for compatibility, but `unknown` collapses to
`false` in them and they cannot express an inconclusive check. Prefer the tri-state fields.

### Breaking - library API

- `ExtractResult`: `schema_id` → `type_id`, `selected_schema_id_field` → `selected_type_id_field`,
  `is_schema` → `is_type_schema`.
- `ParseResult`: `is_schema` → `is_type_schema`.
- `CompatibilityResult`: gains `backward_compatibility`, `forward_compatibility` and
  `full_compatibility`, each a `CompatVerdict` (`'compatible' | 'incompatible' | 'unknown'`).
- `GtsStore.checkCompatibility()` was removed; use `GTS.checkCompatibility()` or
  `GtsCompatibility.checkCompatibility(store, old, new)`.
- `GtsStore.validateEntityTraits()` was removed. `/validate-entity` and `/validate-type-schema`
  now apply the same type-level checks, so it no longer had separate semantics.
- `CompatibilityResult.added_properties`, `removed_properties` and `changed_properties` are
  now **always empty** and are deprecated. The engine decides compatibility by comparing
  accepted-instance sets rather than by diffing properties, so it no longer produces a
  property diff. The fields remain on the type and in the `GET /compatibility` response so
  existing consumers keep parsing, but they carry no information and will be removed.
- **`GtsCast` was removed.** There were two cast implementations - one in the library, one
  in the registry. Only the registry implementation resolved `allOf` / `$ref` on the target
  and validated the cast result; the library one did neither. Since GTS derived types *are*
  `allOf: [{$ref: parent}, …]`, the library version silently dropped every property when
  casting to a derived type.
  `GTS.castInstance()`, the CLI and `POST /cast` now share the registry implementation.
  The returned `CastResult` shape is unchanged.
- Casting no longer refuses when the two type schemas are not fully compatible. Casting is
  a separate operational contract that the spec requires to be reported separately from
  schema compatibility (§4.3, §4.6.3); under 0.13 almost no real schema evolution is
  *fully* compatible, so the old gate rejected ordinary casts. A cast now succeeds only if
  its **result** satisfies the target type, including that type's `x-gts-ref` constraints.
- The `direction` field reported `upgrade` / `downgrade` / `same` on `GET /compatibility`
  but `up` / `down` / `none` on `POST /cast`, from two separate implementations. Both now
  use `upgrade` / `downgrade` / `same` / `unknown`, and consider the MAJOR version as well
  as the MINOR.
- Two shape checks on `x-gts-traits-schema` were dropped: it no longer has to declare
  `type: "object"`, and it may contain a nested `x-gts-traits` member. Per ADR-0002 the
  keyword is an ordinary JSON Schema subschema (object, `true` or `false`), so neither
  restriction has a basis in 0.13; the placement rule deliberately does not scan inside it.

### Changed - compatibility semantics (spec 0.13 §4)

OP#8 was rewritten around accepted-instance-set inclusion rather than a rule-based diff.
Several verdicts change for inputs that did not change:

- **Enums.** Adding an enum value is now backward compatible and not forward compatible
  (0.12 reported the opposite).
- **Open content models.** Adding an optional property to an open object is forward
  compatible, not backward compatible — the old schema already accepted arbitrary values
  under that name.
- **`const` fields.** Changing a `const` value is neither backward nor forward compatible.
- Content models are classified from the fully resolved effective schema (after `$ref`
  resolution and `allOf` composition), not from `additionalProperties` alone.
- An inconclusive comparison reports `unknown` instead of being conflated with
  `incompatible` — for example when the two schemas differ only in a keyword the checker
  does not model, or when a type identifier cannot be resolved.

### Added

- **`x-gts-final` / `x-gts-abstract` (§9.11).** A final type cannot be extended; an abstract
  type cannot be directly instantiated. Enforced at registration (`?validate=true`) and
  always on `/validate-type-schema`, `/validate-instance` and `/validate-entity`. Non-boolean
  values and the `final + abstract` combination are rejected outright.
- **Document-level keyword placement (§9.7.1, §9.11.5).** `x-gts-final`, `x-gts-abstract`,
  `x-gts-traits-schema` and `x-gts-traits` must appear at the schema top level; an occurrence
  nested in any subschema is rejected rather than silently ignored.
- **`GtsModifiers`** and `DOCUMENT_LEVEL_KEYWORDS` are exported from the package root.
- Unit tests covering the compatibility rules table (§4.5), the trait merge and completeness
  rules, the modifier and placement rules, and wildcard matching.

### Changed - traits (§9.7.5, ADR-0002/0003/0004)

- Trait values merge by **JSON Merge Patch (RFC 7396)**: objects merge recursively, arrays
  replace wholesale, and `null` deletes a key.
- Trait-schema `default`s are materialized before the completeness check.
- **Completeness is keyed on `x-gts-abstract`**: non-abstract types must validate against the
  effective trait schema; abstract types are exempt.
- Locking a trait value across descendants is now plain `const` in `x-gts-traits-schema`.
  The bespoke immutability / default-override rules were removed.
- `x-gts-traits-schema` accepts the boolean subschema forms: `true` permits arbitrary traits,
  `false` prohibits traits on the whole subtree.

### Fixed

- **OP#5**: an identifier that already carries a UUID tail (a combined anonymous instance)
  returns that UUID instead of deriving a second one from the string.
- **OP#4**: a major-only version wildcard such as `v0.*` no longer matches every major
  version — `v0` was indistinguishable from "no version given".
- **OP#4**: a bare chain-suffix wildcard (`type.v1~*`) matches the type it is anchored on,
  as well as the identifiers derived from it.
- **OP#2**: a base type schema reports `type_id: null`. The JSON Schema dialect URL in
  `$schema` is not a GTS Type Identifier and is no longer returned as one.
- **OP#12**: derivation is validated from the chained `$id` alone, so a derived schema that
  restates its parent's fields instead of using `allOf` + `$ref` is checked too (ADR-0001).
- **OP#12**: `additionalProperties: true` or an omitted `additionalProperties` in an `allOf`
  overlay is no longer reported as loosening — the base branch keeps applying under `allOf`.
  A level that closes itself must still restate the base's properties.

### Notes for implementers

`OP#4` and `OP#10` disagree in the gts-spec 0.13 conformance suite over whether a bare
chain-suffix wildcard matches the type it is anchored on. Both verdicts are asserted, so
`matchIDPattern()` is inclusive by default and `GTS.query()` opts into strictly-derived
matching. In gts-spec 0.12 both were exclusive; 0.13 flipped only the OP#4 assertions.

## [0.3.0]

- Support for combined anonymous instances and OP#13 schema traits validation.
- Fastify upgrade; `oneOf` / `anyOf` validation fixes.
