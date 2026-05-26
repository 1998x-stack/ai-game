'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';

export interface GameError {
  message: string;
  source: string;
  lineno: number;
  colno: number;
}

interface EnrichedError extends GameError {
  id: number;
  timestamp: number;
}

interface Props {
  errors: GameError[];
  onClear: () => void;
}

export default function ErrorConsole({ errors, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  const enriched: EnrichedError[] = errors.map((e, i) => ({
    ...e,
    id: i,
    timestamp: Date.now(),
  }));

  const count = enriched.length;

  // Auto-expand when new error arrives
  useEffect(() => {
    if (count > 0) setCollapsed(false);
  }, [count]);

  if (count === 0 && collapsed) return null;

  return (
    <div className="border-t border-red-900/30 bg-panel-bg-deep">
      {/* Header bar — two independent buttons for a11y */}
      <div className="flex items-center justify-between w-full px-4 py-1.5">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 hover:bg-white/5 transition-colors rounded px-1 py-0.5"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show errors' : 'Hide errors'}
        >
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-medium text-red-300">Errors</span>
          {count > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/20 text-red-300 text-[10px] font-bold leading-none">
              {count}
            </span>
          )}
          {collapsed ? (
            <ChevronUp className="w-3.5 h-3.5 text-panel-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-panel-muted" />
          )}
        </button>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <button
              onClick={onClear}
              className="text-[11px] text-panel-muted hover:text-panel-text transition-colors rounded px-2 py-0.5"
              aria-label="Clear all errors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error list */}
      {!collapsed && count > 0 && (
        <div className="max-h-[120px] overflow-y-auto px-4 pb-2 space-y-1 animate-fade-in-up">
          {enriched.map((err) => (
            <div
              key={err.id}
              className="flex items-start gap-2 py-1 text-xs border-b border-white/5 last:border-0"
            >
              <AlertCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-red-200 truncate">{err.message}</p>
                <p className="text-red-400/70 mt-0.5">
                  {err.source ? `${err.source}:${err.lineno}:${err.colno}` : `line ${err.lineno}, col ${err.colno}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
