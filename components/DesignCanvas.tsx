'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileCode2, GitBranch, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { editBoard, newBoardHistory, redoBoard, undoBoard, type BoardHistory } from '@/lib/design-board/history';
import { type BoardNode, type BoardNodeKind } from '@/lib/design-board/model';

interface WorkspaceBoardResponse {
  board: BoardHistory['present'];
  revision: string;
  mechanics: Array<{ id: string; title: string }>;
  assets: string[];
  codeDiff: string;
}
interface DragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

export default function DesignCanvas({ sessionId }: { sessionId: string }) {
  const [history, setHistory] = useState<BoardHistory | null>(null);
  const [remote, setRemote] = useState<WorkspaceBoardResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [view, setView] = useState<'board' | 'diff'>('board');
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const board = history?.present;
  const dirty = Boolean(board && remote && JSON.stringify(board) !== JSON.stringify(remote.board));

  const load = useCallback(async () => {
    if (!sessionId) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/design-board/' + sessionId, { signal: controller.signal, cache: 'no-store' });
      const data = await res.json() as WorkspaceBoardResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Unable to load design board');
      if (controller.signal.aborted) return;
      setHistory(newBoardHistory(data.board));
      setRemote(data);
      setConflict(false);
      setSelected(null);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Load failed');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  const commit = useCallback((change: Parameters<typeof editBoard>[1]) => {
    setHistory(previous => {
      if (!previous) return null;
      try {
        return editBoard(previous, change);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Invalid edit');
        return previous;
      }
    });
  }, []);

  const save = useCallback(async () => {
    if (!history || !remote || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await fetch('/api/design-board/' + sessionId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: history.present, revision: remote.revision }),
      });
      const saved = await result.json() as { board?: WorkspaceBoardResponse['board']; revision?: string; error?: string };
      if (result.status === 409) {
        setConflict(true);
        setMessage('Save conflict: this board changed in another tab or by an Agent. Reload only if you want to discard your edits.');
        return;
      }
      if (!result.ok || !saved.revision || !saved.board) throw new Error(saved.error || 'Save failed');
      // After a successful CAS, preserve a local edit made during the request.
      setRemote(previous => previous ? { ...previous, board: saved.board!, revision: saved.revision! } : previous);
      setConflict(false);
      setMessage('Saved to design.board.json');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }, [history, remote, busy, sessionId]);

  const addNode = (kind: BoardNodeKind) => {
    if (!board) return;
    const id = 'node_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const reference = kind === 'asset' ? remote?.assets[0] :
      kind === 'mechanic' ? remote?.mechanics[0]?.id : undefined;
    const node: BoardNode = {
      id, kind, title: kind === 'scene' ? 'New Scene' :
        kind === 'mechanic' ? 'New Mechanic' : kind === 'asset' ? 'Asset' : 'Note',
      description: '', x: 50 + (board.nodes.length % 3) * 260,
      y: 50 + Math.floor(board.nodes.length / 3) * 170, width: 220, height: 120,
      ...(reference ? { reference } : {}),
    };
    commit({ type: 'add-node', node });
    setSelected(id);
  };

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const d = drag.current;
    const x = Math.round(Math.max(-2000, Math.min(10000, d.originX + event.clientX - d.startX)) * 10) / 10;
    const y = Math.round(Math.max(-2000, Math.min(10000, d.originY + event.clientY - d.startY)) * 10) / 10;
    setDragging({ id: d.id, x, y });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const d = drag.current;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    const x = Math.round(Math.max(-2000, Math.min(10000, d.originX + dx)) * 10) / 10;
    const y = Math.round(Math.max(-2000, Math.min(10000, d.originY + dy)) * 10) / 10;
    drag.current = null;
    setDragging(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released already */ }
    if (x !== d.originX || y !== d.originY) {
      commit({ type: 'update-node', id: d.id, patch: { x, y } });
    }
  };
  const positions = (node: BoardNode) => dragging?.id === node.id ?
    { ...node, x: dragging.x, y: dragging.y } : node;
  const selectedNode = board?.nodes.find(node => node.id === selected) ?? null;

  return (
    <section className="flex flex-col h-full min-h-0 bg-[#101527] text-panel-text" aria-label="Game design canvas">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-panel-border shrink-0">
        <span className="font-semibold text-sm mr-auto">Design Studio</span>
        <button type="button" onClick={() => setView('board')} aria-pressed={view === 'board'}
          className={'px-2 py-1 rounded text-xs ' + (view === 'board' ? 'bg-panel-accent text-white' : 'bg-panel-bg')}>Canvas</button>
        <button type="button" onClick={() => setView('diff')} aria-pressed={view === 'diff'}
          className={'px-2 py-1 rounded text-xs flex items-center gap-1 ' + (view === 'diff' ? 'bg-panel-accent text-white' : 'bg-panel-bg')}>
          <FileCode2 size={13} /> Code diff</button>
        <button type="button" title="Undo" aria-label="Undo" disabled={!history?.past.length}
          onClick={() => setHistory(h => h ? undoBoard(h) : null)} className="px-2 py-1 disabled:opacity-30"><ArrowLeft size={16} /></button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!history?.future.length}
          onClick={() => setHistory(h => h ? redoBoard(h) : null)} className="px-2 py-1 disabled:opacity-30"><ArrowRight size={16} /></button>
        <button type="button" aria-label="Save board" onClick={() => void save()} disabled={!dirty || busy || conflict}
          className="px-2 py-1 bg-panel-accent rounded text-xs text-white flex items-center gap-1 disabled:opacity-40">
          <Save size={13} /> Save{dirty ? ' *' : ''}</button>
        <button type="button" aria-label="Reload board" onClick={() => void load()} disabled={busy}
          className="px-2 py-1 rounded text-xs bg-panel-bg flex items-center gap-1"><RefreshCw size={13} /> Reload</button>
      </header>
      {message && <div role="status" className={'px-3 py-2 text-xs border-b border-panel-border ' +
        (conflict ? 'text-amber-300' : 'text-panel-muted')}>{message}</div>}
      {view === 'diff' ? (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <p className="text-xs text-panel-muted mb-3">Uncommitted changes in scripts/game.js versus the workspace Git index.</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 bg-panel-bg p-4 rounded-lg">
            {remote?.codeDiff || '(no uncommitted game.js changes — reload to refresh)'}</pre>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <nav aria-label="Add board nodes" className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-panel-border">
              {(['scene','mechanic','note','asset'] as const).map(kind =>
                <button type="button" key={kind} onClick={() => addNode(kind)} disabled={!board}
                  className="px-2 py-1 rounded bg-panel-bg border border-panel-border text-xs hover:border-panel-accent disabled:opacity-30">
                  <Plus size={12} className="inline mr-1" />{kind}</button>)}
              <span className="text-[11px] text-panel-muted ml-auto">{board?.nodes.length ?? 0} nodes / {board?.edges.length ?? 0} links</span>
            </nav>
            <div className="flex-1 min-h-0 overflow-auto relative" aria-label="Draggable board">
              <div ref={canvas} className="relative w-[1220px] h-[860px] bg-[radial-gradient(#25314d_1px,transparent_1px)] [background-size:20px_20px]"
                onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setDragging(null); }}>
                <svg aria-hidden="true" className="absolute inset-0 pointer-events-none" width="1220" height="860">
                  {board?.edges.map(edge => {
                    const a = board.nodes.find(n => n.id === edge.from);
                    const b = board.nodes.find(n => n.id === edge.to);
                    if (!a || !b) return null;
                    const from = positions(a), to = positions(b);
                    return <g key={edge.id}>
                      <line x1={from.x + from.width / 2} y1={from.y + from.height / 2}
                        x2={to.x + to.width / 2} y2={to.y + to.height / 2}
                        stroke="#e94560" strokeOpacity=".65" strokeWidth="2" />
                    </g>;
                  })}
                </svg>
                {board?.nodes.map(node => {
                  const display = positions(node);
                  const chosen = node.id === selected;
                  return <button type="button" key={node.id}
                    data-node-id={node.id}
                    onClick={() => setSelected(node.id)}
                    onPointerDown={event => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      setSelected(node.id);
                      drag.current = { id: node.id, startX: event.clientX,
                        startY: event.clientY, originX: node.x, originY: node.y };
                      canvas.current?.setPointerCapture(event.pointerId);
                    }}
                    className={'absolute text-left rounded-lg shadow-lg p-3 border touch-none select-none cursor-grab active:cursor-grabbing ' +
                      (chosen ? 'border-panel-accent bg-[#29334c]' : 'border-[#36415c] bg-[#1d273d]')}
                    style={{ left: display.x, top: display.y, width: node.width, height: node.height }}>
                    <span className="block text-[10px] uppercase tracking-wider text-panel-muted">{node.kind}</span>
                    <strong className="block mt-1 text-sm truncate">{node.title}</strong>
                    <span className="block mt-1 text-xs text-panel-muted line-clamp-2">{node.description || node.reference || 'Click to inspect'}</span>
                  </button>;
                })}
              </div>
            </div>
          </div>
          <aside className="lg:w-[240px] lg:border-l border-t lg:border-t-0 border-panel-border overflow-auto p-3 shrink-0 max-h-[260px] lg:max-h-none" aria-label="Node inspector">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Inspector</h3>
              {selectedNode && <button type="button" title="Delete selected node" aria-label="Delete selected node"
                className="text-red-300 p-1" onClick={() => { commit({ type: 'remove-node', id: selectedNode.id }); setSelected(null); }}>
                <Trash2 size={15}/></button>}
            </div>
            {!selectedNode ? <p className="text-xs text-panel-muted">Select a node to edit its properties or connect it to another node.</p> : (
              <div className="flex flex-col gap-3 text-xs">
                <label className="flex flex-col gap-1">Title
                  <input key={selectedNode.id + ':title'} defaultValue={selectedNode.title} maxLength={100}
                    className="rounded bg-panel-bg border border-panel-border px-2 py-1"
                    onBlur={e => { if (e.target.value.trim()) commit({ type:'update-node',id:selectedNode.id,patch:{title:e.target.value} }); }} />
                </label>
                <label className="flex flex-col gap-1">Description
                  <textarea key={selectedNode.id + ':desc'} defaultValue={selectedNode.description} maxLength={1200} rows={4}
                    className="rounded bg-panel-bg border border-panel-border px-2 py-1"
                    onBlur={e => commit({type:'update-node',id:selectedNode.id,patch:{description:e.target.value}})} />
                </label>
                <p className="break-all text-panel-muted">Stable ID: {selectedNode.id}</p>
                {selectedNode.reference && <p className="break-all text-panel-muted">Source: {selectedNode.reference}</p>}
                <label className="flex flex-col gap-1">Connect to
                  <select aria-label="Connection target" value={linkTo} onChange={e => setLinkTo(e.target.value)}
                    className="rounded bg-panel-bg border border-panel-border px-2 py-1">
                    <option value="">Select target</option>
                    {board?.nodes.filter(n => n.id !== selectedNode.id).map(n =>
                      <option key={n.id} value={n.id}>{n.title} ({n.id.slice(-5)})</option>)}
                  </select>
                </label>
                <button type="button" disabled={!linkTo || !board?.nodes.some(n => n.id === linkTo && n.id !== selectedNode.id)}
                  onClick={() => { if (linkTo) commit({ type:'add-edge',edge:{
                    id:'edge_'+crypto.randomUUID().replace(/-/g,'').slice(0,20),
                    from:selectedNode.id,to:linkTo,label:'' } }); setLinkTo(''); }}
                  className="px-2 py-1 rounded bg-panel-accent text-white disabled:opacity-40 flex gap-1 items-center justify-center">
                  <GitBranch size={13}/> Add connection</button>
                {board?.edges.filter(edge => edge.from === selectedNode.id || edge.to === selectedNode.id).map(edge =>
                  <div key={edge.id} className="flex justify-between items-center gap-2">
                    <span className="truncate">{edge.from === selectedNode.id ? '→' : '←'} {board.nodes.find(n =>
                      n.id === (edge.from === selectedNode.id ? edge.to : edge.from))?.title}</span>
                    <button type="button" aria-label="Remove connection" title="Remove connection"
                      onClick={() => commit({type:'remove-edge',id:edge.id})}><Trash2 size={12}/></button>
                  </div>)}
              </div>)}
            <div className="mt-5 border-t border-panel-border pt-3">
              <p className="font-semibold text-xs mb-2">Referenced assets</p>
              {remote?.assets.length ? remote.assets.map(a => <div key={a} className="text-xs text-panel-muted break-all mb-1">{a}</div>)
                : <p className="text-xs text-panel-muted">No local assets yet.</p>}
            </div>
          </aside>
        </div>
      )}
      <footer className="shrink-0 px-3 py-1 text-[11px] text-panel-muted border-t border-panel-border">
        File-native board · explicit Save · undo/redo · {remote?.mechanics.length ?? 0} GDD mechanics · {busy ? 'Syncing…' : dirty ? 'Unsaved changes' : 'Saved'}
      </footer>
    </section>
  );
}
