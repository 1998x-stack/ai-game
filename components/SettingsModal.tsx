'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Eye, EyeOff, Save, Settings as Gear } from 'lucide-react';

export interface AppSettings {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const STORAGE_KEY = 'ai-game-settings';

const defaultSettings: AppSettings = {
  provider: 'DeepSeek',
  apiKey: '',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

export default function SettingsModal({ open, onClose, onSave }: Props) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [showKey, setShowKey] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap: move focus into modal when opened, restore when closed
  useEffect(() => {
    if (open) {
      // Small delay to ensure modal is rendered
      requestAnimationFrame(() => closeRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        setSettings({ ...defaultSettings, ...parsed });
      } else {
        setSettings(defaultSettings);
      }
    } catch {
      setSettings(defaultSettings);
    }
  }, [open]);

  const handleSave = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    onSave(settings);
    onClose();
  }, [settings, onSave, onClose]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative w-full max-w-md mx-4 rounded-lg border border-panel-border bg-panel-bg shadow-2xl shadow-black/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-panel-border">
          <div className="flex items-center gap-3">
            <Gear className="w-5 h-5 text-panel-accent" />
            <h2 id="settings-modal-title" className="text-lg font-semibold text-panel-text">Settings</h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-1.5 rounded-md text-panel-muted hover:text-panel-text hover:bg-white/5 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-panel-text mb-1.5">
              Provider
            </label>
            <select
              value={settings.provider}
              onChange={(e) => update('provider', e.target.value)}
              className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-panel-text text-sm focus:outline-none focus:ring-2 focus:ring-panel-accent/30 focus:border-panel-accent transition-shadow appearance-none cursor-pointer"
            >
              <option value="DeepSeek">DeepSeek</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Claude">Claude</option>
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-panel-text mb-1.5">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                placeholder="sk-..."
                className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 pr-10 text-panel-text text-sm placeholder:text-panel-muted/60 focus:outline-none focus:ring-2 focus:ring-panel-accent/40 focus:border-panel-accent transition-shadow"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text transition-colors"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-panel-text mb-1.5">
              Model
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => update('model', e.target.value)}
              placeholder="deepseek-v4-pro"
              className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-panel-text text-sm placeholder:text-panel-muted/60 focus:outline-none focus:ring-2 focus:ring-panel-accent/40 focus:border-panel-accent transition-shadow"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-panel-text mb-1.5">
              Base URL
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => update('baseUrl', e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-panel-text text-sm placeholder:text-panel-muted/60 focus:outline-none focus:ring-2 focus:ring-panel-accent/40 focus:border-panel-accent transition-shadow"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-panel-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-panel-muted hover:text-panel-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-panel-accent rounded hover:bg-panel-accent-hover transition-colors"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
