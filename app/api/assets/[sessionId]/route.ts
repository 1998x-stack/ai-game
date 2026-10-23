import { NextResponse } from 'next/server';
import { assetRequestGuard, assetWorkspace } from '@/lib/assets/access';
import { generateAtlas, importAsset, listAssets, type AssetLicense } from '@/lib/assets/catalog';

export const runtime = 'nodejs';
type Ctx = { params: { sessionId: string } };
const MAX_REQUEST_BYTES = 2_300_000;
/** Bound chunked/missing-Content-Length HTTP bodies before multipart parsing. */
async function readBoundedRequest(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  let total = 0;
  const chunks: Buffer[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('Asset request exceeds 2.3 MB');
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, total);
}

export async function GET(request: Request, { params }: Ctx) {
  const rejected = assetRequestGuard(request, params.sessionId, false);
  if (rejected) return rejected;
  try {
    const root = await assetWorkspace(params.sessionId);
    if (!root) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    return NextResponse.json(listAssets(root), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: (error instanceof Error ? error.message : String(error)).slice(0, 160) }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const rejected = assetRequestGuard(request, params.sessionId, true);
  if (rejected) return rejected;
  const size = Number(request.headers.get('content-length'));
  if (Number.isFinite(size) && size > 2_300_000) {
    return NextResponse.json({ error: 'Asset request exceeds 2.3 MB' }, { status: 413 });
  }
  try {
    const root = await assetWorkspace(params.sessionId);
    if (!root) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    const kind = request.headers.get('content-type') || '';
    const bytes = await readBoundedRequest(request);
    if (kind.startsWith('application/json')) {
      const data: unknown = JSON.parse(bytes.toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid atlas request');
      const body = data as { action?: unknown; ids?: unknown };
      if (body.action !== 'atlas' || !Array.isArray(body.ids) ||
          body.ids.some(id => typeof id !== 'string') || body.ids.length > 16) {
        throw new Error('Expected atlas action and up to 16 asset IDs');
      }
      const result = generateAtlas(root, body.ids as string[]);
      return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
    }
    if (!kind.startsWith('multipart/form-data')) throw new Error('Expected multipart form upload');
    const form = await new Request('http://asset-upload.localhost/', {
      method: 'POST', headers: { 'Content-Type': kind }, body: new Uint8Array(bytes),
    }).formData();
    const entry = form.get('file');
    if (!(entry instanceof File)) throw new Error('Missing asset file');
    if (entry.size < 12 || entry.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be 12 B to 2 MiB' }, { status: 413 });
    }
    const license = form.get('license') || 'unknown';
    const source = form.get('source');
    if (typeof license !== 'string' || (source !== null && typeof source !== 'string')) {
      throw new Error('Invalid asset metadata');
    }
    const result = importAsset(root, entry.type, Buffer.from(await entry.arrayBuffer()), {
      filename: entry.name, license: license as AssetLicense, ...(source ? { source } : {}),
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Asset operation failed').slice(0, 240);
    const code = /busy/.test(message) ? 409 : /quota|exceeds|size/.test(message) ? 413 : 400;
    return NextResponse.json({ error: message }, { status: code });
  }
}
