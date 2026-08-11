import Ajv from 'ajv';
import { GtsConfig, JsonEntity, ValidationResult, GTS_URI_PREFIX } from './types';
import { Gts } from './gts';
import { GtsExtractor } from './extract';
import { XGtsRefValidator } from './x-gts-ref';
import { GtsCompatibility } from './compatibility';
import { GtsModifiers } from './modifiers';

interface ResolvedSchema {
  properties: Record<string, any>;
  required: string[];
  additionalProperties?: boolean;
  type?: string;
}

export class GtsStore {
  private byId: Map<string, JsonEntity> = new Map();
  private config: GtsConfig;
  private ajv: Ajv;

  constructor(config?: Partial<GtsConfig>) {
    this.config = {
      validateRefs: config?.validateRefs ?? false,
      strictMode: config?.strictMode ?? false,
    };

    this.ajv = new Ajv({
      strict: false,
      validateSchema: false,
      addUsedSchema: false,
      loadSchema: this.loadSchema.bind(this),
      validateFormats: false, // Disable format validation to match Go implementation
    });
    // Don't add format validators since Go uses lenient validation
  }

  private async loadSchema(uri: string): Promise<any> {
    const normalizedUri = uri.startsWith(GTS_URI_PREFIX) ? uri.substring(GTS_URI_PREFIX.length) : uri;

    if (Gts.isValidGtsID(normalizedUri)) {
      const entity = this.get(normalizedUri);
      if (entity && entity.isSchema) {
        return entity.content;
      }
    }
    throw new Error(`Unresolvable GTS reference: ${uri}`);
  }

  register(entity: JsonEntity): void {
    if (this.config.validateRefs) {
      for (const ref of entity.references) {
        if (!this.byId.has(ref)) {
          throw new Error(`Unresolved reference: ${ref}`);
        }
      }
    }
    this.byId.set(entity.id, entity);

    // If this is a schema, add it to AJV for reference resolution
    if (entity.isSchema && entity.content) {
      try {
        const normalizedSchema = this.normalizeSchema(entity.content);
        // Set $id to the GTS ID if not already set
        if (!normalizedSchema.$id) {
          normalizedSchema.$id = entity.id;
        }
        this.ajv.addSchema(normalizedSchema, entity.id);
      } catch (err) {
        // Ignore errors adding schema - it might already exist or be invalid
      }
    }
  }

  get(id: string): JsonEntity | undefined {
    return this.byId.get(id);
  }

  getAll(): JsonEntity[] {
    return Array.from(this.byId.values());
  }

  query(pattern: string, limit?: number): string[] {
    const results: string[] = [];
    const maxResults = limit ?? Number.MAX_SAFE_INTEGER;

    for (const [id] of this.byId) {
      if (results.length >= maxResults) break;

      const matchResult = Gts.matchIDPattern(id, pattern);
      if (matchResult.match) {
        results.push(id);
      }
    }

    return results;
  }

  validateInstance(gtsId: string): ValidationResult {
    try {
      let objId: string = gtsId;
      if (Gts.isValidGtsID(gtsId)) {
        const gid = Gts.parseGtsID(gtsId);
        objId = gid.id;
      }

      const obj = this.get(objId);
      if (!obj) {
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `Entity not found: ${gtsId}`,
        };
      }

      if (!obj.schemaId) {
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `No schema found for instance: ${gtsId}`,
        };
      }

