import { parseGameTestContract, type GameAction, type GameAssertion } from '@/lib/runtime/game-contract';

/**
 * Versioned, strict Game Design Document. All automated acceptance cases are
 * executable test contracts, not free-form model instructions.
 */
export type GameGenre = 'snake' | 'tetris' | 'breakout' | '2048';

export interface GameMechanic {
  id: string;
  description: string;
  skill: string;
}
export interface GameControl {
  event: string;
  key: string;
}
export interface GameTransition {
  from: string;
  to: string;
  on: string;
}
export interface GameAcceptance {
  id: string;
  title: string;
  mechanic: string;
  mode: 'automated' | 'manual';
  actions?: GameAction[];
  assertions?: GameAssertion[];
  rationale?: string;
}
export interface GameDesignDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  genre: GameGenre;
  templateVersion: string;
  seed: number;
  viewport: { width: number; height: number };
  mechanics: GameMechanic[];
  controls: GameControl[];
  stateMachine: {
    initial: string;
    states: string[];
    transitions: GameTransition[];
  };
  acceptance: GameAcceptance[];
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(where + ' must be an object');
  }
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(where + ': unsupported field ' + key);
  }
}
function array(value: unknown, min: number, max: number, where: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(where + ' requires ' + min + '-' + max + ' entries');
  }
  return value;
}
function ident(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(where + ' must be an identifier');
  }
  return value;
}
function label(value: unknown, where: string, max = 80): string {
  if (typeof value !== 'string' || value.trim().length === 0 ||
      value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(where + ' must be nonempty printable text (max ' + max + ')');
  }
  return value;
}
function distinct(items: string[], where: string): void {
  if (new Set(items).size !== items.length) throw new Error(where + ' must be unique');
}
function required<U extends string>(value: unknown, allowed: readonly U[], where: string): U {
  if (typeof value !== 'string' || !allowed.includes(value as U)) {
    throw new Error(where + ' must be one of ' + allowed.join(', '));
  }
  return value as U;
}

