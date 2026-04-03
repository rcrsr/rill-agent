import { describe, it, expect } from 'vitest';
import { generateAgentCard } from '../src/card.js';
import type { AgentCardInput } from '../src/card.js';

// ============================================================
// HELPERS
// ============================================================

const MINIMAL_INPUT: AgentCardInput = {
  name: 'test-agent',
  version: '1.0.0',
  runtimeVariables: [],
};

// ============================================================
// GENERATE AGENT CARD (AgentCardInput)
// ============================================================

describe('generateAgentCard', () => {
  // ============================================================
  // IR-5: BASIC CARD GENERATION
  // ============================================================

  describe('basic card generation [IR-5]', () => {
    it('returns a valid AgentCard from minimal AgentCardInput [IR-5]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card).toMatchObject({
        name: 'test-agent',
        version: '1.0.0',
        description: '',
        url: '',
        capabilities: { streaming: false, pushNotifications: false },
        skills: [],
        defaultInputModes: ['application/json'],
        defaultOutputModes: ['application/json'],
        runtimeVariables: [],
      });
    });

    it('is a pure function with deterministic output [IR-5]', () => {
      const card1 = generateAgentCard(MINIMAL_INPUT);
      const card2 = generateAgentCard(MINIMAL_INPUT);
      expect(card1).toEqual(card2);
    });

    it('does not mutate the input', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        skills: [{ id: 'x', name: 'X', description: 'Skill X' }],
      };
      const originalSkillCount = input.skills!.length;
      generateAgentCard(input);
      expect(input.skills).toHaveLength(originalSkillCount);
      expect(input.name).toBe('test-agent');
    });
  });

  // ============================================================
  // CAPABILITIES [AC-1]
  // ============================================================

  describe('capabilities [AC-1]', () => {
    it('sets streaming to false [AC-1]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.capabilities.streaming).toBe(false);
    });

    it('sets pushNotifications to false [AC-1]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.capabilities.pushNotifications).toBe(false);
    });

    it('returns capabilities with exactly streaming and pushNotifications', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.capabilities).toEqual({
        streaming: false,
        pushNotifications: false,
      });
    });
  });

  // ============================================================
  // AC-10: RUNTIME VARIABLES
  // ============================================================

  describe('runtimeVariables [AC-10]', () => {
    it('includes runtimeVariables as empty array when none provided [AC-10]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.runtimeVariables).toEqual([]);
    });

    it('includes runtimeVariables from input when provided [AC-10]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        runtimeVariables: ['API_KEY', 'BASE_URL'],
      };
      const card = generateAgentCard(input);
      expect(card.runtimeVariables).toEqual(['API_KEY', 'BASE_URL']);
    });

    it('preserves order of runtimeVariables [AC-10]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        runtimeVariables: ['C_VAR', 'A_VAR', 'B_VAR'],
      };
      const card = generateAgentCard(input);
      expect(card.runtimeVariables).toEqual(['C_VAR', 'A_VAR', 'B_VAR']);
    });
  });

  // ============================================================
  // AC-16: SKILLS FROM AGENT CARD INPUT
  // ============================================================

  describe('skills from AgentCardInput [AC-16]', () => {
    it('includes skills from AgentCardInput [AC-16]', () => {
      const skills = [
        {
          id: 'summarize',
          name: 'Summarize',
          description: 'Summarizes text',
        },
      ];
      const input: AgentCardInput = { ...MINIMAL_INPUT, skills };
      const card = generateAgentCard(input);
      expect(card.skills).toEqual(skills);
    });

    it('defaults skills to empty array when absent from AgentCardInput [AC-16]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.skills).toEqual([]);
    });

    it('passes through a skill with all optional fields [AC-16]', () => {
      const skill = {
        id: 'classify',
        name: 'Classify',
        description: 'Classifies content',
        tags: ['ml', 'classification'],
        examples: ['Classify this text', 'Label this document'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      };
      const input: AgentCardInput = { ...MINIMAL_INPUT, skills: [skill] };
      const card = generateAgentCard(input);
      expect(card.skills[0]).toEqual(skill);
    });

    it('passes through a skill with only required fields [AC-16]', () => {
      const skill = {
        id: 'translate',
        name: 'Translate',
        description: 'Translates text between languages',
      };
      const input: AgentCardInput = { ...MINIMAL_INPUT, skills: [skill] };
      const card = generateAgentCard(input);
      expect(card.skills[0]).toEqual(skill);
      expect(card.skills[0]).not.toHaveProperty('tags');
      expect(card.skills[0]).not.toHaveProperty('examples');
      expect(card.skills[0]).not.toHaveProperty('inputModes');
      expect(card.skills[0]).not.toHaveProperty('outputModes');
    });

    it('preserves multiple skills in order [AC-16]', () => {
      const skills = [
        { id: 'a', name: 'Alpha', description: 'First skill' },
        { id: 'b', name: 'Beta', description: 'Second skill' },
      ];
      const input: AgentCardInput = { ...MINIMAL_INPUT, skills };
      const card = generateAgentCard(input);
      expect(card.skills).toHaveLength(2);
      expect(card.skills[0]?.id).toBe('a');
      expect(card.skills[1]?.id).toBe('b');
    });
  });

  // ============================================================
  // IR-5: URL FROM deploy.port
  // ============================================================

  describe('url derivation [IR-5]', () => {
    it('sets url from deploy.port when present [IR-5]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        deploy: { port: 4000, healthPath: '/health' },
      };
      const card = generateAgentCard(input);
      expect(card.url).toBe('http://localhost:4000');
    });

    it('sets url to empty string when deploy is absent [IR-5]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.url).toBe('');
    });

    it('sets url to empty string when deploy.port is absent [IR-5]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        deploy: { healthPath: '/health' },
      };
      const card = generateAgentCard(input);
      expect(card.url).toBe('');
    });

    it('interpolates port correctly for port 3000 [IR-5]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        deploy: { port: 3000, healthPath: '/health' },
      };
      const card = generateAgentCard(input);
      expect(card.url).toBe('http://localhost:3000');
    });
  });

  // ============================================================
  // NAME AND VERSION [AC-6]
  // ============================================================

  describe('name and version [AC-6]', () => {
    it('reflects name from AgentCardInput [AC-6]', () => {
      const input: AgentCardInput = { ...MINIMAL_INPUT, name: 'my-agent' };
      const card = generateAgentCard(input);
      expect(card.name).toBe('my-agent');
    });

    it('reflects version from AgentCardInput [AC-6]', () => {
      const input: AgentCardInput = { ...MINIMAL_INPUT, version: '2.5.1' };
      const card = generateAgentCard(input);
      expect(card.version).toBe('2.5.1');
    });
  });

  // ============================================================
  // AC-15: DESCRIPTION FROM HANDLER INTROSPECTION
  // ============================================================

  describe('description from AgentCardInput [AC-15]', () => {
    it('reflects description when present [AC-15]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        description: 'An introspected agent',
      };
      const card = generateAgentCard(input);
      expect(card.description).toBe('An introspected agent');
    });

    it('sets description to empty string when absent [AC-15]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.description).toBe('');
    });
  });

  // ============================================================
  // DEFAULT MODES
  // ============================================================

  describe('default input and output modes', () => {
    it('equals ["application/json"] for defaultInputModes', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.defaultInputModes).toEqual(['application/json']);
    });

    it('equals ["application/json"] for defaultOutputModes', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(card.defaultOutputModes).toEqual(['application/json']);
    });
  });

  // ============================================================
  // AC-15: INPUT / OUTPUT FROM HANDLER INTROSPECTION
  // ============================================================

  describe('input and output from handler introspection [AC-15]', () => {
    it('includes input field from AgentCardInput [AC-15]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        input: {
          query: { type: 'string', required: true },
          limit: { type: 'number' },
        },
      };
      const card = generateAgentCard(input);
      expect(card).toHaveProperty('input');
      expect(card.input?.['query']?.type).toBe('string');
      expect(card.input?.['limit']?.type).toBe('number');
    });

    it('includes output field from AgentCardInput [AC-15]', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        output: { type: 'dict', description: 'Result' },
      };
      const card = generateAgentCard(input);
      expect(card).toHaveProperty('output');
      expect(card.output?.type).toBe('dict');
    });

    it('omits input key entirely when AgentCardInput has no input [AC-15]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(Object.prototype.hasOwnProperty.call(card, 'input')).toBe(false);
    });

    it('omits output key entirely when AgentCardInput has no output [AC-15]', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      expect(Object.prototype.hasOwnProperty.call(card, 'output')).toBe(false);
    });

    it('does not throw for input only', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        input: { q: { type: 'string' } },
      };
      expect(() => generateAgentCard(input)).not.toThrow();
    });

    it('does not throw for output only', () => {
      const input: AgentCardInput = {
        ...MINIMAL_INPUT,
        output: { type: 'list' },
      };
      expect(() => generateAgentCard(input)).not.toThrow();
    });
  });

  // ============================================================
  // CARD SHAPE
  // ============================================================

  describe('card shape', () => {
    it('contains only the base A2A fields when no input/output provided', () => {
      const card = generateAgentCard(MINIMAL_INPUT);
      const keys = Object.keys(card).sort();
      expect(keys).toEqual([
        'capabilities',
        'defaultInputModes',
        'defaultOutputModes',
        'description',
        'name',
        'runtimeVariables',
        'skills',
        'url',
        'version',
      ]);
    });
  });
});
