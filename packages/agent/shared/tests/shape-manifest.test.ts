/**
 * Tests for TypeStructure → manifest format serialization.
 * IC-8: shape-manifest.test.ts
 * Covers: AC-4, AC-5, AC-8, AC-9, AC-16, AC-17, AC-23, AC-24, AC-25, AC-26,
 *         EC-1, EC-2, BC-3, BC-4, BC-5, BC-6
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import type { TypeStructure, RillParam, RillFieldDef } from '@rcrsr/rill';
import {
  structuralTypeToInputSchema,
  structuralTypeToOutputSchema,
} from '../src/schema.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Builds a RillParam with safe defaults for testing.
 */
function makeRillParam(
  name: string,
  type: TypeStructure,
  defaultValue: RillParam['defaultValue'] = undefined,
  annotations: Record<string, unknown> = {}
): RillParam {
  return {
    name,
    type,
    defaultValue,
    annotations,
  };
}

/**
 * Builds a closure TypeStructure from name/type pairs.
 */
function makeClosureType(
  params: Array<[string, TypeStructure]>
): TypeStructure {
  return {
    kind: 'closure',
    params: params.map(([name, type]): RillFieldDef => ({ name, type })),
    ret: { kind: 'any' },
  };
}

function primitive(name: 'string' | 'number' | 'bool'): TypeStructure {
  return { kind: name };
}

function fd(name: string, type: TypeStructure): RillFieldDef {
  return { name, type };
}

// ============================================================
// structuralTypeToInputSchema
// ============================================================

