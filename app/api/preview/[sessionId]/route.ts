import { getWorkspace } from '@/lib/workspace/manager';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_SPACE_DIR = path.join(process.cwd(), 'user_space');

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { sessionId } = params;

    // Validate sessionId format — prevent path traversal
    if (!UUID_RE.test(sessionId)) {
      return new NextResponse('Invalid session ID format', { status: 400 });
    }

    // Try in-memory Map first, then fall back to filesystem (Map may be
    // wiped by Next.js HMR after code changes during dev)
    let outputPath: string;
    const workspace = getWorkspace(sessionId);
    if (workspace) {
      outputPath = path.join(workspace.workspacePath, 'output', 'index.html');
    } else {
      outputPath = path.join(
        USER_SPACE_DIR,
        sessionId,
        'output',
        'index.html',
      );
    }

    let html: string;
    try {
      html = await fs.readFile(outputPath, 'utf-8');
    } catch {
      if (workspace) {
        return new NextResponse('Build output not found. Run a build first.', {
          status: 404,
        });
      }
      return new NextResponse('Session not found', { status: 404 });
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy':
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:",
      },
    });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Internal server error',
      { status: 500 },
    );
  }
}
