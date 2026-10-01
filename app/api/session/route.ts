import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { capabilityCookieName, createCapability } from '@/lib/session/capability';

export async function POST() {
  const sessionId = crypto.randomUUID();
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
