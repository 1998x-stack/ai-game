'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import SettingsModal, { type AppSettings } from '@/components/SettingsModal';
import ErrorConsole, { type GameError } from '@/components/ErrorConsole';
import ChatPanel, { type ChatMessage } from '@/components/ChatPanel';
import GamePreview from '@/components/GamePreview';
import { Loader2 } from 'lucide-react';

const STORAGE_KEY = 'ai-game-settings';

const defaultSettings: AppSettings = {
  provider: 'DeepSeek',
  apiKey: '',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
};

export default function HomeContent() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<GameError[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [leftWidth, setLeftWidth] = useState(40);
  const [mobileView, setMobileView] = useState<'chat' | 'game'>('chat');
  const [restoringSession, setRestoringSession] = useState(false);
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  const isDragging = useRef(false);

  // Initialize session ID — check URL param first, otherwise new UUID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSessionId = params.get('session');
    if (urlSessionId) {
      setSessionId(urlSessionId);
    } else {
      setSessionId(crypto.randomUUID());
    }
  }, []);

  // Load session from API when sessionId comes from URL param
  useEffect(() => {
    if (!sessionId) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('session')) return;

    setRestoringSession(true);
    fetch(`/api/session/${sessionId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          const errMsg: ChatMessage = {
            role: 'agent',
            content: `Could not restore previous session: ${data.error}. Starting a fresh session.`,
          };
          setMessages([errMsg]);
          return;
        }
        const loaded: ChatMessage[] = [];
        for (const msg of data.messages) {
          if (msg.role === 'user') {
            loaded.push({ role: 'user', content: msg.content });
          } else if (msg.role === 'assistant') {
            loaded.push({
              role: 'agent',
              content: msg.content || '',
              reasoningContent: msg.reasoning_content || undefined,
              toolCalls: msg.tool_calls || undefined,
            });
          }
        }
        if (loaded.length > 0) {
          setMessages(loaded);
        }
        if (data.gameUrl) {
          setGameUrl(data.gameUrl);
        }
      })
      .catch(() => {
        const errMsg: ChatMessage = {
          role: 'agent',
          content: 'Could not load previous session — it may have expired. Start a new conversation below.',
        };
        setMessages([errMsg]);
      })
      .finally(() => {
        setRestoringSession(false);
      });
  }, [sessionId]);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        setSettings((prev) => ({ ...prev, ...parsed }));
      } else {
        // First load, no saved settings -> auto-open settings
        setShowSettings(true);
      }
    } catch {
      setShowSettings(true);
    }
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (isGenerating) return;

      // Add user message
      const userMsg: ChatMessage = { role: 'user', content };
      setMessages((prev) => [...prev, userMsg]);
      setIsGenerating(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: content,
            stream: true,
            config: settings,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Server error: ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        const streamedToolCalls: ChatMessage['toolCalls'] = [];
        let streamedContent = '';
        let streamedReasoning = '';

        const agentMsg: ChatMessage = {
          role: 'agent',
          content: '',
          toolCalls: streamedToolCalls,
        };
        setMessages((prev) => [...prev, agentMsg]);

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case 'reasoning':
                  streamedReasoning += event.content;
                  break;
                case 'message':
                  streamedContent += event.content;
                  break;
                case 'tool_call':
                  streamedToolCalls.push({
                    name: event.name,
                    arguments: event.arguments,
                  });
                  break;
                case 'build_result':
                  if (event.success && event.previewUrl) {
                    setGameUrl(event.previewUrl);
                  }
                  // fall through to update buildResult
                  agentMsg.buildResult = event.success;
                  break;
                case 'error':
                  streamedContent += `\nError: ${event.message}`;
                  break;
              }
              agentMsg.content = streamedContent;
              agentMsg.reasoningContent = streamedReasoning || undefined;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...agentMsg };
                return updated;
              });
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        if (!streamedContent && streamedToolCalls.length > 0) {
          agentMsg.content = 'Done.';
        }
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...agentMsg };
          return updated;
        });
      } catch (err) {
        const errMsg: ChatMessage = {
          role: 'agent',
          content: `Network error: ${err instanceof Error ? err.message : 'Request failed'}`,
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsGenerating(false);
      }
    },
    [sessionId, settings, isGenerating]
  );

  const handleNewGame = useCallback(() => {
    // If there are messages or a game, require confirmation
    if (messages.length > 0 || gameUrl) {
      setConfirmNewGame(true);
      return;
    }
    doNewGame();
  }, [messages.length, gameUrl]);

  const doNewGame = useCallback(() => {
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setGameUrl(null);
    setErrors([]);
    setConfirmNewGame(false);
  }, []);

  const handleSettingsSave = useCallback((s: AppSettings) => {
    setSettings(s);
  }, []);

  const handleGameError = useCallback((err: GameError) => {
    setErrors((prev) => [...prev.slice(-49), err]);
  }, []);

  const handleClearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  // Resizable divider logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      setLeftWidth(Math.min(Math.max(pct, 30), 55));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Detect mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden flex">
      {/* Restoring session overlay */}
      {restoringSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-lg bg-panel-bg border border-panel-border shadow-2xl">
            <Loader2 className="w-6 h-6 text-panel-accent animate-spin" />
            <p className="text-sm text-panel-muted">Restoring previous session...</p>
          </div>
        </div>
      )}

      {/* Mobile toggle tabs */}
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 z-30 flex border-b border-panel-border bg-panel-bg">
          <button
            onClick={() => setMobileView('chat')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              mobileView === 'chat'
                ? 'text-panel-accent border-b-2 border-panel-accent'
                : 'text-panel-muted'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setMobileView('game')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              mobileView === 'game'
                ? 'text-panel-accent border-b-2 border-panel-accent'
                : 'text-panel-muted'
            }`}
          >
            Game
          </button>
        </div>
      )}

      {/* Left panel - Chat */}
      <div
        className={`flex flex-col ${
          isMobile
            ? `${mobileView === 'chat' ? 'flex-1 pt-10' : 'hidden'}`
            : ''
        }`}
        style={
          !isMobile
            ? { width: `${leftWidth}%`, minWidth: 350, maxWidth: 600 }
            : undefined
        }
      >
        <ChatPanel
          messages={messages}
          onSend={handleSendMessage}
          onOpenSettings={() => setShowSettings(true)}
          onNewGame={handleNewGame}
          isGenerating={isGenerating}
          sessionId={sessionId}
        />
      </div>

      {/* Resizable divider (desktop only) */}
      {!isMobile && (
        <div
          onMouseDown={handleMouseDown}
          className="w-[4px] cursor-col-resize bg-panel-border hover:bg-panel-accent/70 active:bg-panel-accent hover:shadow-[0_0_12px_-2px_rgba(233,69,96,0.4)] transition-all duration-200 shrink-0 relative z-10"
        />
      )}

      {/* Right panel - Game Preview + ErrorConsole */}
      <div
        className={`flex flex-col flex-1 min-w-0 ${
          isMobile
            ? `${mobileView === 'game' ? 'flex-1 pt-10' : 'hidden'}`
            : ''
        }`}
      >
        <div className="flex-1 min-h-0">
          <GamePreview
            gameUrl={gameUrl}
            onError={handleGameError}
            isBuilding={isGenerating}
          />
        </div>

        <ErrorConsole errors={errors} onClear={handleClearErrors} />
      </div>

      {/* Confirm new game dialog */}
      {confirmNewGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmNewGame(false)}
          />
          <div
            className="relative w-full max-w-sm mx-4 rounded-lg border border-panel-border bg-panel-bg shadow-2xl shadow-black/50 p-6"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm new game"
          >
            <h3 className="text-base font-semibold text-panel-text mb-2">Start a new game?</h3>
            <p className="text-sm text-panel-muted mb-5">
              This will clear the current conversation and game. Your previous session won&apos;t be recoverable.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmNewGame(false)}
                className="px-4 py-2 text-sm text-panel-muted hover:text-panel-text transition-colors rounded"
              >
                Cancel
              </button>
              <button
                onClick={doNewGame}
                className="px-4 py-2 text-sm font-medium text-white bg-panel-accent rounded hover:bg-red-500/90 transition-colors"
                autoFocus
              >
                Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSettingsSave}
      />
    </div>
  );
}