export function parseGameDesignDocument(raw: unknown): GameDesignDocument {
  const doc = record(raw, 'GDD');
  keys(doc, ['schemaVersion','id','title','genre','templateVersion','seed','viewport',
    'mechanics','controls','stateMachine','acceptance'], 'GDD');
  if (doc.schemaVersion !== 1) throw new Error('Unsupported GDD schemaVersion');
  const id = ident(doc.id, 'id');
  const title = label(doc.title, 'title');
  const genre = required(doc.genre, ['snake','tetris','breakout','2048'], 'genre');
  const templateVersion = required(doc.templateVersion, ['1.0.0'], 'templateVersion');

  const mechanics = array(doc.mechanics, 1, 16, 'mechanics').map((item, i) => {
    const p = 'mechanics[' + i + ']';
    const m = record(item, p);
    keys(m, ['id', 'description', 'skill'], p);
    return { id: ident(m.id, p + '.id'), description: label(m.description, p + '.description', 300),
      skill: ident(m.skill, p + '.skill') };
  });
  distinct(mechanics.map(m => m.id), 'mechanic ids');

  const controls = array(doc.controls, 1, 12, 'controls').map((item, i) => {
    const p = 'controls[' + i + ']';
    const c = record(item, p);
    keys(c, ['event', 'key'], p);
    const event = ident(c.event, p + '.event');
    if (typeof c.key !== 'string' ||
      !/^(Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|[a-zA-Z0-9])$/.test(c.key)) {
      throw new Error(p + '.key unsupported by quality runner');
    }
    return { event, key: c.key };
  });
  distinct(controls.map(c => c.event), 'control events');

  const stateMachine = record(doc.stateMachine, 'stateMachine');
  keys(stateMachine, ['initial', 'states', 'transitions'], 'stateMachine');
  const states = array(stateMachine.states, 1, 16, 'states')
    .map((item, i) => ident(item, 'states[' + i + ']'));
  distinct(states, 'states');
  const initial = ident(stateMachine.initial, 'stateMachine.initial');
  if (!states.includes(initial)) throw new Error('Initial state must be declared');
  const transitions = array(stateMachine.transitions, 0, 32, 'transitions').map((item, i) => {
    const p = 'transitions[' + i + ']';
    const t = record(item, p);
    keys(t, ['from', 'to', 'on'], p);
    const from = ident(t.from, p + '.from'), to = ident(t.to, p + '.to'),
      on = ident(t.on, p + '.on');
    if (!states.includes(from) || !states.includes(to)) {
      throw new Error('Transition must reference declared states: ' + p);
    }
    // System events like tick/goal/collision remain distinct from player controls.
    if (!controls.some(c => c.event === on) &&
        !['tick','collision','goal','timeout','restart','gameover'].includes(on)) {
      throw new Error(p + ' references unknown event ' + on);
    }
    return { from, to, on };
  });
  distinct(transitions.map(t => t.from + ':' + t.on), 'state transition (from,event)');

  const acceptance = array(doc.acceptance, 1, 16, 'acceptance').map((item, i) => {
    const p = 'acceptance[' + i + ']';
    const r = record(item, p);
    keys(r, ['id', 'title', 'mechanic', 'mode', 'actions', 'assertions', 'rationale'], p);
    const result: GameAcceptance = {
      id: ident(r.id, p + '.id'), title: label(r.title, p + '.title'),
      mechanic: ident(r.mechanic, p + '.mechanic'),
      mode: required(r.mode, ['automated','manual'], p + '.mode'),
    };
    if (!mechanics.some(m => m.id === result.mechanic)) {
      throw new Error(p + ' references unknown mechanic ' + result.mechanic);
    }
    if (result.mode === 'automated') {
      if (r.rationale !== undefined) throw new Error(p + ' automated rules do not take rationale');
      // The quality runner is the source of truth for accepted actions/assertions.
      const c = parseGameTestContract({
        schemaVersion: 1, name: title, seed: doc.seed, viewport: doc.viewport,
        scenarios: [{ id: result.id, name: result.title,
          actions: r.actions, assertions: r.assertions }],
      });
      result.actions = c.scenarios[0].actions;
      result.assertions = c.scenarios[0].assertions;
    } else {
      if (r.actions !== undefined || r.assertions !== undefined) {
        throw new Error(p + ' manual requirements cannot claim automated assertions');
      }
      result.rationale = label(r.rationale, p + '.rationale', 300);
    }
    return result;
  });
  distinct(acceptance.map(r => r.id), 'acceptance ids');
  const automated = acceptance.filter(r => r.mode === 'automated');
  if (automated.length > 8 ||
      automated.reduce((total, r) => total + r.actions!.length, 0) > 100) {
    throw new Error('GDD exceeds executable contract budget (8 scenarios, 100 actions)');
  }

  // Validate viewport and seed even for fully manual GDDs, using runner schema.
  const stub = { type: 'no-errors' };
  parseGameTestContract({ schemaVersion: 1, name: title, seed: doc.seed,
    viewport: doc.viewport,
    scenarios: [{ id: 'probe', name: 'probe', actions: [{ type: 'wait', ms: 0 }],
      assertions: [stub] }] });

  return {
    schemaVersion: 1, id, title, genre, templateVersion, seed: doc.seed as number,
    viewport: { width: (doc.viewport as { width: number }).width,
      height: (doc.viewport as { height: number }).height },
    mechanics, controls, stateMachine: { initial, states, transitions }, acceptance,
  };
}

/**
 * Reachability is an explicit review warning, not an inference that untraversed
 * states are incorrect: hidden endstates are sometimes intentionally unreachable.
 */
export function inspectGameStateMachine(doc: GameDesignDocument): string[] {
  const seen = new Set<string>([doc.stateMachine.initial]);
  let modified = true;
  while (modified) {
    modified = false;
    for (const t of doc.stateMachine.transitions) {
      if (seen.has(t.from) && !seen.has(t.to)) { seen.add(t.to); modified = true; }
    }
  }
  return doc.stateMachine.states.filter(s => !seen.has(s))
    .map(s => 'State "' + s + '" is unreachable from "' + doc.stateMachine.initial + '"');
}
