import { describe, it, expect } from 'vitest';
import {
  interpolateEnv,
  interpolateConfigDeep,
  validateDeferredScope,
} from '../src/interpolate.js';

describe('interpolateEnv', () => {
  describe('resolved variables', () => {
    it('replaces a single variable with its value', () => {
      const result = interpolateEnv('key=${VAR}', { VAR: 'val' });
      expect(result).toEqual({ value: 'key=val', unresolved: [], deferred: [] });
    });

    it('replaces multiple resolved variables', () => {
      const result = interpolateEnv('${A}-${B}', { A: 'foo', B: 'bar' });
      expect(result).toEqual({ value: 'foo-bar', unresolved: [], deferred: [] });
    });

    it('resolves empty string as a valid value [AC-27]', () => {
      const result = interpolateEnv('${VAR}', { VAR: '' });
      expect(result).toEqual({ value: '', unresolved: [], deferred: [] });
    });
  });

  describe('unresolved variables', () => {
    it('preserves unresolved variable in output and adds name to unresolved [AC-22]', () => {
      const result = interpolateEnv('${MISSING}', {});
      expect(result).toEqual({ value: '${MISSING}', unresolved: ['MISSING'], deferred: [] });
    });

    it('resolves known vars and preserves unknown vars in the same string', () => {
      const result = interpolateEnv('${KNOWN}-${UNKNOWN}', { KNOWN: 'yes' });
      expect(result).toEqual({
        value: 'yes-${UNKNOWN}',
        unresolved: ['UNKNOWN'],
        deferred: [],
      });
    });
  });

  describe('no variables', () => {
    it('returns the original string unchanged when no placeholders exist', () => {
      const result = interpolateEnv('hello', {});
      expect(result).toEqual({ value: 'hello', unresolved: [], deferred: [] });
    });
  });

  describe('IDENTIFIER pattern enforcement', () => {
    it('does not replace lowercase identifiers', () => {
      const result = interpolateEnv('${lowercase}', { lowercase: 'nope' });
      expect(result).toEqual({ value: '${lowercase}', unresolved: [], deferred: [] });
    });

    it('does not replace mixed-case identifiers', () => {
      const result = interpolateEnv('${MixedCase}', { MixedCase: 'nope' });
      expect(result).toEqual({ value: '${MixedCase}', unresolved: [], deferred: [] });
    });

    it('replaces identifiers starting with underscore', () => {
      const result = interpolateEnv('${_VAR}', { _VAR: 'ok' });
      expect(result).toEqual({ value: 'ok', unresolved: [], deferred: [] });
    });
  });

  describe('nested interpolation', () => {
    it('treats nested ${${VAR}} as a literal without replacement', () => {
      const result = interpolateEnv('${${VAR}}', { VAR: 'INNER' });
      expect(result).toEqual({ value: '${${VAR}}', unresolved: [], deferred: [] });
    });
  });

  describe('deferred @{VAR} patterns [IR-1]', () => {
    it('preserves @{VAR} literally in output and collects name in deferred', () => {
      const result = interpolateEnv('@{SECRET}', {});
      expect(result).toEqual({ value: '@{SECRET}', unresolved: [], deferred: ['SECRET'] });
    });

    it('collects multiple @{VAR} names in deferred', () => {
      const result = interpolateEnv('@{FOO}-@{BAR}', {});
      expect(result).toEqual({
        value: '@{FOO}-@{BAR}',
        unresolved: [],
        deferred: ['FOO', 'BAR'],
      });
    });

    it('does not collect lowercase @{var} in deferred', () => {
      const result = interpolateEnv('@{lower}', {});
      expect(result).toEqual({ value: '@{lower}', unresolved: [], deferred: [] });
    });

    it('does not resolve @{VAR} from env even if key matches', () => {
      const result = interpolateEnv('@{SECRET}', { SECRET: 'should-not-resolve' });
      expect(result).toEqual({ value: '@{SECRET}', unresolved: [], deferred: ['SECRET'] });
    });

    it('mixes ${VAR} static resolve with @{VAR} deferred preserve [AC-35]', () => {
      const result = interpolateEnv('host=${HOST} token=@{TOKEN}', { HOST: 'localhost' });
      expect(result).toEqual({
        value: 'host=localhost token=@{TOKEN}',
        unresolved: [],
        deferred: ['TOKEN'],
      });
    });

    it('only ${VAR} present: deferred is empty [AC-46]', () => {
      const result = interpolateEnv('host=${HOST}', { HOST: 'localhost' });
      expect(result).toEqual({ value: 'host=localhost', unresolved: [], deferred: [] });
    });
  });
});

