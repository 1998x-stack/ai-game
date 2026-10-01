import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_PREFIX = 'ai-game-capability-';
function getSecret(): string {
  const secret = process.env.AI_GAME_SESSION_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    throw new Error('AI_GAME_SESSION_SECRET must be configured in production');
  }
  return secret || 'ai-game-development-secret-change-me';
}

function signature(sessionId: string): string {
  return crypto.createHmac('sha256', getSecret()).update(sessionId).digest('base64url');
}

export function createCapability(sessionId: string): string {
  return signature(sessionId);
}

export function capabilityCookieName(sessionId: string): string {
  return `${COOKIE_PREFIX}${sessionId}`;
}

export function hasSessionCapability(sessionId: string): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const value = cookies().get(capabilityCookieName(sessionId))?.value;
  if (!value) return false;
  const expected = signature(sessionId);
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
