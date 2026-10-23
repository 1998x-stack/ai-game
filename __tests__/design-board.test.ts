import { describe, expect, it } from 'vitest';
import { applyBoardEdit, boardFromMechanics, emptyBoard, parseDesignBoard } from '@/lib/design-board/model';
import { editBoard, newBoardHistory, redoBoard, undoBoard } from '@/lib/design-board/history';

function sample() {
  return boardFromMechanics('Snake Classic', [
    { id: 'movement', description: 'Move on fixed grid' },
    { id: 'collision', description: 'End when colliding' },
  ]);
}

describe('file-native design board model', () => {
  it('preserves stable GDD reference ids through serialization and edits', () => {
    const board = sample();
    expect(board.nodes.map(n => n.id)).toEqual(['mechanic_movement', 'mechanic_collision']);
    expect(board.nodes.map(n => n.reference)).toEqual(['movement', 'collision']);
    const restored = parseDesignBoard(JSON.parse(JSON.stringify(board)));
    expect(restored).toEqual(board);
    const moved = applyBoardEdit(board, { type: 'update-node', id: board.nodes[0].id,
      patch: { x: 550, y: 120 } });
    expect(moved.nodes[0].id).toBe(board.nodes[0].id);
    expect(moved.nodes[0].reference).toBe('movement');
    expect(board.nodes[0].x).not.toBe(moved.nodes[0].x);
  });
  it('undoes node creation, moving, linking and node removal without losing identities', () => {
    const base = newBoardHistory(sample());
    const other = { id: 'scene_intro', kind: 'scene' as const, title: 'Intro', description: '',
      x: 100, y: 400, width: 200, height: 100 };
    const added = editBoard(base, { type: 'add-node', node: other });
    const connected = editBoard(added, { type: 'add-edge', edge: {
      id: 'edge_intro', from: 'scene_intro', to: 'mechanic_movement', label: 'starts',
    } });
    const removed = editBoard(connected, { type: 'remove-node', id: 'scene_intro' });
    expect(removed.present.nodes.some(n => n.id === other.id)).toBe(false);
    expect(removed.present.edges).toHaveLength(0);
    expect(undoBoard(removed).present.edges[0].id).toBe('edge_intro');
    expect(redoBoard(undoBoard(removed)).present).toEqual(removed.present);
    expect(undoBoard(base)).toEqual(base);
  });
  it('future is cleared when a new edit follows undo', () => {
    const h = newBoardHistory(sample());
    const changed = editBoard(h, { type: 'rename-board', title: 'New Title' });
    const afterUndo = undoBoard(changed);
    expect(afterUndo.future).toHaveLength(1);
    const fork = editBoard(afterUndo, { type: 'rename-board', title: 'Different Title' });
    expect(fork.future).toHaveLength(0);
    expect(redoBoard(fork)).toEqual(fork);
  });
  it('bounds snapshots and rejects untrusted scripts, URLs and invalid geometry', () => {
    const board = sample();
    expect(() => parseDesignBoard({ ...board, onLoad: 'alert(1)' })).toThrow('unexpected field');
    expect(() => parseDesignBoard({ ...board, nodes: [...board.nodes, board.nodes[0]] })).toThrow('Duplicate');
    expect(() => parseDesignBoard({ ...board, nodes: [{ ...board.nodes[0], x: Infinity }] })).toThrow('finite');
    expect(() => parseDesignBoard({ ...board, nodes: [{ ...board.nodes[0], title: '<iframe>' }] })).not.toThrow();
    expect(() => parseDesignBoard({ ...board, nodes: [{ ...board.nodes[0], reference: 'http://unsafe' }] })).toThrow('identifier');
    expect(() => parseDesignBoard({ ...board, nodes: [{ ...board.nodes[0], id: '../evil' }] })).toThrow('identifier');
    expect(() => parseDesignBoard({ ...board, nodes: Array.from({ length: 65 }, () => board.nodes[0]) })).toThrow('Max 64');
  });
  it('refuses dangling connections and unsafe asset paths', () => {
    const board = sample();
    expect(() => applyBoardEdit(board, { type: 'add-edge', edge: {
      id: 'edge_invalid', from: board.nodes[0].id, to: 'does_not_exist', label: '',
    } })).toThrow('dangling');
    expect(() => applyBoardEdit(board, { type: 'add-node', node: {
      id: 'asset_one', kind: 'asset', title: 'Artwork', description: '', x: 0, y: 0,
      width: 200, height: 100, reference: 'assets/../outside',
    } })).toThrow('asset reference');
    expect(emptyBoard().schemaVersion).toBe(1);
  });
});
