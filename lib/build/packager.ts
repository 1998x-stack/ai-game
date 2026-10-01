import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parse } from 'acorn';
import { CONFIG } from '@/lib/config';

export interface BuildResult {
  html: string;
  outputPath: string;
  errors: string[];
  success?: boolean;
  buildId?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
};

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function scriptSort(files: string[]): string[] {
  const priority = (f: string): number => {
    if (f === 'utils.js' || f === 'utils/index.js') return 0;
    if (f === 'main.js' || f === 'game.js') return 1;
    return 2;
  };
  return files.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

// Matches window.x =  (but not == or ===) and window['x'] =  patterns
const WINDOW_DOT_ASSIGN = /window\s*\.\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*(?!=)/m;
const WINDOW_BRACKET_ASSIGN = /window\s*\[\s*['"][a-zA-Z_$][a-zA-Z0-9_$]*['"]\s*\]\s*=\s*(?!=)/m;

function assignsToWindow(code: string): boolean {
  return WINDOW_DOT_ASSIGN.test(code) || WINDOW_BRACKET_ASSIGN.test(code);
}

function escapeJsStr(s: string): string {
  return s.replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildMinimalHtml(): string {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>AI Game</title><style>body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas id="gameCanvas"></canvas><script type="module">window.parent.postMessage({type:\'game-ready\'},\'*\');</script></body></html>';
}

function writeFallbackOutput(outputDir: string, error: string): BuildResult {
  const html = buildMinimalHtml();
  const outputPath = path.join(outputDir, 'index.html');
  return { html, outputPath, errors: [error], success: false, buildId: crypto.randomUUID() };
}

export function buildGame(workspacePath: string): BuildResult {
  const errors: string[] = [];
  const scriptsDir = path.join(workspacePath, 'scripts');
  const assetsDir = path.join(workspacePath, 'assets');
  const outputDir = path.join(workspacePath, 'output');

  let scriptFiles: string[];
  try {
    const allFiles = fs.readdirSync(scriptsDir);
    scriptFiles = scriptSort(allFiles.filter(f => f.endsWith('.js')));
  } catch (e) {
    return writeFallbackOutput(outputDir, `Failed to read scripts directory: ${(e as Error).message}`);
  }

  if (scriptFiles.length === 0) {
    return writeFallbackOutput(outputDir, 'No .js files found in scripts/ directory');
  }

  const scripts: { name: string; content: string }[] = [];
  for (const file of scriptFiles) {
    try {
      const content = fs.readFileSync(path.join(scriptsDir, file), 'utf-8');
      if (Buffer.byteLength(content, 'utf8') > CONFIG.build.maxScriptBytes) {
        errors.push(`Script "${file}" exceeds the ${CONFIG.build.maxScriptBytes}-byte limit`);
        continue;
      }
      try {
        parse(content, { ecmaVersion: 'latest', sourceType: 'module' });
      } catch (error) {
        errors.push(`Syntax error in "${file}": ${(error as Error).message}`);
        continue;
      }
      scripts.push({ name: file, content });
    } catch (e) {
      errors.push(`Failed to read script "${file}": ${(e as Error).message}`);
    }
  }

  if (scripts.length === 0) {
    return writeFallbackOutput(outputDir, 'Failed to read any valid .js files');
  }

  const assetMap: { key: string; dataUri: string }[] = [];
  let totalAssetBytes = 0;
  try {
    const assetFiles = fs.readdirSync(assetsDir);
    for (const file of assetFiles) {
      const fullPath = path.join(assetsDir, file);
      try {
        if (fs.statSync(fullPath).isFile()) {
          const buf = fs.readFileSync(fullPath);
          if (buf.byteLength > CONFIG.build.maxAssetBytes) {
            errors.push(`Asset "${file}" exceeds the ${CONFIG.build.maxAssetBytes}-byte limit`);
            continue;
          }
          totalAssetBytes += buf.byteLength;
          if (totalAssetBytes > CONFIG.build.maxTotalAssetBytes) {
            errors.push(`Assets exceed the ${CONFIG.build.maxTotalAssetBytes}-byte total limit`);
            continue;
          }
          const mime = getMimeType(file);
          const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
          assetMap.push({ key: escapeJsStr(file), dataUri: escapeJsStr(dataUri) });
        }
      } catch (e) {
        errors.push(`Failed to read asset "${file}": ${(e as Error).message}`);
      }
    }
  } catch { /* assets/ missing is fine */ }

  // Prevent an agent-provided string/comment containing </script> from ending the HTML script element.
  const allCode = scripts.map(s => s.content).join('\n').replace(/<\/(script)/gi, '<\\/$1');

  const gameScriptBlock =
    allCode +
    (assignsToWindow(allCode)
      ? `\nif(typeof startGame==='function')startGame();`
      : '');

  let assetScriptBlock = '';
  if (assetMap.length > 0) {
    const pairs = assetMap.map(a => `"${a.key}":"${a.dataUri}"`).join(',');
    assetScriptBlock = `<script>window.__ASSETS__={${pairs}};</script>`;
  }

  const errorScript = '<script>window.addEventListener(\'error\',function(e){window.parent.postMessage({type:\'game-error\',message:e.message,source:e.filename,lineno:e.lineno,colno:e.colno},\'*\')});</script>';
  const initScript = assetScriptBlock + '<script type="module">' + gameScriptBlock + '\nwindow.parent.postMessage({type:\'game-ready\'},\'*\');</script>';

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>AI Game</title><style>body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas id="gameCanvas"></canvas>' + errorScript + initScript + '</body></html>';

  const outputPath = path.join(outputDir, 'index.html');
  if (Buffer.byteLength(html, 'utf8') > CONFIG.build.maxHtmlBytes) {
    errors.push(`Generated HTML exceeds the ${CONFIG.build.maxHtmlBytes}-byte limit`);
  }
  const buildId = crypto.randomUUID();
  try {
    if (errors.length > 0) return { html, outputPath, errors, success: false, buildId };
    const stagingDir = path.join(outputDir, '.staging', buildId);
    const stagingPath = path.join(stagingDir, 'index.html');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(stagingPath, html, 'utf-8');
    fs.renameSync(stagingPath, outputPath);
    fs.writeFileSync(path.join(outputDir, 'build-manifest.json'), JSON.stringify({ buildId, createdAt: new Date().toISOString() }), 'utf-8');
  } catch (e) {
    errors.push(`Failed to write output file: ${(e as Error).message}`);
  }

  return { html, outputPath, errors, success: errors.length === 0, buildId };
}
