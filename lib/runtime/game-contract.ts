/**
 * Declarative playtest contract. No scripts, expressions, selectors or URLs
 * may be supplied by the test file: only bounded, deterministic inputs.
 */
export type GameAction =
  | { type: 'key'; key: string; holdMs?: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'wait'; ms: number };

export type GameAssertion =
  | { type: 'canvas-size'; minWidth: number; minHeight: number }
  | { type: 'state-equals'; key: string; value: string | number | boolean }
  | { type: 'state-changed'; key: string }
  | { type: 'game-over'; expected: boolean }
  | { type: 'no-errors' };

export interface GameScenario {
  id: string;
  name: string;
  actions: GameAction[];
  assertions: GameAssertion[];
}

export interface GameTestContract {
  schemaVersion: 1;
  name: string;
  seed: number;
  viewport: { width: number; height: number };
  scenarios: GameScenario[];
  captureScreenshots?: boolean;
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(where + ' must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function onlyKeys(input: Record<string, unknown>, permitted: readonly string[], where: string): void {
  for (const key of Object.keys(input)) {
    if (!permitted.includes(key)) throw new Error(where + ': unsupported field ' + key);
  }
}

function name(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 ||
      /[\u0000-\u001f]/.test(value)) {
    throw new Error(where + ' must be 1-80 printable characters');
  }
  return value;
}

function identifier(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(where + ' must be an identifier (1-64 characters)');
  }
  return value;
}

function integer(value: unknown, min: number, max: number, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) ||
      value < min || value > max) {
    throw new Error(where + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

function boundedArray(value: unknown, min: number, max: number, where: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(where + ' must have ' + min + '-' + max + ' entries');
  }
  return value;
}

function action(raw: unknown, where: string): GameAction {
  const value = object(raw, where);
  switch (value.type) {
    case 'key': {
      onlyKeys(value, ['type', 'key', 'holdMs'], where);
      if (typeof value.key !== 'string' ||
          !/^(Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|[a-zA-Z0-9])$/.test(value.key)) {
        throw new Error(where + ': unsupported keyboard key');
      }
      return { type: 'key', key: value.key, ...(value.holdMs === undefined ? {} :
        { holdMs: integer(value.holdMs, 1, 3000, where + '.holdMs') }) };
    }
    case 'click':
      onlyKeys(value, ['type', 'x', 'y'], where);
      return {
        type: 'click',
        x: integer(value.x, 0, 4096, where + '.x'),
        y: integer(value.y, 0, 4096, where + '.y'),
      };
    case 'wait':
      onlyKeys(value, ['type', 'ms'], where);
      return { type: 'wait', ms: integer(value.ms, 0, 3000, where + '.ms') };
    default:
      throw new Error(where + ': unsupported action type');
  }
}

function assertion(raw: unknown, where: string): GameAssertion {
  const value = object(raw, where);
  switch (value.type) {
    case 'canvas-size':
      onlyKeys(value, ['type', 'minWidth', 'minHeight'], where);
      return {
        type: 'canvas-size',
        minWidth: integer(value.minWidth, 1, 4096, where + '.minWidth'),
        minHeight: integer(value.minHeight, 1, 4096, where + '.minHeight'),
      };
    case 'state-equals':
      onlyKeys(value, ['type', 'key', 'value'], where);
      if (!['string', 'number', 'boolean'].includes(typeof value.value) ||
          (typeof value.value === 'string' && value.value.length > 200) ||
          (typeof value.value === 'number' && !Number.isFinite(value.value))) {
        throw new Error(where + ': value must be a finite scalar');
      }
      return { type: 'state-equals', key: identifier(value.key, where + '.key'),
        value: value.value as string | number | boolean };
    case 'state-changed':
      onlyKeys(value, ['type', 'key'], where);
      return { type: 'state-changed', key: identifier(value.key, where + '.key') };
    case 'game-over':
      onlyKeys(value, ['type', 'expected'], where);
      if (typeof value.expected !== 'boolean') throw new Error(where + '.expected must be boolean');
      return { type: 'game-over', expected: value.expected };
    case 'no-errors':
      onlyKeys(value, ['type'], where);
      return { type: 'no-errors' };
    default:
      throw new Error(where + ': unsupported assertion type');
  }
}

export function parseGameTestContract(raw: unknown): GameTestContract {
  const input = object(raw, 'contract');
  onlyKeys(input, ['schemaVersion', 'name', 'seed', 'viewport', 'scenarios', 'captureScreenshots'], 'contract');
  if (input.schemaVersion !== 1) throw new Error('Unsupported game test schemaVersion');
  const viewport = object(input.viewport, 'viewport');
  onlyKeys(viewport, ['width', 'height'], 'viewport');
  const scenarios = boundedArray(input.scenarios, 1, 8, 'scenarios').map((rawScenario, index) => {
    const where = 'scenarios[' + index + ']';
    const value = object(rawScenario, where);
    onlyKeys(value, ['id', 'name', 'actions', 'assertions'], where);
    return {
      id: identifier(value.id, where + '.id'),
      name: name(value.name, where + '.name'),
      actions: boundedArray(value.actions, 1, 40, where + '.actions')
        .map((item, i) => action(item, where + '.actions[' + i + ']')),
      assertions: boundedArray(value.assertions, 1, 16, where + '.assertions')
        .map((item, i) => assertion(item, where + '.assertions[' + i + ']')),
    };
  });
  if (new Set(scenarios.map((s) => s.id)).size !== scenarios.length) {
    throw new Error('Duplicate scenario id');
  }
  if (scenarios.reduce((count, scenario) => count + scenario.actions.length, 0) > 100) {
    throw new Error('Contract cannot exceed 100 actions');
  }
  if (input.captureScreenshots !== undefined && typeof input.captureScreenshots !== 'boolean') {
    throw new Error('captureScreenshots must be boolean');
  }
  return {
    schemaVersion: 1,
    name: name(input.name, 'name'),
    seed: integer(input.seed, 0, 4294967295, 'seed'),
    viewport: {
      width: integer(viewport.width, 320, 1920, 'viewport.width'),
      height: integer(viewport.height, 240, 1080, 'viewport.height'),
    },
    scenarios,
    ...(input.captureScreenshots === undefined ? {} : { captureScreenshots: input.captureScreenshots }),
  };
}
