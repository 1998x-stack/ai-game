'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Settings, Plus, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  toolCalls?: ToolCall[];
  buildResult?: boolean;
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onOpenSettings: () => void;
  onNewGame: () => void;
  isGenerating: boolean;
}

const examplePrompts = [
  'Make a snake game',
  'Create a space shooter',
  'Build a puzzle game',
];

export default function ChatPanel({
  messages,
  onSend,
  onOpenSettings,
  onNewGame,
  isGenerating,
}: Props) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput('');
    onSend(trimmed);
  }, [input, isGenerating, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderContent = (content: string) => {
    // Simple markdown-ish formatting: code blocks, bold, italic
    const parts = content.split(/(```[\s\S]*?```|__[\s\S]*?__|\*[\s\S]*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3);
        const lang = code.split('\n')[0];
        const body = code.includes('\n') ? code.slice(code.indexOf('\n') + 1) : code;
        return (
          <pre
            key={i}
            className="my-1.5 px-3 py-2 rounded bg-black/30 text-panel-muted text-[12px] leading-relaxed overflow-x-auto"
          >
            {lang && !body && <span className="text-panel-muted/50">{lang}</span>}
            {body || lang}
          </pre>
        );
      }
      if (part.startsWith('__') && part.endsWith('__')) {
        return <strong key={i} className="text-panel-text">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="text-panel-text/80">{part.slice(1, -1)}</em>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  // Auto-focus input when not generating
  useEffect(() => {
    if (!isGenerating) {
      textareaRef.current?.focus();
    }
  }, [isGenerating]);

  return (
    <div className="flex flex-col h-full bg-panel-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-panel-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-panel-accent to-orange-500 flex items-center justify-center text-xs font-bold text-white">
            GS
          </div>
          <h1 className="text-sm font-semibold text-panel-text tracking-tight">
            AI Game Studio
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onNewGame}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-panel-muted hover:text-panel-text hover:bg-white/5 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Game
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-panel-muted hover:text-panel-text hover:bg-white/5 rounded transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-full bg-panel-surface border border-panel-border flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-panel-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                />
              </svg>
            </div>
            <p className="text-sm text-panel-text mb-1">What would you like to create?</p>
            <p className="text-xs text-panel-muted mb-4">
              Describe a game and I&apos;ll build it for you
            </p>

            <div className="space-y-2 w-full max-w-[240px]">
              {examplePrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSend(prompt)}
                  disabled={isGenerating}
                  className="w-full text-left px-3 py-2 rounded border border-panel-border bg-panel-surface/50 text-xs text-panel-muted hover:text-panel-text hover:border-panel-accent/30 hover:bg-panel-surface transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                /* User bubble */
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-panel-accent text-white text-sm leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                /* Agent message */
                <div className="flex justify-start">
                  <div className="max-w-[92%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-panel-surface text-panel-text text-sm leading-relaxed">
                    {renderContent(msg.content)}

                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {msg.toolCalls.map((tc, j) => (
                          <ToolCallCard key={j} call={tc} />
                        ))}
                      </div>
                    )}

                    {/* Build success */}
                    {msg.buildResult && (
                      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs animate-pulse">
                        🎮 Game ready! Play on the right →
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* Loading indicator */}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-panel-surface">
              <div className="flex items-center gap-2 text-sm text-panel-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="inline-flex">
                  Generating your game
                  <span className="inline-flex overflow-hidden ml-0.5">
                    <span className="animate-[bounce_1.4s_infinite_.0s]">.</span>
                    <span className="animate-[bounce_1.4s_infinite_.2s]">.</span>
                    <span className="animate-[bounce_1.4s_infinite_.4s]">.</span>
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-panel-border px-4 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the game you want to create..."
              rows={1}
              disabled={isGenerating}
              className="w-full resize-none bg-panel-surface border border-panel-border rounded-xl px-4 py-2.5 pr-11 text-sm text-panel-text placeholder-panel-muted/40 focus:outline-none focus:ring-2 focus:ring-panel-accent/30 focus:border-panel-accent transition-shadow disabled:opacity-40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isGenerating}
              className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-panel-accent text-white hover:bg-red-500/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded((v) => !v)}
      className="w-full text-left text-xs bg-black/20 border border-white/5 rounded-lg overflow-hidden transition-colors hover:bg-black/30"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-panel-muted shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-panel-muted shrink-0" />
        )}
        <span className="text-panel-muted/70">📁</span>
        <code className="text-panel-muted">{call.name}</code>
        <span className="text-panel-muted/50 truncate ml-auto">
          {JSON.stringify(call.arguments).slice(0, 60)}
          {JSON.stringify(call.arguments).length > 60 ? '…' : ''}
        </span>
      </div>
      {expanded && (
        <pre className="px-2.5 pb-2 text-[11px] text-panel-muted/60 overflow-x-auto">
          {JSON.stringify(call.arguments, null, 2)}
        </pre>
      )}
    </button>
  );
}
