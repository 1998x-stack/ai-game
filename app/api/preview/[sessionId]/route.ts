import { getWorkspace } from '@/lib/workspace/manager';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { sessionId } = params;

    const workspace = getWorkspace(sessionId);
    if (!workspace) {
      return new NextResponse('Session not found', { status: 404 });
    }

    const outputPath = path.join(
      workspace.workspacePath,
      'output',
      'index.html',
    );

    let html: string;
    try {
      html = await fs.readFile(outputPath, 'utf-8');
    } catch {
      return new NextResponse('Build output not found. Run a build first.', {
        status: 404,
      });
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