describe('structuralTypeToInputSchema', () => {
  // ============================================================
  // TYPE NAME MAPPING [AC-8]
  // ============================================================

  describe('type name mapping [AC-8]', () => {
    it('maps "string" primitive to type "string"', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'))];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']?.type).toBe('string');
    });

    it('maps "number" primitive to type "number"', () => {
      const closureType = makeClosureType([['age', primitive('number')]]);
      const params = [makeRillParam('age', primitive('number'))];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['age']?.type).toBe('number');
    });

    it('maps "bool" primitive to type "bool"', () => {
      const closureType = makeClosureType([['active', primitive('bool')]]);
      const params = [makeRillParam('active', primitive('bool'))];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['active']?.type).toBe('bool');
    });

    it('maps list kind to type "list"', () => {
      const listType: TypeStructure = {
        kind: 'list',
        element: primitive('string'),
      };
      const closureType = makeClosureType([['tags', listType]]);
      const params = [makeRillParam('tags', listType)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['tags']?.type).toBe('list');
    });

    it('maps dict kind to type "dict"', () => {
      const dictType: TypeStructure = { kind: 'dict', fields: {} };
      const closureType = makeClosureType([['meta', dictType]]);
      const params = [makeRillParam('meta', dictType)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['meta']?.type).toBe('dict');
    });

    it('maps any kind to type "dict" (default branch)', () => {
      const anyType: TypeStructure = { kind: 'any' };
      const closureType = makeClosureType([['x', anyType]]);
      const params = [makeRillParam('x', anyType)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['x']?.type).toBe('dict');
    });
  });

  // ============================================================
  // REQUIRED / OPTIONAL [AC-4, AC-5, AC-23, AC-24, BC-3, BC-4]
  // ============================================================

  describe('required/optional [AC-4, AC-5, AC-23, AC-24, BC-3, BC-4]', () => {
    it('defaultValue: undefined produces required: true [AC-4, AC-23, BC-3]', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'), undefined)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']?.required).toBe(true);
    });

    it('defaultValue: someValue produces required: false (not set) [AC-5]', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'), 'default-val')];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']?.required).not.toBe(true);
    });

    it('defaultValue: 0 (falsy) produces required: false [AC-24, BC-4]', () => {
      const closureType = makeClosureType([['count', primitive('number')]]);
      const params = [makeRillParam('count', primitive('number'), 0)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['count']?.required).not.toBe(true);
    });

    it('defaultValue: false (falsy) produces required: false [BC-4]', () => {
      const closureType = makeClosureType([['active', primitive('bool')]]);
      const params = [makeRillParam('active', primitive('bool'), false)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['active']?.required).not.toBe(true);
    });
  });

  // ============================================================
  // ANNOTATION MAPPING [AC-25, AC-26, BC-5, BC-6]
  // ============================================================

  describe('annotation mapping [AC-25, AC-26, BC-5, BC-6]', () => {
    it('description and enum annotations propagate [AC-25, BC-5]', () => {
      const closureType = makeClosureType([['status', primitive('string')]]);
      const params = [
        makeRillParam('status', primitive('string'), undefined, {
          description: 'Status field',
          enum: ['active', 'inactive'],
        }),
      ];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['status']?.description).toBe('Status field');
      expect(schema['status']?.enum).toEqual(['active', 'inactive']);
    });

    it('empty annotations produce no description or enum [AC-26, BC-6]', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'), undefined, {})];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']?.description).toBeUndefined();
      expect(schema['name']?.enum).toBeUndefined();
    });

    it('non-string description annotation is not mapped', () => {
      const closureType = makeClosureType([['count', primitive('number')]]);
      const params = [
        makeRillParam('count', primitive('number'), undefined, { description: 42 }),
      ];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['count']?.description).toBeUndefined();
    });
  });

  // ============================================================
  // MULTIPLE PARAMS
  // ============================================================

  describe('multiple params', () => {
    it('maps all params in the closure type', () => {
      const closureType = makeClosureType([
        ['name', primitive('string')],
        ['age', primitive('number')],
        ['active', primitive('bool')],
      ]);
      const params = [
        makeRillParam('name', primitive('string'), undefined),
        makeRillParam('age', primitive('number'), 42),
        makeRillParam('active', primitive('bool'), undefined),
      ];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(Object.keys(schema)).toHaveLength(3);
      expect(schema['name']?.type).toBe('string');
      expect(schema['age']?.type).toBe('number');
      expect(schema['active']?.type).toBe('bool');
    });

    it('returns empty object for a closure type with no params', () => {
      const closureType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const schema = structuralTypeToInputSchema(closureType, []);
      expect(schema).toEqual({});
    });
  });

  // ============================================================
  // OUTPUT IDENTICAL TO rillShapeToInputSchema [AC-8]
  // ============================================================

  describe('output equivalent to legacy schema [AC-8]', () => {
    it('required param produces same structure as old optional:false field', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'), undefined)];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']).toEqual({ type: 'string', required: true });
    });

    it('optional param produces same structure as old optional:true field', () => {
      const closureType = makeClosureType([['name', primitive('string')]]);
      const params = [makeRillParam('name', primitive('string'), 'fallback')];
      const schema = structuralTypeToInputSchema(closureType, params);
      expect(schema['name']?.required).toBeUndefined();
    });
  });

  // ============================================================
  // EC-1: closure kind in param throws RILL-R004 [AC-16]
  // ============================================================

  describe('closure kind in param throws RuntimeError [EC-1, AC-16]', () => {
    it('closure param kind throws RuntimeError [EC-1, AC-16]', () => {
      const closureParamType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const closureType = makeClosureType([['fn', closureParamType]]);
      const params = [makeRillParam('fn', closureParamType)];
      expect(() => structuralTypeToInputSchema(closureType, params)).toThrow(
        RuntimeError
      );
    });

    it('closure param error has errorId RILL-R004 [EC-1, AC-16]', () => {
      const closureParamType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const closureType = makeClosureType([['fn', closureParamType]]);
      const params = [makeRillParam('fn', closureParamType)];
      let thrown: unknown;
      try {
        structuralTypeToInputSchema(closureType, params);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('stops at first invalid param (does not process remaining)', () => {
      const closureParamType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const closureType = makeClosureType([
        ['fn', closureParamType],
        ['name', primitive('string')],
      ]);
      const params = [
        makeRillParam('fn', closureParamType),
        makeRillParam('name', primitive('string')),
      ];
      expect(() => structuralTypeToInputSchema(closureType, params)).toThrow(
        RuntimeError
      );
    });
  });
});

// ============================================================
// structuralTypeToOutputSchema
// ============================================================

describe('structuralTypeToOutputSchema', () => {
  // ============================================================
  // OUTPUT SCHEMA STRUCTURE [AC-9]
  // ============================================================

  describe('output schema structure [AC-9]', () => {
    it('dict kind produces top-level type "dict"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { name: fd('name', primitive('string')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.type).toBe('dict');
    });

    it('dict kind places field descriptors under schema.fields', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { name: fd('name', primitive('string')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields).toBeDefined();
      expect(schema.fields?.['name']).toBeDefined();
    });

    it('maps "string" primitive field to type "string"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { name: fd('name', primitive('string')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['name']?.type).toBe('string');
    });

    it('maps "number" primitive field to type "number"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { score: fd('score', primitive('number')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['score']?.type).toBe('number');
    });

    it('maps "bool" primitive field to type "bool"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { flag: fd('flag', primitive('bool')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['flag']?.type).toBe('bool');
    });

    it('maps list kind field to type "list"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: {
          items: fd('items', { kind: 'list', element: primitive('string') }),
        },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['items']?.type).toBe('list');
    });

    it('maps nested dict kind field to type "dict"', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: {
          data: fd('data', { kind: 'dict', fields: {} }),
        },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['data']?.type).toBe('dict');
    });
  });

  // ============================================================
  // NESTED DICT RECURSION [AC-9]
  // ============================================================

  describe('nested dict recursion [AC-9]', () => {
    it('nested dict field produces nested fields record', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: {
          address: fd('address', {
            kind: 'dict',
            fields: { city: fd('city', primitive('string')) },
          }),
        },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['address']?.fields?.['city']?.type).toBe('string');
    });

    it('non-nested field has no fields entry', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { name: fd('name', primitive('string')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.fields?.['name']?.fields).toBeUndefined();
    });
  });

  // ============================================================
  // ORDERED VARIANT [AC-9]
  // ============================================================

  describe('ordered variant [AC-9]', () => {
    it('ordered kind produces top-level type "dict"', () => {
      const orderedType: TypeStructure = {
        kind: 'ordered',
        fields: [fd('name', primitive('string'))],
      };
      const schema = structuralTypeToOutputSchema(orderedType);
      expect(schema.type).toBe('dict');
    });

    it('ordered kind places field descriptors under schema.fields', () => {
      const orderedType: TypeStructure = {
        kind: 'ordered',
        fields: [fd('name', primitive('string'))],
      };
      const schema = structuralTypeToOutputSchema(orderedType);
      expect(schema.fields?.['name']?.type).toBe('string');
    });
  });

  // ============================================================
  // MULTIPLE FIELDS
  // ============================================================

  describe('multiple fields', () => {
    it('maps all fields in the dict type to output schema', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: {
          name: fd('name', primitive('string')),
          score: fd('score', primitive('number')),
        },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(Object.keys(schema.fields ?? {})).toHaveLength(2);
    });

    it('returns dict with empty fields for a dict type with no fields', () => {
      const dictType: TypeStructure = { kind: 'dict', fields: {} };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema.type).toBe('dict');
      expect(schema.fields).toEqual({});
    });
  });

  // ============================================================
  // OUTPUT IDENTICAL TO rillShapeToOutputSchema [AC-9]
  // ============================================================

  describe('output equivalent to legacy schema [AC-9]', () => {
    it('produces identical structure to what legacy shape-based call produced', () => {
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { name: fd('name', primitive('string')) },
      };
      const schema = structuralTypeToOutputSchema(dictType);
      expect(schema).toEqual({
        type: 'dict',
        fields: { name: { type: 'string' } },
      });
    });
  });

  // ============================================================
  // EC-2: tuple kind in field throws RILL-R004 [AC-17]
  // ============================================================

  describe('tuple kind in field throws RuntimeError [EC-2, AC-17]', () => {
    it('tuple kind field throws RuntimeError [EC-2, AC-17]', () => {
      const tupleType: TypeStructure = {
        kind: 'tuple',
        elements: [fd('0', primitive('string'))],
      };
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { t: fd('t', tupleType) },
      };
      expect(() => structuralTypeToOutputSchema(dictType)).toThrow(
        RuntimeError
      );
    });

    it('tuple kind field error has errorId RILL-R004 [EC-2, AC-17]', () => {
      const tupleType: TypeStructure = {
        kind: 'tuple',
        elements: [fd('0', primitive('string'))],
      };
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { t: fd('t', tupleType) },
      };
      let thrown: unknown;
      try {
        structuralTypeToOutputSchema(dictType);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('closure kind field throws RuntimeError', () => {
      const closureFieldType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { fn: fd('fn', closureFieldType) },
      };
      expect(() => structuralTypeToOutputSchema(dictType)).toThrow(
        RuntimeError
      );
    });

    it('closure kind field error has errorId RILL-R004', () => {
      const closureFieldType: TypeStructure = {
        kind: 'closure',
        params: [],
        ret: { kind: 'any' },
      };
      const dictType: TypeStructure = {
        kind: 'dict',
        fields: { fn: fd('fn', closureFieldType) },
      };
      let thrown: unknown;
      try {
        structuralTypeToOutputSchema(dictType);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R004');
    });
  });
});