      const schemaEntity = this.get(obj.schemaId);
      if (!schemaEntity) {
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `Schema not found: ${obj.schemaId}`,
        };
      }

      if (!schemaEntity.isSchema) {
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `Entity '${obj.schemaId}' is not a schema`,
        };
      }

      // §9.11.3 item 2 - the rightmost type in the chain must be instantiable
      if (GtsModifiers.isAbstract(schemaEntity.content)) {
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `Type '${obj.schemaId}' is abstract and cannot be directly instantiated`,
        };
      }

      const validate = this.ajv.compile(this.normalizeSchema(schemaEntity.content));
      const isValid = validate(obj.content);

      if (!isValid) {
        const errors =
          validate.errors
            ?.map((e) => {
              if (e.keyword === 'required') {
                return `${e.instancePath || '/'} must have required property '${(e.params as any)?.missingProperty}'`;
              }
              return `${e.instancePath} ${e.message}`;
            })
            .join('; ') || 'Validation failed';
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: errors,
        };
      }

      // Validate x-gts-ref constraints
      const xGtsRefValidator = new XGtsRefValidator(this);
      const xGtsRefErrors = xGtsRefValidator.validateInstance(obj.content, schemaEntity.content);
      if (xGtsRefErrors.length > 0) {
        const errorMsgs = xGtsRefErrors.map((err) => err.reason).join('; ');
        return {
          id: gtsId,
          ok: false,
          valid: false,
          error: `x-gts-ref validation failed: ${errorMsgs}`,
        };
      }

      return {
        id: gtsId,
        ok: true,
        valid: true,
        error: '',
      };
    } catch (error) {
      return {
        id: gtsId,
        ok: false,
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private normalizeSchema(schema: any): any {
    return this.normalizeSchemaRecursive(schema);
  }

  private normalizeSchemaRecursive(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalizeSchemaRecursive(item));
    }

    const normalized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Strip x-gts-ref so Ajv never sees the unknown keyword
      if (key === 'x-gts-ref') continue;

      let newKey = key;
      let newValue = value;

      // Convert $$ prefixed keys to $ prefixed keys
      switch (key) {
        case '$$id':
          newKey = '$id';
          break;
        case '$$schema':
          newKey = '$schema';
          break;
        case '$$ref':
          newKey = '$ref';
          break;
        case '$$defs':
          newKey = '$defs';
          break;
      }

      // Recursively normalize nested objects
      if (value && typeof value === 'object') {
        newValue = this.normalizeSchemaRecursive(value);
      }

      normalized[newKey] = newValue;
    }

    // Clean up combinator arrays: remove subschemas that were x-gts-ref-only (now empty after stripping)
    for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
      if (Array.isArray(normalized[combinator])) {
        normalized[combinator] = normalized[combinator].filter((_sub: any, idx: number) => {
          const original = (obj as any)[combinator]?.[idx];
          const isXGtsRefOnly =
            original &&
            typeof original === 'object' &&
            !Array.isArray(original) &&
            Object.keys(original).length === 1 &&
            original['x-gts-ref'] !== undefined;
          return !isXGtsRefOnly;
        });
        if (normalized[combinator].length === 0) {
          delete normalized[combinator];
        }
      }
    }

    // Normalize $id values
    if (normalized['$id'] && typeof normalized['$id'] === 'string') {
      if (normalized['$id'].startsWith(GTS_URI_PREFIX)) {
        normalized['$id'] = normalized['$id'].substring(GTS_URI_PREFIX.length);
      }
    }

    // Normalize $ref values
    if (normalized['$ref'] && typeof normalized['$ref'] === 'string') {
      if (normalized['$ref'].startsWith(GTS_URI_PREFIX)) {
        normalized['$ref'] = normalized['$ref'].substring(GTS_URI_PREFIX.length);
      }
    }

    return normalized;
  }

  resolveRelationships(gtsId: string): any {
    const seen = new Set<string>();
    return this.buildSchemaGraphNode(gtsId, seen);
  }

  private buildSchemaGraphNode(gtsId: string, seen: Set<string>): any {
    const node: any = {
      id: gtsId,
    };

    // Check for cycles
    if (seen.has(gtsId)) {
      return node;
    }
    seen.add(gtsId);

    // Get the entity from store
    const entity = this.get(gtsId);
    if (!entity) {
      node.errors = ['Entity not found'];
      return node;
    }

    // Process GTS references found in the entity
    const refs = this.extractGtsReferences(entity.content);
    const nodeRefs: any = {};

    for (const ref of refs) {
      // Skip self-references
      if (ref.id === gtsId) {
        continue;
      }
      // Skip JSON Schema meta-schema references
      if (this.isJsonSchemaUrl(ref.id)) {
        continue;
      }
      // Recursively build node for this reference
      nodeRefs[ref.sourcePath] = this.buildSchemaGraphNode(ref.id, seen);
    }

    if (Object.keys(nodeRefs).length > 0) {
      node.refs = nodeRefs;
    }

    // Process schema ID if present
    if (entity.schemaId) {
      if (!this.isJsonSchemaUrl(entity.schemaId)) {
        node.schema_id = this.buildSchemaGraphNode(entity.schemaId, seen);
      }
    } else if (!entity.isSchema) {
      // Instance without schema ID is an error
      node.errors = node.errors || [];
      node.errors.push('Schema not recognized');
    }

    return node;
  }

  private extractGtsReferences(content: any): Array<{ id: string; sourcePath: string }> {
    const refs: Array<{ id: string; sourcePath: string }> = [];
    const seen = new Set<string>();

    const walkAndCollectRefs = (node: any, path: string) => {
      if (node === null || node === undefined) {
        return;
      }

      // Check if current node is a GTS ID string
      if (typeof node === 'string') {
        if (Gts.isValidGtsID(node)) {
          const sourcePath = path || 'root';
          const key = `${node}|${sourcePath}`;
          if (!seen.has(key)) {
            refs.push({ id: node, sourcePath });
            seen.add(key);
          }
        }
        return;
      }

      // Recurse into object
      if (typeof node === 'object' && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node)) {
          const nextPath = path ? `${path}.${k}` : k;
          walkAndCollectRefs(v, nextPath);
        }
        return;
      }

      // Recurse into array
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const nextPath = path ? `${path}[${i}]` : `[${i}]`;
          walkAndCollectRefs(node[i], nextPath);
        }
      }
    };

    walkAndCollectRefs(content, '');
    return refs;
  }

  private isJsonSchemaUrl(s: string): boolean {
    return (s.startsWith('http://') || s.startsWith('https://')) && s.includes('json-schema.org');
  }

  private inferDirection(fromId: string, toId: string): string {
    try {
      const fromGtsId = Gts.parseGtsID(fromId);
      const toGtsId = Gts.parseGtsID(toId);

      if (!fromGtsId.segments.length || !toGtsId.segments.length) {
        return 'unknown';
      }

      const fromSeg = fromGtsId.segments[fromGtsId.segments.length - 1];
      const toSeg = toGtsId.segments[toGtsId.segments.length - 1];

      if (fromSeg.verMinor !== undefined && toSeg.verMinor !== undefined) {
        if (toSeg.verMinor > fromSeg.verMinor) {
          return 'up';
        }
        if (toSeg.verMinor < fromSeg.verMinor) {
          return 'down';
        }
        return 'none';
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private flattenSchema(schema: any): any {
    const result: any = {
      properties: {},
      required: [],
    };

    // Merge allOf schemas
    if (schema.allOf && Array.isArray(schema.allOf)) {
      for (const subSchema of schema.allOf) {
        const flattened = this.flattenSchema(subSchema);

        // Merge properties
        Object.assign(result.properties, flattened.properties || {});

        // Merge required
        if (flattened.required && Array.isArray(flattened.required)) {
          result.required.push(...flattened.required);
        }

        // Preserve additionalProperties
        if (flattened.additionalProperties !== undefined) {
          result.additionalProperties = flattened.additionalProperties;
        }
      }
    }

    // Add direct properties
    if (schema.properties) {
      Object.assign(result.properties, schema.properties);
    }

    // Add direct required
    if (schema.required && Array.isArray(schema.required)) {
      result.required.push(...schema.required);
    }

    // Top level additionalProperties overrides
    if (schema.additionalProperties !== undefined) {
      result.additionalProperties = schema.additionalProperties;
    }

    return result;
  }

  castInstance(instanceId: string, toSchemaId: string): any {
    try {
      // Get instance entity
      const instanceEntity = this.get(instanceId);
      if (!instanceEntity) {
        return {
          instance_id: instanceId,
          to_type_id: toSchemaId,
          ok: false,
          error: `Entity not found: ${instanceId}`,
        };
      }

      // Get target schema
      const toSchema = this.get(toSchemaId);
      if (!toSchema) {
        return {
          instance_id: instanceId,
          to_type_id: toSchemaId,
          ok: false,
          error: `Schema not found: ${toSchemaId}`,
        };
      }

      // Determine source schema
      let fromSchemaId: string;
      let fromSchema: any;
      if (instanceEntity.isSchema) {
        // Not allowed to cast directly from a schema
        return {
          instance_id: instanceId,
          to_type_id: toSchemaId,
          ok: false,
          error: 'Source must be an instance, not a schema',
        };
      } else {
        // Casting an instance - need to find its schema
        fromSchemaId = instanceEntity.schemaId!;
        if (!fromSchemaId) {
          return {
            instance_id: instanceId,
            to_type_id: toSchemaId,
            ok: false,
            error: `Schema not found for instance: ${instanceId}`,
          };
        }
        // Don't try to get a JSON Schema URL as a GTS entity
        if (fromSchemaId.startsWith('http://') || fromSchemaId.startsWith('https://')) {
          return {
            instance_id: instanceId,
            to_type_id: toSchemaId,
            ok: false,
            error: `Cannot cast instance with schema ${fromSchemaId}`,
          };
        }
        fromSchema = this.get(fromSchemaId);
        if (!fromSchema) {
          return {
            instance_id: instanceId,
            to_type_id: toSchemaId,
            ok: false,
            error: `Schema not found: ${fromSchemaId}`,
          };
        }
      }

      // Get content
      const instanceContent = instanceEntity.content;
      const fromSchemaContent = fromSchema.content;
      const toSchemaContent = toSchema.content;

      // Perform the cast
      return this.performCast(instanceId, toSchemaId, instanceContent, fromSchemaContent, toSchemaContent);
    } catch (error) {
      return {
        instance_id: instanceId,
        to_type_id: toSchemaId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private performCast(
    fromInstanceId: string,
    toSchemaId: string,
    fromInstanceContent: any,
    fromSchemaContent: any,
    toSchemaContent: any
  ): any {
    // Flatten target schema to merge allOf
    const targetSchema = this.flattenSchema(toSchemaContent);

    // Determine direction
    const direction = this.inferDirection(fromInstanceId, toSchemaId);

    // Determine which is old/new based on direction
    let oldSchema: any;
    let newSchema: any;
    switch (direction) {
      case 'up':
        oldSchema = fromSchemaContent;
        newSchema = toSchemaContent;
        break;
      case 'down':
        oldSchema = toSchemaContent;
        newSchema = fromSchemaContent;
        break;
      default:
        oldSchema = fromSchemaContent;
        newSchema = toSchemaContent;
        break;
    }

    // Check evolution compatibility between the two type schemas (spec §4.2)
    const { backward, forward } = GtsCompatibility.compareSchemas(this, oldSchema, newSchema);
    const isBackward = backward === 'compatible';
    const isForward = forward === 'compatible';
    const backwardErrors = isBackward ? [] : [`Backward compatibility is ${backward}`];
    const forwardErrors = isForward ? [] : [`Forward compatibility is ${forward}`];

    // Apply casting rules to transform the instance
    const { casted, added, removed, incompatibilityReasons } = this.castInstanceToSchema(
      this.deepCopy(fromInstanceContent),
      targetSchema,
      ''
    );

    // Validate the casted instance against the target schema
    let isFullyCompatible = false;
    if (casted) {
      try {
        const modifiedSchema = this.removeGtsConstConstraints(toSchemaContent);
        const validate = this.ajv.compile(this.normalizeSchema(modifiedSchema));
        const isValid = validate(casted);
        if (!isValid) {
          const errors =
            validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ') || 'Validation failed';
          incompatibilityReasons.push(errors);
        } else {
          isFullyCompatible = true;
        }
      } catch (err) {
        incompatibilityReasons.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      from: fromInstanceId,
      to: toSchemaId,
      old: fromInstanceId,
      new: toSchemaId,
      direction,
      added_properties: this.deduplicate(added),
      removed_properties: this.deduplicate(removed),
      changed_properties: [],
      is_fully_compatible: isFullyCompatible,
      is_backward_compatible: isBackward,
      is_forward_compatible: isForward,
      incompatibility_reasons: incompatibilityReasons,
      backward_errors: backwardErrors,
      forward_errors: forwardErrors,
      casted_entity: casted,
      instance_id: fromInstanceId,
      to_type_id: toSchemaId,
      ok: isFullyCompatible,
      error: isFullyCompatible ? '' : incompatibilityReasons.join('; '),
    };
  }

  private castInstanceToSchema(
    instance: any,
    schema: any,
    basePath: string
  ): { casted: any; added: string[]; removed: string[]; incompatibilityReasons: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const incompatibilityReasons: string[] = [];

    if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
      incompatibilityReasons.push('Instance must be an object for casting');
      return { casted: null, added, removed, incompatibilityReasons };
    }

    const targetProps = schema.properties || {};
    const required = new Set<string>(schema.required || []);
    const additional = schema.additionalProperties !== false;

    // Start from current values
    const result = this.deepCopy(instance);

    // 1) Ensure required properties exist (fill defaults if provided)
    for (const reqProp of Array.from(required)) {
      if (!(reqProp in result)) {
        const propSchema = targetProps[reqProp as string];
        if (propSchema && propSchema.default !== undefined) {
          result[reqProp as string] = this.deepCopy(propSchema.default);
          const path = this.buildPath(basePath, reqProp as string);
          added.push(path);
        } else {
          const path = this.buildPath(basePath, reqProp as string);
          incompatibilityReasons.push(`Missing required property '${path}' and no default is defined`);
        }
      }
    }

    // 2) For optional properties with defaults, set if missing
    for (const [prop, propSchema] of Object.entries(targetProps)) {
      if (required.has(prop)) {
        continue;
      }
      if (!(prop in result)) {
        const ps = propSchema as any;
        if (ps.default !== undefined) {
          result[prop] = this.deepCopy(ps.default);
          const path = this.buildPath(basePath, prop);
          added.push(path);
        }
      }
    }

    // 2.5) Update const values to match target schema (for GTS ID fields)
    for (const [prop, propSchema] of Object.entries(targetProps)) {
      const ps = propSchema as any;
      if (ps.const !== undefined) {
        const constVal = ps.const;
        const existingVal = result[prop];
        if (typeof constVal === 'string' && typeof existingVal === 'string') {
          // Only update if both are GTS IDs and they differ
          if (Gts.isValidGtsID(constVal) && Gts.isValidGtsID(existingVal)) {
            if (existingVal !== constVal) {
              result[prop] = constVal;
            }
          }
        }
      }
    }

    // 3) Remove properties not in target schema when additionalProperties is false
    if (!additional) {
      for (const prop of Object.keys(result)) {
        if (!(prop in targetProps)) {
          delete result[prop];
          const path = this.buildPath(basePath, prop);
          removed.push(path);
        }
      }
    }

    // 4) Recurse into nested object properties
    for (const [prop, propSchema] of Object.entries(targetProps)) {
      const val = result[prop];
      if (val === undefined) {
        continue;
      }
      const ps = propSchema as any;
      const propType = ps.type;

      // Handle nested objects
      if (propType === 'object') {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const nestedSchema = this.effectiveObjectSchema(ps);
          const nestedResult = this.castInstanceToSchema(val, nestedSchema, this.buildPath(basePath, prop));
          result[prop] = nestedResult.casted;
          added.push(...nestedResult.added);
          removed.push(...nestedResult.removed);
          incompatibilityReasons.push(...nestedResult.incompatibilityReasons);
        }
      }

      // Handle arrays of objects
      if (propType === 'array') {
        if (Array.isArray(val)) {
          const itemsSchema = ps.items;
          if (itemsSchema && itemsSchema.type === 'object') {
            const nestedSchema = this.effectiveObjectSchema(itemsSchema);
            const newList: any[] = [];
            for (let idx = 0; idx < val.length; idx++) {
              const item = val[idx];
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                const nestedResult = this.castInstanceToSchema(
                  item,
                  nestedSchema,
                  this.buildPath(basePath, `${prop}[${idx}]`)
                );
                newList.push(nestedResult.casted);
                added.push(...nestedResult.added);
                removed.push(...nestedResult.removed);
                incompatibilityReasons.push(...nestedResult.incompatibilityReasons);
              } else {
                newList.push(item);
              }
            }
            result[prop] = newList;
          }
        }
      }
    }

    return { casted: result, added, removed, incompatibilityReasons };
  }

  private effectiveObjectSchema(schema: any): any {
    if (!schema) {
      return {};
    }

    // If it has properties or required directly, use it
    if (schema.properties || schema.required) {
      return schema;
    }

    // Check allOf for object schemas
    if (schema.allOf && Array.isArray(schema.allOf)) {
      for (const part of schema.allOf) {
        if (part.properties || part.required) {
          return part;
        }
      }
    }

    return schema;
  }

  private removeGtsConstConstraints(schema: any): any {
    if (schema === null || schema === undefined) {
      return schema;
    }

    if (typeof schema === 'object' && !Array.isArray(schema)) {
      const result: any = {};
      for (const [key, value] of Object.entries(schema)) {
        if (key === 'const') {
          if (typeof value === 'string' && Gts.isValidGtsID(value)) {
            // Replace const with type constraint instead
            result.type = 'string';
            continue;
          }
        }
        result[key] = this.removeGtsConstConstraints(value);
      }
      return result;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.removeGtsConstConstraints(item));
    }

    return schema;
  }

  private buildPath(base: string, prop: string): string {
    if (!base) {
      return prop;
    }
    // Handle array indices that already have brackets
    if (prop.startsWith('[')) {
      return base + prop;
    }
    return base + '.' + prop;
  }

  private deepCopy(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepCopy(item));
    }
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.deepCopy(value);
    }
    return result;
  }

  private deduplicate(arr: string[]): string[] {
    const unique = Array.from(new Set(arr));
    return unique.sort();
  }

  validateSchemaAgainstParent(schemaId: string): ValidationResult {
    const entity = this.get(schemaId);
    if (!entity) {
      return { id: schemaId, ok: false, error: `Entity not found: ${schemaId}` };
    }
    if (!entity.isSchema) {
      return { id: schemaId, ok: false, error: `Entity is not a schema: ${schemaId}` };
    }

    const content = entity.content;

    // §9.11.1 - the modifiers must be well-formed on the schema itself
    const declarationError = GtsModifiers.validateDeclaration(content);
    if (declarationError) {
      return { id: schemaId, ok: false, error: declarationError };
    }

    // §9.11.2 item 2 - a final type anywhere in the base chain blocks derivation
    const finalBase = this.findFinalBaseInChain(schemaId);
    if (finalBase) {
      return {
        id: schemaId,
        ok: false,
        error: `base type '${finalBase}' is final and cannot be extended`,
      };
    }

    // Per ADR-0001 derivation is established by the chained `$id` alone, so the
    // parent is taken from the chain. A body that references the parent via
    // `allOf` + `$ref` and one that restates the parent's fields are both valid
    // derivation forms and are checked identically.
    const chain = this.buildSchemaChain(schemaId);
    const parentId = chain.length > 1 ? chain[chain.length - 2] : null;
    if (!parentId) {
      // Base schema with no parent → still validate traits
      return this.validateSchemaTraits(schemaId);
    }

    const parentEntity = this.get(parentId);
    if (!parentEntity) {
      return { id: schemaId, ok: false, error: `Parent schema not found: ${parentId}` };
    }
    if (!parentEntity.isSchema || !parentEntity.content) {
      return { id: schemaId, ok: false, error: `Parent entity is not a schema: ${parentId}` };
    }

    // Detect cyclic $$ref / $ref references in the schema's own content
    const cycleError = this.detectRefCycle(schemaId, content, new Set([schemaId]));
    if (cycleError) {
      return { id: schemaId, ok: false, error: cycleError };
    }

    // Resolve parent's effective (fully flattened) schema
    const resolvedParent = this.resolveSchemaFully(parentEntity.content);

    // Extract overlay from derived schema (non-$ref subschemas in allOf + top-level)
    const overlay = this.extractOverlay(content);

    // Compare overlay against resolved parent
    const inheritsViaRef = this.inheritsParentViaRef(content, parentId);
    const errors = this.compareOverlayToBase(overlay, resolvedParent, '', inheritsViaRef);
    if (errors.length > 0) {
      return { id: schemaId, ok: false, error: errors.join('; ') };
    }

    // OP#13: Validate schema traits across the inheritance chain
    const traitsResult = this.validateSchemaTraits(schemaId);
    if (!traitsResult.ok) {
      return traitsResult;
    }

    return { id: schemaId, ok: true, error: '' };
  }

  /**
   * OP#13 - trait validation across the `$id` chain (spec §9.7.5, ADR-0002/3/4).
   *
   *   1. effective trait-schema = `allOf` of every top-level `x-gts-traits-schema`
   *      along the chain, root to leaf;
   *   2. effective traits object = every top-level `x-gts-traits` applied in turn
   *      as an RFC 7396 JSON Merge Patch, root to leaf;
   *   3. materialize trait-schema `default`s for properties the merge left absent;
   *   4. for non-abstract types, the materialized object must validate against the
   *      effective trait-schema (the "completeness check").
   *
   * There is no bespoke immutability rule: a publisher locks a trait value with
   * `const` in the trait-schema, which the standard validation in step 4 enforces.
   */
  private validateSchemaTraits(schemaId: string): ValidationResult {
    const chain = this.buildSchemaChain(schemaId);

    const traitSchemas: any[] = [];
    // `x-gts-traits-schema: false` is the "no traits permitted" declaration and
    // makes the aggregate unsatisfiable; tracked separately so that a subtree
    // with no traits at all still validates (ADR-0002).
    let traitsProhibited = false;
    // A `true` declaration constrains nothing but still establishes that the
    // chain defines a trait surface, so descendants may carry trait values.
    let hasTraitSchemaDeclaration = false;
    let effectiveTraits: Record<string, any> = {};

    for (const chainSchemaId of chain) {
      const entity = this.get(chainSchemaId);
      if (!entity || !entity.content) continue;
      const content = entity.content;

      const declaredSchema = content['x-gts-traits-schema'];
      if (declaredSchema !== undefined) {
        hasTraitSchemaDeclaration = true;
        if (declaredSchema === false) {
          traitsProhibited = true;
        } else if (declaredSchema !== true) {
          try {
            traitSchemas.push(this.resolveTraitSchemaRefs(declaredSchema, new Set()));
          } catch (e) {
            return { id: schemaId, ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
      }

      const declaredValues = content['x-gts-traits'];
      if (declaredValues !== undefined) {
        if (typeof declaredValues !== 'object' || declaredValues === null || Array.isArray(declaredValues)) {
          return {
            id: schemaId,
            ok: false,
            error: `x-gts-traits in '${chainSchemaId}' must be an object`,
          };
        }
        effectiveTraits = this.applyMergePatch(effectiveTraits, declaredValues);
      }
    }

    if (!hasTraitSchemaDeclaration) {
      if (Object.keys(effectiveTraits).length > 0) {
        return {
          id: schemaId,
          ok: false,
          error: 'x-gts-traits values provided but no x-gts-traits-schema is defined in the inheritance chain',
        };
      }
      return { id: schemaId, ok: true, error: '' };
    }

    const effectiveSchema: any = traitSchemas.length === 1 ? traitSchemas[0] : { allOf: traitSchemas };
    const materialized = this.applyTraitDefaults(effectiveSchema, effectiveTraits);

    // The effective trait-schema must be satisfiable in the first place. This
    // is a property of the composed schema, so - unlike completeness - it is
    // checked for abstract types too.
    const unsatisfiable = this.findUnsatisfiableTrait(traitSchemas, '');
    if (unsatisfiable) {
      return { id: schemaId, ok: false, error: `effective trait schema cannot be satisfied: ${unsatisfiable}` };
    }

    // `x-gts-traits-schema: false` bans traits across the whole subtree, which
    // is a prohibition rather than a completeness requirement - so it applies
    // to abstract members of that subtree too, and is checked before the
    // abstract exemption below.
    if (traitsProhibited && Object.keys(materialized).length > 0) {
      return {
        id: schemaId,
        ok: false,
        error: 'x-gts-traits-schema is false in the inheritance chain, so no traits are permitted',
      };
    }

    // Abstract types are exempt from completeness: descendants close the gaps.
    const self = this.get(schemaId);
    if (self && GtsModifiers.isAbstract(self.content)) {
      return { id: schemaId, ok: true, error: '' };
    }

    if (traitSchemas.length === 0) {
      return { id: schemaId, ok: true, error: '' };
    }

    try {
      const validate = this.ajv.compile(this.normalizeSchema(effectiveSchema));
      if (!validate(materialized)) {
        const errors =
          validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ') || 'Trait validation failed';
        return { id: schemaId, ok: false, error: `trait validation: ${errors}` };
      }
    } catch (e) {
      return {
        id: schemaId,
        ok: false,
        error: `failed to compile trait schema: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    return { id: schemaId, ok: true, error: '' };
  }

  /**
   * Checks that the `allOf` composition of the chain's trait-schema branches
   * leaves every declared trait property expressible (§9.7.5, "if the effective
   * trait schema cannot be satisfied ... schema validation MUST fail").
   *
   * Two ways a descendant branch can make an ancestor's trait unusable:
   *   - it closes its own branch with `additionalProperties: false` without
   *     restating the ancestor's property, which orphans it - `allOf` branches
   *     are evaluated independently, so the closed branch rejects the value;
   *   - it redeclares the property with a disjoint `type`, so no value can
   *     satisfy both branches.
   *
   * Returns a description of the first problem found, or null when satisfiable.
   */
  private findUnsatisfiableTrait(branches: any[], path: string, depth: number = 0): string | null {
    if (depth > 32) return null;

    const objectBranches = branches.filter((b) => typeof b === 'object' && b !== null);
    if (objectBranches.length === 0) return null;

    // Every property name declared by any branch at this level.
    const declaredBy = new Map<string, any[]>();
    for (const branch of objectBranches) {
      const props = branch.properties;
      if (!props || typeof props !== 'object') continue;
      for (const [name, subSchema] of Object.entries(props)) {
        const existing = declaredBy.get(name);
        if (existing) existing.push(subSchema);
        else declaredBy.set(name, [subSchema]);
      }
    }

    for (const [name, subSchemas] of declaredBy) {
      const propPath = path ? `${path}.${name}` : name;

      for (const branch of objectBranches) {
        if (branch.additionalProperties !== false) continue;
        const declaresLocally = !!branch.properties && name in branch.properties;
        if (!declaresLocally) {
          return `trait '${propPath}' is declared by one branch but excluded by a closed branch that does not restate it`;
        }
      }

      const conflict = this.findTypeConflict(subSchemas);
      if (conflict) {
        return `trait '${propPath}' has conflicting types across the chain: ${conflict}`;
      }

      const nested = this.findUnsatisfiableTrait(subSchemas, propPath, depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  /** Returns a description when the `type` keywords across subschemas cannot all hold. */
  private findTypeConflict(subSchemas: any[]): string | null {
    let allowed: Set<string> | null = null;
    const seen: string[] = [];

    for (const subSchema of subSchemas) {
      if (typeof subSchema !== 'object' || subSchema === null || subSchema.type === undefined) continue;
      const types = new Set<string>(Array.isArray(subSchema.type) ? subSchema.type : [subSchema.type]);
      // `integer` is a subset of `number`, so the two are compatible.
      if (types.has('number')) types.add('integer');
      seen.push(Array.isArray(subSchema.type) ? subSchema.type.join('|') : String(subSchema.type));

      if (allowed === null) {
        allowed = types;
        continue;
      }
      allowed = new Set(Array.from(allowed).filter((t) => types.has(t)));
      if (allowed.size === 0) {
        return seen.join(' vs ');
      }
    }

    return null;
  }

  /**
   * JSON Merge Patch (RFC 7396): objects merge recursively, every other value
   * replaces wholesale, and a `null` deletes the key.
   */
  private applyMergePatch(target: Record<string, any>, patch: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = { ...target };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete result[key];
        continue;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        const current = result[key];
        const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {};
        result[key] = this.applyMergePatch(base, value);
        continue;
      }
      result[key] = value;
    }

    return result;
  }

  // Build the schema chain from base to leaf for a given schema ID
  /**
   * Returns the id of the first base type in the `$id` chain of `schemaId` that
   * is marked `x-gts-final`, or null when the chain is derivable (§9.11.2).
   *
   * Determined from the chained `$id` alone, so it holds regardless of whether
   * the derived body uses `allOf` + `$ref` or restates the parent's fields.
   * Only proper ancestors are considered: a type being final does not
   * invalidate itself.
   */
  findFinalBaseInChain(schemaId: string): string | null {
    const chain = this.buildSchemaChain(schemaId);
    for (const baseId of chain.slice(0, -1)) {
      const baseEntity = this.get(baseId);
      if (baseEntity && baseEntity.isSchema && GtsModifiers.isFinal(baseEntity.content)) {
        return baseId;
      }
    }
    return null;
  }

  /** True when `typeId` resolves to a registered type marked `x-gts-abstract` (§9.11.3). */
  isAbstractType(typeId: string): boolean {
    const normalized = typeId.startsWith(GTS_URI_PREFIX) ? typeId.substring(GTS_URI_PREFIX.length) : typeId;
    const entity = this.get(normalized);
    return !!entity && entity.isSchema && GtsModifiers.isAbstract(entity.content);
  }

  private buildSchemaChain(schemaId: string): string[] {
    // Parse the schema ID to get segments
    try {
      const gtsId = Gts.parseGtsID(schemaId);
      const segments = gtsId.segments;
      const chain: string[] = [];

      for (let i = 0; i < segments.length; i++) {
        const id =
          'gts.' +
          segments
            .slice(0, i + 1)
            .map((s) => s.segment)
            .join('');
        chain.push(id);
      }

      return chain;
    } catch {
      return [schemaId];
    }
  }

  // Resolve $ref inside a trait schema, detecting cycles
  private resolveTraitSchemaRefs(schema: any, visited: Set<string>, depth: number = 0): any {
    if (depth > 64) return schema;
    if (typeof schema !== 'object' || schema === null) return schema;

    const result: any = {};

    for (const [key, value] of Object.entries(schema)) {
      if (key === '$$ref' || key === '$ref') {
        const refUri = value as string;
        const refId = refUri.startsWith(GTS_URI_PREFIX) ? refUri.substring(GTS_URI_PREFIX.length) : refUri;

        if (visited.has(refId)) {
          throw new Error(`Cyclic reference detected in trait schema: ${refId}`);
        }
        visited.add(refId);

        const refEntity = this.get(refId);
        if (!refEntity || !refEntity.content) {
          throw new Error(`Unresolvable trait schema reference: ${refUri}`);
        }
        const resolved = this.resolveTraitSchemaRefs(refEntity.content, visited, depth + 1);
        // Merge resolved content into result
        for (const [rk, rv] of Object.entries(resolved)) {
          if (rk !== '$id' && rk !== '$$id' && rk !== '$schema' && rk !== '$$schema') {
            result[rk] = rv;
          }
        }
        continue;
      }

      if (key === 'allOf' && Array.isArray(value)) {
        result.allOf = (value as any[]).map((item) => this.resolveTraitSchemaRefs(item, visited, depth + 1));
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.resolveTraitSchemaRefs(value, new Set(visited), depth + 1);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  // Apply defaults from trait schema to trait values
  private applyTraitDefaults(schema: any, traits: Record<string, any>): Record<string, any> {
    const result = { ...traits };
    const props = this.collectAllTraitProperties(schema);

    for (const [propName, propSchema] of Object.entries(props)) {
      if (!(propName in result) && typeof propSchema === 'object' && propSchema !== null && 'default' in propSchema) {
        result[propName] = propSchema.default;
      }
    }

    return result;
  }

  // Collect all properties from a trait schema (handling allOf composition)
  private collectAllTraitProperties(schema: any, depth: number = 0): Record<string, any> {
    const props: Record<string, any> = {};
    if (depth > 64 || typeof schema !== 'object' || schema === null) return props;

    if (typeof schema.properties === 'object' && schema.properties !== null) {
      Object.assign(props, schema.properties);
    }

    if (Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) {
        Object.assign(props, this.collectAllTraitProperties(item, depth + 1));
      }
    }

    return props;
  }

  // Detect cyclic $$ref/$ref references reachable from a schema's content
  private detectRefCycle(originId: string, content: any, visited: Set<string>, depth: number = 0): string | null {
    if (depth > 64 || !content || typeof content !== 'object') return null;

    // Check direct ref on this object
    const ref = content['$$ref'] || content['$ref'];
    if (typeof ref === 'string') {
      const refId = ref.startsWith(GTS_URI_PREFIX) ? ref.substring(GTS_URI_PREFIX.length) : ref;
      if (visited.has(refId)) {
        return `Cyclic reference detected: ${refId}`;
      }
      const refEntity = this.get(refId);
      if (refEntity && refEntity.content) {
        visited.add(refId);
        const inner = this.detectRefCycle(originId, refEntity.content, visited, depth + 1);
        if (inner) return inner;
      }
    }

    // Recurse into allOf
    if (Array.isArray(content.allOf)) {
      for (const sub of content.allOf) {
        const inner = this.detectRefCycle(originId, sub, visited, depth + 1);
        if (inner) return inner;
      }
    }

    return null;
  }

  /** Every `$ref` / `$$ref` declared directly by an `allOf` branch of `schema`. */
  private collectAllOfRefs(schema: any): string[] {
    if (!schema || !Array.isArray(schema.allOf)) {
      return [];
    }
    const refs: string[] = [];
    for (const sub of schema.allOf) {
      if (sub && typeof sub === 'object') {
        const ref = sub['$$ref'] || sub['$ref'];
        if (typeof ref === 'string') {
          refs.push(ref);
        }
      }
    }
    return refs;
  }

  /**
   * True when the derived body pulls its chain parent in through `allOf` +
   * `$ref`, so the parent's constraints keep applying to the same instance.
   *
   * A reference to some unrelated type does not count: the parent's
   * constraints would not be inherited, so the derived body still has to
   * restate them (ADR-0001 variant 2c).
   */
  private inheritsParentViaRef(schema: any, parentId: string): boolean {
    return this.collectAllOfRefs(schema).some((ref) => {
      const normalized = ref.startsWith(GTS_URI_PREFIX) ? ref.substring(GTS_URI_PREFIX.length) : ref;
      return normalized === parentId;
    });
  }

  private resolveSchemaFully(schema: any, visited: Set<string> = new Set()): ResolvedSchema {
    const result: ResolvedSchema = {
      properties: {},
      required: [],
      additionalProperties: undefined,
      type: schema.type,
    };

    // If this schema has allOf, resolve each part
    if (schema.allOf && Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) {
        const ref = sub['$$ref'] || sub['$ref'];
        if (typeof ref === 'string') {
          // Resolve referenced schema
          const refId = ref.startsWith(GTS_URI_PREFIX) ? ref.substring(GTS_URI_PREFIX.length) : ref;
          if (visited.has(refId)) {
            continue;
          }
          visited.add(refId);
          const refEntity = this.get(refId);
          if (refEntity && refEntity.content) {
            const resolved = this.resolveSchemaFully(refEntity.content, visited);
            Object.assign(result.properties, resolved.properties);
            if (resolved.required) {
              result.required.push(...resolved.required);
            }
            if (resolved.additionalProperties !== undefined) {
              result.additionalProperties = resolved.additionalProperties;
            }
            if (resolved.type && !result.type) {
              result.type = resolved.type;
            }
          }
        } else {
          // Non-ref subschema - merge it
          const resolved = this.resolveSchemaFully(sub, visited);
          // For overlay properties, merge them (they override)
          for (const [propName, propSchema] of Object.entries(resolved.properties || {})) {
            if (result.properties[propName]) {
              // Merge property constraints - overlay tightens base
              result.properties[propName] = this.mergePropertySchemas(result.properties[propName], propSchema);
            } else {
              result.properties[propName] = propSchema;
            }
          }
          if (resolved.required) {
            result.required.push(...resolved.required);
          }
          if (resolved.additionalProperties !== undefined) {
            result.additionalProperties = resolved.additionalProperties;
          }
        }
      }
    }

    // Add direct properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (result.properties[propName]) {
          result.properties[propName] = this.mergePropertySchemas(result.properties[propName], propSchema);
        } else {
          result.properties[propName] = propSchema;
        }
      }
    }

    // Add direct required
    if (schema.required && Array.isArray(schema.required)) {
      result.required.push(...schema.required);
    }

    // Direct additionalProperties
    if (schema.additionalProperties !== undefined) {
      result.additionalProperties = schema.additionalProperties;
    }

    // Deduplicate required
    result.required = Array.from(new Set(result.required));

    return result;
  }

  private mergePropertySchemas(base: any, overlay: any): any {
    if (base === false || overlay === false) {
      return false;
    }
    if (typeof base !== 'object' || typeof overlay !== 'object') {
      return overlay;
    }
    const merged: any = { ...base };
    for (const [key, val] of Object.entries(overlay)) {
      if (key === 'properties' && merged.properties) {
        merged.properties = { ...merged.properties, ...(val as any) };
      } else if (key === 'required' && merged.required) {
        const mergedReq = new Set([...(merged.required as string[]), ...(val as string[])]);
        merged.required = Array.from(mergedReq);
      } else {
        merged[key] = val;
      }
    }
    return merged;
  }

  private extractOverlay(schema: any): ResolvedSchema {
    const overlay: ResolvedSchema = {
      properties: {},
      required: [],
      additionalProperties: undefined,
    };

    if (schema.allOf && Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) {
        const ref = sub['$$ref'] || sub['$ref'];
        if (typeof ref === 'string') {
          continue; // Skip ref subschemas
        }
        // This is a non-ref overlay subschema
        if (sub.properties) {
          for (const [propName, propSchema] of Object.entries(sub.properties)) {
            overlay.properties[propName] = overlay.properties[propName]
              ? this.mergePropertySchemas(overlay.properties[propName], propSchema)
              : propSchema;
          }
        }
        if (sub.required && Array.isArray(sub.required)) {
          overlay.required.push(...sub.required);
        }
        if (sub.additionalProperties !== undefined) {
          overlay.additionalProperties = sub.additionalProperties;
        }
      }
    }

    // Add top-level properties (outside allOf)
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        overlay.properties[propName] = overlay.properties[propName]
          ? this.mergePropertySchemas(overlay.properties[propName], propSchema)
          : propSchema;
      }
    }
    if (schema.required && Array.isArray(schema.required)) {
      overlay.required.push(...schema.required);
    }
    if (schema.additionalProperties !== undefined && overlay.additionalProperties === undefined) {
      overlay.additionalProperties = schema.additionalProperties;
    }

    return overlay;
  }

  /**
   * Compares a derived schema's overlay against its resolved base (§3.1, §4.1).
   *
   * `inheritsViaRef` says whether the derived body pulls the base in through
   * `allOf` + `$ref`. When it does, the base branch keeps applying to the same
   * instance, so the overlay cannot loosen anything by omission - only by
   * excluding values the base allows. When the derived body instead restates
   * the parent's fields (ADR-0001 variant 2c), anything it fails to restate is
   * a genuine loosening.
   */
  private compareOverlayToBase(
    overlay: ResolvedSchema,
    baseResolved: ResolvedSchema,
    path: string,
    inheritsViaRef: boolean = true
  ): string[] {
    const errors: string[] = [];
    const overlayProps = overlay.properties || {};
    const baseProps = baseResolved.properties || {};

    for (const [propName, propSchema] of Object.entries(overlayProps)) {
      const propPath = path ? `${path}.${propName}` : propName;

      // Property schema set to false
      if (propSchema === false) {
        if (baseProps[propName] !== undefined) {
          errors.push(`Property '${propPath}' is set to false but exists in base`);
        }
        continue;
      }

      const baseProp = baseProps[propName];

      if (baseProp === undefined || baseProp === null) {
        // New property not in base
        if (baseResolved.additionalProperties === false) {
          errors.push(`Property '${propPath}' not in base and base has additionalProperties: false`);
        }
        continue;
      }

      if (baseProp === false) {
        // Base already set property to false, overlay can't use it
        errors.push(`Property '${propPath}' is forbidden in base`);
        continue;
      }

      // Both base and overlay have this property — compare constraints
      if (typeof propSchema === 'object' && propSchema !== null) {
        errors.push(...this.comparePropertyConstraints(propSchema, baseProp, propPath, inheritsViaRef));
      }
    }

    // A derived level that closes itself must restate the base's properties:
    // under allOf the closed branch is evaluated on its own and would reject
    // every value the base declares but the derived omits.
    if (overlay.additionalProperties === false) {
      for (const propName of Object.keys(baseProps)) {
        if (baseProps[propName] === false) continue;
        if (!(propName in overlayProps)) {
          const propPath = path ? `${path}.${propName}` : propName;
          errors.push(`Property '${propPath}' is declared in base but excluded by additionalProperties: false`);
        }
      }
    }

    if (!inheritsViaRef) {
      // The derived schema stands alone, so it must carry the base's
      // constraints itself rather than inherit them through a $ref.
      if (baseResolved.additionalProperties === false && overlay.additionalProperties !== false) {
        errors.push('Cannot loosen additionalProperties from false to true');
      }

      const overlayRequired = new Set(overlay.required || []);
      for (const requiredProp of baseResolved.required || []) {
        if (!overlayRequired.has(requiredProp)) {
          const propPath = path ? `${path}.${requiredProp}` : requiredProp;
          errors.push(`Property '${propPath}' is required in base but not in derived`);
        }
      }
    }

    return errors;
  }

  private comparePropertyConstraints(
    derived: any,
    base: any,
    propPath: string,
    inheritsViaRef: boolean = true
  ): string[] {
    const errors: string[] = [];

    if (typeof base !== 'object' || base === null) {
      return errors;
    }

    // Type check
    const baseType = base.type;
    const derivedType = derived.type;
    if (baseType !== undefined && derivedType !== undefined) {
      if (Array.isArray(derivedType)) {
        // Derived has array type — widening (fail)
        if (!Array.isArray(baseType)) {
          errors.push(`Property '${propPath}' widens type from '${baseType}' to array`);
          return errors;
        }
      }
      if (Array.isArray(baseType)) {
        if (!Array.isArray(derivedType)) {
          // Could be narrowing from array type
          if (!baseType.includes(derivedType)) {
            errors.push(`Property '${propPath}' type '${derivedType}' not in base types [${baseType}]`);
            return errors;
          }
        }
      } else if (!Array.isArray(derivedType)) {
        // Both scalar types
        if (baseType !== derivedType) {
          errors.push(`Property '${propPath}' type changed from '${baseType}' to '${derivedType}'`);
          return errors;
        }
      }
    }

    // Determine if the overlay adds any NEW constraint keywords not in the base.
    // Under allOf semantics, base constraints are preserved. Drops are only flagged
    // when the overlay doesn't introduce any new tightening constraints.
    const CONSTRAINT_KEYWORDS = [
      'maxLength',
      'minLength',
      'maximum',
      'minimum',
      'maxItems',
      'minItems',
      'enum',
      'const',
      'pattern',
      'items',
    ];
    const baseConstraintKeys = new Set(CONSTRAINT_KEYWORDS.filter((kw) => base[kw] !== undefined));
    const derivedConstraintKeys = new Set(CONSTRAINT_KEYWORDS.filter((kw) => derived[kw] !== undefined));
    const hasNewConstraints = [...derivedConstraintKeys].some((kw) => !baseConstraintKeys.has(kw));

    // Max constraints (tightening = lower value OK; loosening = higher value FAIL)
    for (const kw of ['maxLength', 'maximum', 'maxItems']) {
      if (base[kw] !== undefined) {
        if (derived[kw] === undefined) {
          if (!hasNewConstraints) {
            errors.push(`Property '${propPath}' drops constraint '${kw}'`);
          }
        } else if (derived[kw] > base[kw]) {
          errors.push(`Property '${propPath}' loosens '${kw}' from ${base[kw]} to ${derived[kw]}`);
        }
      }
    }

    // Min constraints (tightening = higher value OK; loosening = lower value FAIL)
    for (const kw of ['minLength', 'minimum', 'minItems']) {
      if (base[kw] !== undefined) {
        if (derived[kw] === undefined) {
          if (!hasNewConstraints) {
            errors.push(`Property '${propPath}' drops constraint '${kw}'`);
          }
        } else if (derived[kw] < base[kw]) {
          errors.push(`Property '${propPath}' loosens '${kw}' from ${base[kw]} to ${derived[kw]}`);
        }
      }
    }

    // Enum check
    if (base.enum !== undefined) {
      if (derived.enum === undefined) {
        if (!hasNewConstraints) {
          errors.push(`Property '${propPath}' drops constraint 'enum'`);
        }
      } else {
        const baseSet = new Set(base.enum.map((v: any) => JSON.stringify(v)));
        for (const val of derived.enum) {
          if (!baseSet.has(JSON.stringify(val))) {
            errors.push(`Property '${propPath}' enum value '${val}' not in base enum`);
          }
        }
      }
    }

    // Const check
    if (base.const !== undefined) {
      if (derived.const === undefined) {
        if (!hasNewConstraints) {
          errors.push(`Property '${propPath}' drops constraint 'const'`);
        }
      } else if (JSON.stringify(base.const) !== JSON.stringify(derived.const)) {
        errors.push(
          `Property '${propPath}' const conflict: ${JSON.stringify(derived.const)} vs base ${JSON.stringify(base.const)}`
        );
      }
    }
    // Check const in derived against base numeric constraints
    if (derived.const !== undefined && typeof derived.const === 'number') {
      if (base.minimum !== undefined && derived.const < base.minimum) {
        errors.push(`Property '${propPath}' const ${derived.const} violates base minimum ${base.minimum}`);
      }
      if (base.maximum !== undefined && derived.const > base.maximum) {
        errors.push(`Property '${propPath}' const ${derived.const} violates base maximum ${base.maximum}`);
      }
    }

    // Pattern check
    if (base.pattern !== undefined) {
      if (derived.pattern === undefined) {
        if (!hasNewConstraints) {
          errors.push(`Property '${propPath}' drops constraint 'pattern'`);
        }
      } else if (base.pattern !== derived.pattern) {
        errors.push(`Property '${propPath}' pattern changed from '${base.pattern}' to '${derived.pattern}'`);
      }
    }

    // Items check (array items)
    if (base.items !== undefined) {
      if (derived.items === undefined) {
        if (!hasNewConstraints) {
          errors.push(`Property '${propPath}' drops constraint 'items'`);
        }
      } else if (typeof base.items === 'object' && typeof derived.items === 'object') {
        errors.push(...this.comparePropertyConstraints(derived.items, base.items, `${propPath}.items`, inheritsViaRef));
      }
    }

    // Nested object: recursively compare
    if (base.type === 'object' && derived.type === 'object') {
      if (base.properties || derived.properties) {
        const nestedOverlay = {
          properties: derived.properties || {},
          required: derived.required || [],
          additionalProperties: derived.additionalProperties,
        };
        const nestedBase = {
          properties: base.properties || {},
          required: base.required || [],
          additionalProperties: base.additionalProperties,
        };
        errors.push(...this.compareOverlayToBase(nestedOverlay, nestedBase, propPath, inheritsViaRef));
      }
    }

    return errors;
  }

  getAttribute(gtsId: string, path: string): any {
    const entity = this.get(gtsId);
    if (!entity) {
      return {
        gts_id: gtsId,
        path,
        resolved: false,
        error: `Entity not found: ${gtsId}`,
      };
    }

    const value = this.getNestedValue(entity.content, path);

    return {
      gts_id: gtsId,
      path,
      resolved: value !== undefined,
      value,
    };
  }

  private getNestedValue(obj: any, path: string): any {
    // Split path by dots but handle array notation
    const parts: string[] = [];
    let current = '';
    let inBracket = false;

    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === '[') {
        if (current) {
          parts.push(current);
          current = '';
        }
        inBracket = true;
      } else if (char === ']') {
        if (current) {
          parts.push(`[${current}]`);
          current = '';
        }
        inBracket = false;
      } else if (char === '.' && !inBracket) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    if (current) {
      parts.push(current);
    }

    let result = obj;
    for (const part of parts) {
      if (result === null || result === undefined) {
        return undefined;
      }

      // Handle array index notation
      if (part.startsWith('[') && part.endsWith(']')) {
        const index = parseInt(part.slice(1, -1), 10);
        if (Array.isArray(result) && !isNaN(index)) {
          result = result[index];
        } else {
          return undefined;
        }
      } else {
        // Regular property access
        if (typeof result === 'object' && part in result) {
          result = result[part];
        } else {
          return undefined;
        }
      }
    }

    return result;
  }
}

export function createJsonEntity(content: any, _config?: Partial<GtsConfig>): JsonEntity {
  const extractResult = GtsExtractor.extractID(content);

  const references = new Set<string>();
  findReferences(content, references);

  return {
    id: extractResult.id,
    schemaId: extractResult.type_id,
    content,
    isSchema: extractResult.is_type_schema,
    references,
  };
}

function findReferences(obj: any, refs: Set<string>, visited = new Set()): void {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) {
    return;
  }

  visited.add(obj);

  if ('$ref' in obj && typeof obj['$ref'] === 'string') {
    const ref = obj['$ref'];
    const normalized = ref.startsWith(GTS_URI_PREFIX) ? ref.substring(GTS_URI_PREFIX.length) : ref;
    if (Gts.isValidGtsID(normalized)) {
      refs.add(normalized);
    }
  }

  if ('x-gts-ref' in obj && typeof obj['x-gts-ref'] === 'string') {
    const ref = obj['x-gts-ref'];
    if (Gts.isValidGtsID(ref)) {
      refs.add(ref);
    }
  }

  for (const value of Object.values(obj)) {
    findReferences(value, refs, visited);
  }
}
