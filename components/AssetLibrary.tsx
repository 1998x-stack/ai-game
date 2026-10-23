'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Layers, RefreshCw, FileAudio, CheckCircle2 } from 'lucide-react';

type License = 'unknown' | 'owned' | 'CC0' | 'CC-BY-4.0';
export interface AssetItem {
  id: string;
  path: string;
  filename: string;
  kind: 'image' | 'audio';
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  license: License;
  source?: string;
  atlasFrames?: Array<{ id: string; x: number; y: number; width: number; height: number }>;
}
interface Props {
  sessionId: string;
  onAttach: (asset: AssetItem) => void;
  onCatalogChanged: (entries: AssetItem[]) => void;
}
export default function AssetLibrary({ sessionId, onAttach, onCatalogChanged }: Props) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState<License>('unknown');
  const [source, setSource] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/assets/' + sessionId, { cache: 'no-store' });
    const payload = await response.json() as { entries?: AssetItem[]; error?: string };
    if (!response.ok || !payload.entries) throw new Error(payload.error || 'Asset catalog unavailable');
    setAssets(payload.entries);
    onCatalogChanged(payload.entries);
  }, [sessionId, onCatalogChanged]);
  useEffect(() => {
    let active = true;
    fetch('/api/assets/' + sessionId, { cache: 'no-store' }).then(async res => {
      const body = await res.json() as { entries?: AssetItem[]; error?: string };
      if (!res.ok || !body.entries) throw new Error(body.error || 'Asset catalog unavailable');
      if (active) { setAssets(body.entries); onCatalogChanged(body.entries); }
    }).catch(err => { if (active) setMessage(err instanceof Error ? err.message : 'Asset load error'); });
    return () => { active = false; };
  }, [sessionId, onCatalogChanged]);
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('license', license);
      if (source.trim()) form.append('source', source.trim());
      const response = await fetch('/api/assets/' + sessionId, { method: 'POST', body: form });
      const result = await response.json() as { asset?: AssetItem; duplicate?: boolean; error?: string };
      if (!response.ok || !result.asset) throw new Error(result.error || 'Upload failed');
      await load();
      setFile(null); setSource('');
      if (picker.current) picker.current.value = '';
      setMessage(result.duplicate ? 'Already stored — SHA-256 duplicate reused' : 'Asset imported and verified');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally { setBusy(false); }
  };
  const buildAtlas = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/assets/' + sessionId, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'atlas', ids: chosen }),
      });
      const result = await response.json() as { asset?: AssetItem; error?: string; duplicate?: boolean };
      if (!response.ok || !result.asset) throw new Error(result.error || 'Atlas failed');
      await load();
      setChosen([]);
      setMessage(result.duplicate ? 'Existing atlas reused' :
        'Sprite atlas generated with ' + (result.asset.atlasFrames?.length ?? 0) + ' frames');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Atlas generation failed');
    } finally { setBusy(false); }
  };
  return (
    <section className="flex flex-1 min-h-0 flex-col overflow-auto p-4 gap-3" aria-label="Asset library">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h3 className="text-sm font-semibold">Asset Library · {assets.length} files</h3>
        <button type="button" onClick={() => void load().catch(error =>
          setMessage(error instanceof Error ? error.message : 'Refresh failed'))}
          className="text-xs px-2 py-1 rounded bg-panel-bg flex gap-1 items-center">
          <RefreshCw size={13} /> Refresh</button>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-panel-border bg-panel-bg p-3">
        <label className="text-xs text-panel-muted" htmlFor="studio-asset-file">Upload PNG, JPEG, WebP, WAV, Ogg or MP3 (max 2 MiB)</label>
        <input ref={picker} id="studio-asset-file" type="file" aria-label="Select asset file"
          accept=".png,.jpg,.jpeg,.webp,.wav,.ogg,.mp3,image/png,image/jpeg,image/webp,audio/wav,audio/ogg,audio/mpeg"
          onChange={e => setFile(e.target.files?.[0] || null)}
          className="block w-full text-xs text-panel-text file:rounded file:border-0 file:bg-panel-accent file:text-white file:px-3 file:py-1.5 file:mr-3" />
        <div className="flex flex-wrap gap-2">
          <label className="text-xs flex flex-col gap-1 flex-1">Rights label
            <select aria-label="Asset rights" value={license}
              onChange={e => setLicense(e.target.value as License)}
              className="bg-[#101527] border border-panel-border rounded px-2 py-1.5">
              <option value="unknown">Unknown — review</option>
              <option value="owned">Owned / original</option>
              <option value="CC0">CC0</option>
              <option value="CC-BY-4.0">CC BY 4.0</option>
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1 flex-[2]">Provenance link (optional, HTTPS)
            <input aria-label="Asset provenance" value={source} onChange={e => setSource(e.target.value)}
              maxLength={200} placeholder="https://…" className="bg-[#101527] border border-panel-border rounded px-2 py-1.5" />
          </label>
        </div>
        <button type="button" disabled={!file || busy} onClick={() => void upload()}
          className="bg-panel-accent rounded text-white px-3 py-2 flex justify-center items-center text-xs gap-2 disabled:opacity-40">
          <ImagePlus size={14} /> Import asset</button>
      </div>
      {message && <p role="status" className="text-xs text-panel-muted">{message}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" disabled={busy || chosen.length < 1 || chosen.length > 16}
          onClick={() => void buildAtlas()}
          className="flex items-center gap-2 bg-panel-bg border border-panel-border rounded text-xs px-3 py-2 disabled:opacity-40">
          <Layers size={14} /> Generate PNG atlas ({chosen.length}/16)</button>
        <span className="text-[11px] text-panel-muted">Select 1–16 PNG images. Existing assets stay unchanged.</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-5">
        {assets.map(asset => {
          const preview = '/api/assets/' + sessionId + '/' + asset.id;
          const selectable = asset.mime === 'image/png' && !asset.atlasFrames;
          return <article key={asset.id}
            className="rounded-lg bg-panel-bg border border-panel-border overflow-hidden flex flex-col">
            <div className="h-28 bg-[#080b17] flex items-center justify-center overflow-hidden">
              {asset.kind === 'image' ? (
                // Authenticated, integrity-checked, same-origin image bytes from asset API.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={asset.filename} className="object-contain max-w-full max-h-full" />
              ) : <FileAudio size={32} className="text-panel-muted" />}
            </div>
            <div className="p-2.5 flex flex-col gap-2">
              <p className="text-xs font-medium truncate" title={asset.filename}>{asset.filename}</p>
              <p className="text-[11px] text-panel-muted break-all">
                {(asset.bytes / 1024).toFixed(1)} KiB · {asset.width ? asset.width + '×' + asset.height : asset.mime}
                {' · '}{asset.license}
              </p>
              {asset.atlasFrames && <p className="text-[11px] text-panel-muted">Atlas: {asset.atlasFrames.length} frames</p>}
              {asset.kind === 'audio' && <audio src={preview} controls preload="none" className="w-full h-8" />}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => onAttach(asset)}
                  className="text-xs px-2 py-1 bg-panel-accent text-white rounded">Add to canvas</button>
                {selectable && <label className="flex items-center gap-1 text-[11px]">
                  <input type="checkbox" aria-label={'Include in atlas ' + asset.filename}
                    checked={chosen.includes(asset.id)}
                    onChange={e => setChosen(old => e.target.checked ?
                      [...old.filter(v => v !== asset.id), asset.id].slice(0, 16) : old.filter(v => v !== asset.id)} />
                  {chosen.includes(asset.id) ? <CheckCircle2 size={12} /> : null} Sprite
                </label>}
              </div>
            </div>
          </article>;
        })}
      </div>
      {assets.length === 0 && <p className="text-xs text-panel-muted">No imported assets. Add the first image or sound using the form above.</p>}
    </section>
  );
}
