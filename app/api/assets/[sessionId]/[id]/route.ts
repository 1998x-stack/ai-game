import { assetRequestGuard, assetWorkspace } from '@/lib/assets/access';
import { getAsset } from '@/lib/assets/catalog';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: {
  params: { sessionId: string; id: string };
}) {
  const rejected = assetRequestGuard(request, params.sessionId, false);
  if (rejected) return rejected;
  try {
    const root = await assetWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    const { asset, bytes } = getAsset(root, params.id);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': asset.mime, 'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="' + asset.id + '.' +
        (asset.mime === 'image/jpeg' ? 'jpg' : asset.path.split('.').pop()) + '"',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unavailable asset';
    return Response.json({ error: message.slice(0, 160) }, { status: /not found/.test(message) ? 404 : 400 });
  }
}
