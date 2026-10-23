import { applyBoardEdit, type BoardEdit, type DesignBoard } from './model';

export interface BoardHistory {
  past: DesignBoard[];
  present: DesignBoard;
  future: DesignBoard[];
}
export function newBoardHistory(board: DesignBoard): BoardHistory {
  return { past: [], present: board, future: [] };
}
export function editBoard(history: BoardHistory, edit: BoardEdit): BoardHistory {
  const updated = applyBoardEdit(history.present, edit);
  if (JSON.stringify(updated) === JSON.stringify(history.present)) return history;
  return { past: [...history.past.slice(-49), history.present], present: updated, future: [] };
}
export function undoBoard(history: BoardHistory): BoardHistory {
  if (history.past.length === 0) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1],
    future: [history.present, ...history.future].slice(0, 50) };
}
export function redoBoard(history: BoardHistory): BoardHistory {
  if (history.future.length === 0) return history;
  return { past: [...history.past.slice(-49), history.present],
    present: history.future[0], future: history.future.slice(1) };
}