describe('interpolateConfigDeep', () => {
  describe('string value substitution [IR-5]', () => {
    it('replaces ${VAR} in string values across all sections', () => {
      const config = { db: { host: '${DB_HOST}', port: '5432' } };
      const env = { DB_HOST: 'localhost' };
      const { resolved } = interpolateConfigDeep(config, env);
      expect(resolved).toEqual({ db: { host: 'localhost', port: '5432' } });
    });

    it('replaces ${VAR} in multiple sections', () => {
      const config = {
        db: { url: '${DB_URL}' },
        cache: { url: '${CACHE_URL}' },
      };
      const env = { DB_URL: 'postgres://db', CACHE_URL: 'redis://cache' };
      const { resolved } = interpolateConfigDeep(config, env);
      expect(resolved).toEqual({
        db: { url: 'postgres://db' },
        cache: { url: 'redis://cache' },
      });
    });
  });

  describe('unset variable retention [IR-5/AC-20]', () => {
    it('retains literal ${VAR} when variable is not in env', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const { resolved } = interpolateConfigDeep(config, {});
      expect(resolved).toEqual({ app: { name: '${APP_NAME}' } });
    });

    it('retains literal ${VAR} when env value is undefined', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const { resolved } = interpolateConfigDeep(config, { APP_NAME: undefined });
      expect(resolved).toEqual({ app: { name: '${APP_NAME}' } });
    });
  });

  describe('non-string value passthrough [IR-5]', () => {
    it('passes through number values unchanged', () => {
      const config = { server: { port: 8080 } } as Record<
        string,
        Record<string, unknown>
      >;
      const { resolved } = interpolateConfigDeep(config, {});
      expect(resolved).toEqual({ server: { port: 8080 } });
    });

    it('passes through boolean values unchanged', () => {
      const config = { feature: { enabled: true } } as Record<
        string,
        Record<string, unknown>
      >;
      const { resolved } = interpolateConfigDeep(config, {});
      expect(resolved).toEqual({ feature: { enabled: true } });
    });

    it('passes through null values unchanged', () => {
      const config = { section: { key: null } } as Record<
        string,
        Record<string, unknown>
      >;
      const { resolved } = interpolateConfigDeep(config, {});
      expect(resolved).toEqual({ section: { key: null } });
    });
  });

  describe('immutability', () => {
    it('returns a new object without mutating the original config', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const env = { APP_NAME: 'myapp' };
      const { resolved } = interpolateConfigDeep(config, env);
      expect(resolved).not.toBe(config);
      expect(resolved.app).not.toBe(config.app);
      expect(config.app.name).toBe('${APP_NAME}');
    });
  });

  describe('empty config', () => {
    it('returns an empty object for an empty config', () => {
      const { resolved } = interpolateConfigDeep({}, {});
      expect(resolved).toEqual({});
    });
  });

  describe('deferredKeys [IR-2]', () => {
    it('returns empty deferredKeys when no @{VAR} present', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const { deferredKeys } = interpolateConfigDeep(config, { APP_NAME: 'myapp' });
      expect(deferredKeys.size).toBe(0);
    });

    it('records deferredKeys entry for a value containing @{VAR}', () => {
      const config = { extensions: { token: '@{API_TOKEN}' } };
      const { resolved, deferredKeys } = interpolateConfigDeep(config, {});
      expect(resolved).toEqual({ extensions: { token: '@{API_TOKEN}' } });
      expect(deferredKeys.get('extensions.token')).toEqual(['API_TOKEN']);
    });

    it('records multiple @{VAR} names for a single value', () => {
      const config = { extensions: { combo: '@{FOO}-@{BAR}' } };
      const { deferredKeys } = interpolateConfigDeep(config, {});
      expect(deferredKeys.get('extensions.combo')).toEqual(['FOO', 'BAR']);
    });

    it('records deferredKeys across multiple sections', () => {
      const config = {
        extensions: { token: '@{TOKEN}' },
        context: { val: '@{CTX_VAL}' },
      };
      const { deferredKeys } = interpolateConfigDeep(config, {});
      expect(deferredKeys.get('extensions.token')).toEqual(['TOKEN']);
      expect(deferredKeys.get('context.val')).toEqual(['CTX_VAL']);
    });

    it('mixed ${VAR} static and @{VAR} deferred in same config [AC-35]', () => {
      const config = {
        db: { host: '${DB_HOST}' },
        extensions: { token: '@{API_TOKEN}' },
      };
      const env = { DB_HOST: 'localhost' };
      const { resolved, deferredKeys } = interpolateConfigDeep(config, env);
      expect(resolved.db).toEqual({ host: 'localhost' });
      expect(resolved.extensions).toEqual({ token: '@{API_TOKEN}' });
      expect(deferredKeys.get('extensions.token')).toEqual(['API_TOKEN']);
      expect(deferredKeys.has('db.host')).toBe(false);
    });
  });
});

