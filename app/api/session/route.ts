import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { capabilityCookieName, createCapability } from '@/lib/session/capability';
import { createWorkspace } from '@/lib/workspace/manager';

export async function POST() {
  const sessionId = crypto.randomUUID();
  // Stage 3 design boards are usable before the first chat message.
  // Prepare the file-native project during explicit session creation,
  // not as a side effect of a read-only design-board GET.
  try {
    await createWorkspace(sessionId);
  } catch {
    return NextResponse.json({ error: 'Could not initialize game workspace' }, { status: 500 });
  }
  const response = NextResponse.json({ sessionId });
  response.cookies.set(capabilityCookieName(sessionId), createCapability(sessionId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
