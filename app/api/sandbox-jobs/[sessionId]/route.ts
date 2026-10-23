import fs from 'fs';
import { assetRequestGuard, assetWorkspace } from '@/lib/assets/access';
import { parseGameTestContract } from '@/lib/runtime/game-contract';
import { enqueueSandboxJob, readSandboxJob, cancelSandboxJob } from '@/lib/sandbox/jobs';
import { imageReference } from '@/lib/sandbox/runner';
import { validateWorkspacePath } from '@/lib/security/validation';

export const runtime = 'nodejs';
type Context = { params: { sessionId: string } };
function getId(request: Request): string {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Query parameter id must be a job UUID');
  }
  return id;
}
export async function GET(request: Request, { params }: Context) {
  const denied = assetRequestGuard(request, params.sessionId, false);
  if (denied) return denied;
  try {
    const root = await assetWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace missing' }, { status: 404 });
    const job = readSandboxJob(root, getId(request));
    return Response.json(job || { error: 'Job not found' }, {
      status: job ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 200) : 'Failed' }, { status: 400 });
  }
}
export async function POST(request: Request, { params }: Context) {
  const denied = assetRequestGuard(request, params.sessionId, true);
  if (denied) return denied;
  try {
    // Reject missing Docker configuration before opening user-created files.
    imageReference(process.env.AI_GAME_SANDBOX_IMAGE);
    const root = await assetWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace missing' }, { status: 404 });
    const gameFile = validateWorkspacePath('output/index.html', root);
    const testsFile = validateWorkspacePath('game.test.json', root);
    if (!fs.statSync(gameFile).isFile() || fs.statSync(gameFile).size > 1_000_000 ||
        !fs.statSync(testsFile).isFile() || fs.statSync(testsFile).size > 64_000) {
      throw new Error('Build HTML or test contract missing/oversized');
    }
    const html = fs.readFileSync(gameFile, 'utf8');
    const contract = parseGameTestContract(JSON.parse(fs.readFileSync(testsFile, 'utf8')));
    const job = enqueueSandboxJob(root, html, contract);
    return Response.json(job, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'Sandbox unavailable';
    return Response.json({ error: message }, {
      status: /busy|active|capacity/.test(message) ? 409 : 400,
    });
  }
}
export async function DELETE(request: Request, { params }: Context) {
  const denied = assetRequestGuard(request, params.sessionId, true);
  if (denied) return denied;
  try {
    const root = await assetWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace missing' }, { status: 404 });
    const job = cancelSandboxJob(root, getId(request));
    return Response.json(job || { error: 'Job not found' }, {
      status: job ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 200) : 'Failed' }, { status: 400 });
  }
}