describe('validateDeferredScope', () => {
  describe('allowed sections [IR-4]', () => {
    it('returns empty array when @{VAR} appears only in extensions.config', () => {
      const config = { extensions: { config: { token: '@{API_TOKEN}' } } };
      expect(validateDeferredScope(config)).toEqual([]);
    });

    it('returns empty array when @{VAR} appears only in context.values', () => {
      const config = { context: { values: { key: '@{CTX_VAL}' } } };
      expect(validateDeferredScope(config)).toEqual([]);
    });

    it('returns empty array when no @{VAR} patterns exist at all', () => {
      const config = { host: { port: '8080' }, db: { url: 'localhost' } };
      expect(validateDeferredScope(config)).toEqual([]);
    });

    it('returns empty array when both allowed sections have @{VAR}', () => {
      const config = {
        extensions: { config: { token: '@{TOKEN}' } },
        context: { values: { id: '@{ID}' } },
      };
      expect(validateDeferredScope(config)).toEqual([]);
    });
  });

  describe('violations [IR-4, AC-8, AC-34]', () => {
    it('returns path for @{VAR} in host block [AC-8]', () => {
      const config = { host: { apiKey: '@{SECRET}' } };
      const violations = validateDeferredScope(config);
      expect(violations).toContain('host.apiKey');
    });

    it('returns path for @{VAR} in modules block [AC-34]', () => {
      const config = { modules: { entry: '@{MODULE_PATH}' } };
      const violations = validateDeferredScope(config);
      expect(violations).toContain('modules.entry');
    });

    it('returns multiple violation paths when @{VAR} in multiple disallowed locations', () => {
      const config = {
        host: { apiKey: '@{SECRET}' },
        modules: { entry: '@{PATH}' },
      };
      const violations = validateDeferredScope(config);
      expect(violations).toContain('host.apiKey');
      expect(violations).toContain('modules.entry');
    });

    it('returns violation and no error for allowed section in the same config', () => {
      const config = {
        host: { apiKey: '@{SECRET}' },
        extensions: { config: { token: '@{TOKEN}' } },
      };
      const violations = validateDeferredScope(config);
      expect(violations).toContain('host.apiKey');
      expect(violations).not.toContain('extensions.config.token');
    });
  });
});
