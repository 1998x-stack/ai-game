'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import SettingsModal, { type AppSettings } from '@/components/SettingsModal';
import ErrorConsole, { type GameError } from '@/components/ErrorConsole';
import ChatPanel, { type ChatMessage } from '@/components/ChatPanel';
import GamePreview from '@/components/GamePreview';

const STORAGE_KEY = 'ai-game-settings';

const defaultSettings: AppSettings = {
  provider: 'DeepSeek',
  apiKey: '',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
};

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<GameError[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [leftWidth, setLeftWidth] = useState(40);
  const [mobileView, setMobileView] = useState<'chat' | 'game'>('chat');

  const isDragging = useRef(false);

  // Initialize session ID on mount
  useEffect(() => {
    setSessionId(crypto.randomUUID());
    setMounted(true);
  }, []);

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
    if (!mounted) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mounted]);

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
            config: settings,
          }),
        });

        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }

        const data = await res.json();

        if (data.error) {
          const errorMsg: ChatMessage = {
            role: 'agent',
            content: `Error: ${data.error}`,
          };
          setMessages((prev) => [...prev, errorMsg]);
          return;
        }

        const buildSucceeded = data.buildResult?.success === true;
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: data.reply || '',
          toolCalls: data.toolCalls || undefined,
          buildResult: buildSucceeded,
        };

        setMessages((prev) => [...prev, agentMsg]);

        if (buildSucceeded && data.buildResult?.previewUrl) {
          setGameUrl(data.buildResult.previewUrl);
        }
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
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setGameUrl(null);
    setErrors([]);
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

  if (!mounted) return null;

  return (
    <div className="h-screen w-screen overflow-hidden flex">
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
        />
      </div>

      {/* Resizable divider (desktop only) */}
      {!isMobile && (
        <div
          onMouseDown={handleMouseDown}
          className="w-[3px] cursor-col-resize bg-panel-border hover:bg-panel-accent/60 active:bg-panel-accent transition-colors shrink-0 relative z-10"
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

      {/* Settings Modal */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSettingsSave}
      />
    </div>
  );
}
