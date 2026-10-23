'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlayCircle, RefreshCw, Square } from 'lucide-react';

interface JobReceipt {
  schemaVersion: 1;
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  isolated: boolean;
  createdAt: string;
  updatedAt: string;
  result?: 'passed' | 'failed' | 'incomplete';
  reportPath?: string;
  error?: string;
}
const active = (job: JobReceipt | null) => job?.status === 'queued' || job?.status === 'running';

export default function SandboxConsole({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<JobReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async (id: string) => {
    const response = await fetch('/api/sandbox-jobs/' + sessionId + '?id=' + encodeURIComponent(id),
      { cache: 'no-store' });
    const body = await response.json() as JobReceipt & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Unable to read sandbox job');
    setJob(body);
  }, [sessionId]);
  useEffect(() => {
    if (!job || !active(job)) return;
    const interval = window.setInterval(() => {
      void refresh(job.id).catch(error =>
        setMessage(error instanceof Error ? error.message : 'Status refresh failed'));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [job, refresh]);

  const submit = async () => {
    if (busy || active(job)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/sandbox-jobs/' + sessionId, { method: 'POST' });
      const body = await response.json() as JobReceipt & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Worker unavailable');
      setJob(body);
      setMessage('Isolated test queued. Game source and contract are loaded from existing workspace files.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start isolated test');
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!job || !active(job) || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/sandbox-jobs/' + sessionId + '?id=' + encodeURIComponent(job.id),
        { method: 'DELETE' });
      const body = await response.json() as JobReceipt & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Cancellation failed');
      setJob(body);
      setMessage('Cancellation requested. The container may still be shutting down.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cancellation failed');
    } finally { setBusy(false); }
  };
  return (
    <section aria-label="Isolated test console"
      className="flex flex-col flex-1 min-h-0 overflow-auto p-4 gap-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Isolated game playtests</h3>
        <p className="text-xs text-panel-muted max-w-xl">
          Runs the current compiled output/index.html against game.test.json in a
          dedicated, network-disabled Docker worker. Each job has limited CPU,
          memory and execution time. Only verified test reports return to this project.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" aria-label="Run isolated test" disabled={busy || active(job)}
          onClick={() => void submit()}
          className="bg-panel-accent text-white rounded px-3 py-2 text-xs flex items-center gap-2 disabled:opacity-40">
          <PlayCircle size={14}/> Run isolated test</button>
        <button type="button" aria-label="Cancel isolated test" disabled={busy || !active(job)}
          onClick={() => void cancel()}
          className="bg-panel-bg border border-panel-border rounded px-3 py-2 text-xs flex items-center gap-2 disabled:opacity-40">
          <Square size={14}/> Cancel</button>
        <button type="button" aria-label="Refresh isolated test status" disabled={busy || !job}
          onClick={() => { if (job) void refresh(job.id).catch(error => setMessage(String(error))); }}
          className="bg-panel-bg border border-panel-border rounded px-3 py-2 text-xs flex items-center gap-2 disabled:opacity-40">
          <RefreshCw size={14}/> Refresh status</button>
      </div>
      {message && <p role="status" className="text-xs text-panel-muted">{message}</p>}
      <div className="rounded-xl border border-panel-border p-4 bg-panel-bg text-xs max-w-xl">
        {job ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-panel-muted">Job</dt><dd className="break-all font-mono">{job.id}</dd>
            <dt className="text-panel-muted">Worker</dt><dd>{job.status}</dd>
            <dt className="text-panel-muted">Isolation</dt>
            <dd>{job.isolated ? 'Docker verified' : 'Not yet confirmed'}</dd>
            <dt className="text-panel-muted">Test result</dt><dd>{job.result ?? 'pending'}</dd>
            <dt className="text-panel-muted">Report</dt>
            <dd className="break-all">{job.reportPath ?? 'not available'}</dd>
            {job.error && <><dt className="text-panel-muted">Reason</dt><dd>{job.error}</dd></>}
          </dl>
        ) : <p className="text-panel-muted">No isolated test started in this Studio view.</p>}
      </div>
      <p className="text-[11px] text-panel-muted max-w-xl">
        This feature fails closed when the pinned Docker image is unavailable.
        A passing test is not a production deployment approval. Browser game
        previews and media processing have separate security boundaries.
      </p>
    </section>
  );
}
