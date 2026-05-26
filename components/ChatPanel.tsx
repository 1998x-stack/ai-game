'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Settings, Plus, Loader2, ChevronDown, ChevronRight, Copy, Check, AlertCircle, CheckCircle2, Circle } from 'lucide-react';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TodoUpdate {
  tasks: Array<{ task: string; status: 'pending' | 'done'; verify?: string }>;
  done: number;
  pending: number;
  next?: string;
}

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  toolCalls?: ToolCall[];
  buildResult?: boolean;
  reasoningContent?: string;
  todoUpdate?: TodoUpdate;
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onOpenSettings: () => void;
  onNewGame: () => void;
  isGenerating: boolean;
  sessionId: string;
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
  sessionId,
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

  const renderInline = (text: string): React.ReactNode => {
    const inlineParts = text.split(
      /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|__[^_]+?__|(?<!\*)\*[^*]+?\*(?!\*)|(?<!_)_[^_]+?_(?!_))/g
    );
    return inlineParts
      .filter((part) => part !== '')
      .map((part, i) => {
        // Inline code: `code`
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
          return (
            <code
              key={i}
              className="px-[3px] py-[1px] rounded bg-black/20 text-panel-text font-mono text-[12px]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        // Link: [text](url)
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={i}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-panel-accent underline decoration-panel-accent/30 hover:decoration-panel-accent transition-colors"
            >
              {renderInline(linkMatch[1])}
            </a>
          );
        }

        // Bold + Italic: ***text*** or ___text___
        if (
          (part.startsWith('***') && part.endsWith('***')) ||
          (part.startsWith('___') && part.endsWith('___'))
        ) {
          return (
            <strong key={i}>
              <em className="italic">{part.slice(3, -3)}</em>
            </strong>
          );
        }

        // Bold: **text** or __text__
        if (
          (part.startsWith('**') && part.endsWith('**')) ||
          (part.startsWith('__') && part.endsWith('__'))
        ) {
          return (
            <strong key={i} className="font-semibold text-panel-text">
              {part.slice(2, -2)}
            </strong>
          );
        }

        // Italic: *text* or _text_
        if (
          (part.startsWith('*') && part.endsWith('*') && part.length > 1) ||
          (part.startsWith('_') && part.endsWith('_') && part.length > 1)
        ) {
          return (
            <em key={i} className="italic text-panel-text/80">
              {part.slice(1, -1)}
            </em>
          );
        }

        // Plain text — render newlines as <br/>
        if (part.includes('\n')) {
          return part.split('\n').map((seg, j) => (
            <span key={`${i}-${j}`}>
              {j > 0 && <br />}
              {seg}
            </span>
          ));
        }

        return <span key={i}>{part}</span>;
      });
  };

  const renderContent = (content: string) => {
    if (!content.trim()) return null;

    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code block: ```lang ... ```
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim() || undefined;
        let code = '';
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code += lines[i] + '\n';
          i++;
        }
        code = code.replace(/\n$/, ''); // drop trailing newline
        i++; // skip closing ```
        elements.push(<CodeBlock key={key++} code={code} lang={lang} />);
        continue;
      }

      // Horizontal rule: ---
      if (/^-{3,}$/.test(line.trim())) {
        elements.push(
          <div key={key++} className="my-2 border-t border-panel-border/50" />
        );
        i++;
        continue;
      }

      // Heading: ## text
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const sizeMap: Record<number, string> = {
          1: 'text-base font-bold text-panel-text mt-2 mb-1',
          2: 'text-sm font-bold text-panel-text mt-1.5 mb-1',
          3: 'text-[13px] font-bold text-panel-text mt-1.5 mb-0.5',
          4: 'text-[13px] font-semibold text-panel-text mt-1 mb-0.5',
          5: 'text-xs font-semibold text-panel-text/90 mt-1 mb-0.5',
          6: 'text-xs font-semibold text-panel-text/80 mt-1 mb-0.5',
        };
        elements.push(
          <div key={key++} className={sizeMap[level] || sizeMap[3]}>
            {renderInline(text)}
          </div>
        );
        i++;
        continue;
      }

      // Unordered list: - item or * item
      if (/^[-*]\s/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, ''));
          i++;
        }
        elements.push(
          <ul key={key++} className="list-disc list-inside mb-1 space-y-0.5">
            {items.map((item, j) => (
              <li key={j} className="text-panel-text/90 text-sm leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered list: 1. item
      if (/^\d+\.\s/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\.\s+/, ''));
          i++;
        }
        elements.push(
          <ol key={key++} className="list-decimal list-inside mb-1 space-y-0.5">
            {items.map((item, j) => (
              <li key={j} className="text-panel-text/90 text-sm leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Paragraph (consecutive non-blank, non-special lines)
      if (line.trim() !== '') {
        const paraLines: string[] = [line];
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !lines[i].startsWith('```') &&
          !/^#{1,6}\s/.test(lines[i]) &&
          !/^-{3,}$/.test(lines[i].trim()) &&
          !/^[-*]\s/.test(lines[i]) &&
          !/^\d+\.\s/.test(lines[i])
        ) {
          paraLines.push(lines[i]);
          i++;
        }
        elements.push(
          <p key={key++} className="mb-1 last:mb-0 text-sm leading-relaxed">
            {renderInline(paraLines.join('\n'))}
          </p>
        );
        continue;
      }

      // Skip blank lines
      i++;
    }

    return elements.length > 0 ? <>{elements}</> : null;
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
            aria-label="Start a new game session"
          >
            <Plus className="w-3.5 h-3.5" />
            New Game
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-panel-muted hover:text-panel-text hover:bg-white/5 rounded transition-colors"
            aria-label="Open settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {sessionId && (
        <SessionBar sessionId={sessionId} />
      )}

      {/* Messages — aria-live region for screen reader announcements */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
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
            <div key={i} className="animate-message-in">
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
                  {msg.content.startsWith('Network error:') || msg.content.startsWith('Could not') ? (
                    /* Error message — visually distinct */
                    <div className="max-w-[92%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-red-950/60 border border-red-500/20 text-red-200 text-sm leading-relaxed">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <div>
                          {renderContent(msg.content)}
                          <p className="mt-1 text-xs text-red-400/70">
                            You can try sending your message again, or start a new game session.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="max-w-[92%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-panel-surface text-panel-text text-sm leading-relaxed">
                    {renderContent(msg.content)}

                    {/* Reasoning / thinking content — auto-expand */}
                    {msg.reasoningContent && (
                      <ReasoningBlock content={msg.reasoningContent} />
                    )}

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

                    {/* Todo progress */}
                    {msg.todoUpdate && (
                      <TodoCard update={msg.todoUpdate} />
                    )}
                  </div>
                  )}
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
              className="w-full resize-none bg-panel-surface border border-panel-border rounded-xl px-4 py-2.5 pr-11 text-sm text-panel-text placeholder:text-panel-muted/60 focus:outline-none focus:ring-2 focus:ring-panel-accent/30 focus:border-panel-accent transition-shadow disabled:opacity-40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isGenerating}
              className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-panel-accent text-white hover:bg-panel-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              aria-label="Send message"
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

function ReasoningBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2 rounded-lg bg-amber-500/5 border border-amber-500/15 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reasoning' : 'Show reasoning'}
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        💭 Thinking...
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-amber-300/60 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

function SessionBar({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const resumeUrl = `${window.location.origin}/?session=${sessionId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(resumeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="px-4 py-1.5 bg-panel-surface/50 border-b border-panel-border/50 flex items-center gap-2 text-[10px] text-panel-muted">
      <span className="truncate flex-1">
        Session: {sessionId.slice(0, 8)}...
      </span>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors text-panel-muted hover:text-panel-text"
        title="Copy resume link"
        aria-label={copied ? 'Resume link copied' : 'Copy session resume link'}
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  );
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded((v) => !v)}
      className="w-full text-left text-xs bg-black/20 border border-white/5 rounded-lg overflow-hidden transition-colors hover:bg-black/30"
      aria-expanded={expanded}
      aria-label={`Tool call: ${call.name}`}
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

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="my-1.5 rounded-lg overflow-hidden bg-panel-bg-deep border border-white/5">
      {lang && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
          <span className="text-[11px] text-panel-muted/50 font-mono uppercase tracking-wider">
            {lang}
          </span>
        </div>
      )}
      <div className="relative group">
        <pre className="px-3 py-2 text-[12px] leading-relaxed overflow-x-auto font-mono text-panel-muted/90 whitespace-pre">
          <code>{code}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 p-1 rounded bg-white/10 hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity text-panel-muted/60 hover:text-panel-text"
          title="Copy code"
          aria-label={copied ? 'Code copied' : 'Copy code to clipboard'}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

function TodoCard({ update }: { update: { tasks: Array<{ task: string; status: 'pending' | 'done'; verify?: string }>; done: number; pending: number; next?: string } }) {
  const total = update.done + update.pending;
  const pct = total > 0 ? Math.round((update.done / total) * 100) : 0;

  return (
    <div className="mt-3 rounded-lg bg-panel-bg-deep border border-white/5 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
        <span className="text-xs font-semibold text-panel-text">Game Plan</span>
        <span className="text-[11px] text-panel-muted ml-auto">
          {update.done}/{total} done
        </span>
      </div>
      <div className="h-1 bg-white/5">
        <div
          className="h-full bg-emerald-500/60 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="px-3 py-1.5 space-y-1 max-h-64 overflow-y-auto">
        {update.tasks.map((t, i) => (
          <div key={i} className="flex items-start gap-2 text-xs leading-relaxed group">
            {t.status === 'done' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-panel-muted/40 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <span className={t.status === 'done' ? 'text-panel-muted/60 line-through' : 'text-panel-text/90'}>
                {t.task}
              </span>
              {t.verify && (
                <span className="block text-[10px] text-panel-muted/50 mt-0.5 italic">
                  verify: {t.verify}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {update.next && (
        <div className="px-3 py-1.5 border-t border-white/5 text-[11px] text-panel-accent/80">
          Next: {update.next}
        </div>
      )}
    </div>
  );
}
