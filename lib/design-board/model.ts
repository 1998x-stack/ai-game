/**
 * File-native board format. Stable IDs are never tied to array indexes or UI state.
 * Canvas geometry is declarative; no executable scripts, external URLs or HTML.
 */
export type BoardNodeKind = 'scene' | 'mechanic' | 'note' | 'asset';
export interface BoardNode {
  id: string;
  kind: BoardNodeKind;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  reference?: string;
}
export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}
export interface DesignBoard {
  schemaVersion: 1;
  title: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
}
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const ASSET_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
function plain(value: unknown, at: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(at + ' must be an object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], at: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(at + ': unexpected field ' + key);
  }
}
function id(value: unknown, at: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(at + ' must be an identifier');
  return value;
}
function label(value: unknown, at: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error(at + ' requires printable text');
  return value;
}
function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length > 1200 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
    throw new Error(at + ' must be <=1200 safe characters');
  }
  return value;
}
function size(value: unknown, at: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      Math.round(value * 10) !== value * 10) {
    throw new Error(at + ' must be a finite tenth-pixel coordinate between ' + min + ' and ' + max);
  }
  return value;
}
export function parseDesignBoard(raw: unknown): DesignBoard {
  const board = plain(raw, 'board');
  keys(board, ['schemaVersion', 'title', 'nodes', 'edges'], 'board');
  if (board.schemaVersion !== 1) throw new Error('Unsupported board schemaVersion');
  if (!Array.isArray(board.nodes) || board.nodes.length > 64) throw new Error('Max 64 board nodes');
  if (!Array.isArray(board.edges) || board.edges.length > 128) throw new Error('Max 128 board edges');
  const nodes: BoardNode[] = board.nodes.map((value: unknown, index: number) => {
    const at = 'nodes[' + index + ']';
    const node = plain(value, at);
    keys(node, ['id', 'kind', 'title', 'description', 'x', 'y', 'width', 'height', 'reference'], at);
    if (!['scene', 'mechanic', 'note', 'asset'].includes(String(node.kind))) {
      throw new Error(at + ': unsupported kind');
    }
    const kind = node.kind as BoardNodeKind;
    let reference: string | undefined;
    if (node.reference !== undefined) {
      reference = kind === 'asset' ?
        (typeof node.reference === 'string' && ASSET_RE.test(node.reference)
          ? node.reference : (() => { throw new Error(at + ': invalid asset reference'); })()) :
        id(node.reference, at + '.reference');
    }
    return {
      id: id(node.id, at + '.id'), kind,
      title: label(node.title, at + '.title', 100),
      description: text(node.description, at + '.description'),
      x: size(node.x, at + '.x', -2000, 10000),
      y: size(node.y, at + '.y', -2000, 10000),
      width: size(node.width, at + '.width', 100, 800),
      height: size(node.height, at + '.height', 60, 500),
      ...(reference === undefined ? {} : { reference }),
    };
  });
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length) throw new Error('Duplicate node IDs');
  const edges: BoardEdge[] = board.edges.map((value: unknown, index: number) => {
    const at = 'edges[' + index + ']';
    const edge = plain(value, at);
    keys(edge, ['id', 'from', 'to', 'label'], at);
    const from = id(edge.from, at + '.from');
    const to = id(edge.to, at + '.to');
    if (from === to || !ids.has(from) || !ids.has(to)) throw new Error(at + ': dangling or self-loop edge');
    return { id: id(edge.id, at + '.id'), from, to, label: text(edge.label, at + '.label').slice(0, 120) };
  });
  if (new Set(edges.map(edge => edge.id)).size !== edges.length) throw new Error('Duplicate edge IDs');
  return { schemaVersion: 1, title: label(board.title, 'title', 100), nodes, edges };
}

export function emptyBoard(title = 'Game Design'): DesignBoard {
  return { schemaVersion: 1, title, nodes: [], edges: [] };
}
/** Imported GDD nodes link to immutable GDD mechanic IDs, not array positions. */
export function boardFromMechanics(title: string, mechanics: Array<{ id: string; description: string }>): DesignBoard {
  return parseDesignBoard({
    schemaVersion: 1, title, edges: [], nodes: mechanics.slice(0, 16).map((item, index) => ({
      id: 'mechanic_' + item.id,
      kind: 'mechanic', title: item.id,
      description: item.description.slice(0, 1200),
      reference: item.id,
      x: 50 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 170,
      width: 220, height: 120,
    })),
  });
}

export type BoardEdit =
  | { type: 'add-node'; node: BoardNode }
  | { type: 'update-node'; id: string; patch: Partial<Pick<BoardNode, 'title' | 'description' | 'x' | 'y' | 'width' | 'height'>> }
  | { type: 'remove-node'; id: string }
  | { type: 'add-edge'; edge: BoardEdge }
  | { type: 'remove-edge'; id: string }
  | { type: 'rename-board'; title: string };

export function applyBoardEdit(board: DesignBoard, edit: BoardEdit): DesignBoard {
  let next: DesignBoard;
  switch (edit.type) {
    case 'add-node':
      next = { ...board, nodes: [...board.nodes, edit.node] }; break;
    case 'update-node':
      next = { ...board, nodes: board.nodes.map(n => n.id === edit.id ? { ...n, ...edit.patch, id: n.id, kind: n.kind, reference: n.reference } : n) }; break;
    case 'remove-node':
      next = { ...board, nodes: board.nodes.filter(n => n.id !== edit.id),
        edges: board.edges.filter(e => e.from !== edit.id && e.to !== edit.id) }; break;
    case 'add-edge':
      next = { ...board, edges: [...board.edges, edit.edge] }; break;
    case 'remove-edge':
      next = { ...board, edges: board.edges.filter(e => e.id !== edit.id) }; break;
    case 'rename-board':
      next = { ...board, title: edit.title }; break;
  }
  return parseDesignBoard(next);
}
