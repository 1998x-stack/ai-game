'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize2, Minimize2, RefreshCw, Gamepad2, Loader2 } from 'lucide-react';
import type { GameError } from '@/components/ErrorConsole';

interface Props {
  gameUrl: string | null;
  onError: (err: GameError) => void;
  isBuilding: boolean;
}

export default function GamePreview({ gameUrl, onError, isBuilding }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for postMessage from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from the game preview iframe
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      const { type, message, source, lineno, colno } = event.data;

      if (type === 'game-ready') {
        setLoaded(true);
      } else if (type === 'game-error') {
        onError({ message: message || 'Unknown error', source, lineno, colno });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onError]);

  // Reset loaded when game URL changes
  useEffect(() => {
    setLoaded(false);
  }, [gameUrl]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
    setLoaded(false);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFSChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full bg-[#0a0a1a]"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-bg/80 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-xs text-panel-muted font-medium">Game Preview</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={!gameUrl}
            className="p-1.5 text-panel-muted hover:text-panel-text hover:bg-white/5 rounded transition-colors disabled:opacity-30"
            title="Refresh game"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFullscreen}
            disabled={!gameUrl}
            className="p-1.5 text-panel-muted hover:text-panel-text hover:bg-white/5 rounded transition-colors disabled:opacity-30"
            title="Fullscreen"
          >
            {fullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative">
        {gameUrl ? (
          <>
            {/* Iframe */}
            <iframe
              ref={iframeRef}
              src={gameUrl}
              sandbox="allow-scripts"
              className="absolute inset-0 w-full h-full border-0 bg-[#0a0a1a]"
              title="Game Preview"
              onLoad={() => {
                // If the iframe loads but doesn't send game-ready, mark as loaded
                setTimeout(() => setLoaded(true), 1000);
              }}
            />

            {/* Building overlay */}
            {isBuilding && (
              <div className="absolute inset-0 bg-[#0a0a1a]/90 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 text-panel-accent animate-spin" />
                <p className="text-sm text-panel-muted">Building your game...</p>
              </div>
            )}

            {/* Loading overlay (shown until iframe signals ready) */}
            {!isBuilding && !loaded && (
              <div className="absolute inset-0 bg-[#0a0a1a]/80 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 text-panel-muted animate-spin" />
                <p className="text-xs text-panel-muted">Loading game...</p>
              </div>
            )}
          </>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <div className="w-20 h-20 rounded-2xl bg-panel-surface border border-panel-border flex items-center justify-center mb-5">
              <Gamepad2 className="w-10 h-10 text-panel-muted" />
            </div>
            <p className="text-sm text-panel-text mb-1">Your game will appear here</p>
            <p className="text-xs text-panel-muted max-w-[240px]">
              Start a conversation to generate a game
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
