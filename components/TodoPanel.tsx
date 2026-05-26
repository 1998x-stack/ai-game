'use client';

import { ChevronDown } from 'lucide-react';

export interface TodoItem {
  text: string;
  done: boolean;
}

interface Props {
  items: TodoItem[];
}

export default function TodoPanel({ items }: Props) {
  if (items.length === 0) return null;

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  return (
    <div className="border-b border-panel-border bg-panel-surface/30 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-2 h-2 rounded-full ${allDone ? 'bg-emerald-400' : 'bg-panel-accent animate-pulse'}`} />
        <span className="text-[11px] font-medium text-panel-muted uppercase tracking-wider">
          Game Plan — {doneCount}/{items.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 text-[12px] leading-relaxed transition-colors ${
              item.done
                ? 'text-panel-muted/60 line-through'
                : 'text-panel-text'
            }`}
          >
            <span className="mt-[1px] shrink-0">
              {item.done ? '✅' : '○'}
            </span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
