import fs from 'fs';
import path from 'path';

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

function writeFallbackOutput(outputDir: string, error: string): { html: string; outputPath: string; errors: string[] } {
  const html = buildMinimalHtml();
  const outputPath = path.join(outputDir, 'index.html');
  try { fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(outputPath, html, 'utf-8'); } catch { /* empty */ }
  return { html, outputPath, errors: [error] };
}

export function buildGame(workspacePath: string): { html: string; outputPath: string; errors: string[] } {
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
      scripts.push({ name: file, content });
    } catch (e) {
      errors.push(`Failed to read script "${file}": ${(e as Error).message}`);
    }
  }

  if (scripts.length === 0) {
    return writeFallbackOutput(outputDir, 'Failed to read any valid .js files');
  }

  const assetMap: { key: string; dataUri: string }[] = [];
  try {
    const assetFiles = fs.readdirSync(assetsDir);
    for (const file of assetFiles) {
      const fullPath = path.join(assetsDir, file);
      try {
        if (fs.statSync(fullPath).isFile()) {
          const buf = fs.readFileSync(fullPath);
          const mime = getMimeType(file);
          const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
          assetMap.push({ key: escapeJsStr(file), dataUri: escapeJsStr(dataUri) });
        }
      } catch (e) {
        errors.push(`Failed to read asset "${file}": ${(e as Error).message}`);
      }
    }
  } catch { /* assets/ missing is fine */ }

  const allCode = scripts.map(s => s.content).join('\n');

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
  const readyScript = '<script type="module">window.parent.postMessage({type:\'game-ready\'},\'*\');</script>';
  const initScript = assetScriptBlock + '<script type="module">' + gameScriptBlock + '</script>';

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>AI Game</title><style>body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas id="gameCanvas"></canvas>' + errorScript + initScript + readyScript + '</body></html>';

  const outputPath = path.join(outputDir, 'index.html');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
  } catch (e) {
    errors.push(`Failed to write output file: ${(e as Error).message}`);
  }

  return { html, outputPath, errors };
}
