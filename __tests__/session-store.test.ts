import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { appendToJsonl, readJsonl } from '@/lib/session-store';

const created: string[] = [];

afterEach(() => {
  for (const id of created.splice(0)) fs.rmSync(path.join(process.cwd(), 'user_space', id), { recursive: true, force: true });
});

describe('session persistence', () => {
  it('appends each message once and restores wrapped JSONL records', async () => {
    const id = crypto.randomUUID();
    created.push(id);
    const message = { role: 'user' as const, content: 'hello' };
    await appendToJsonl(id, [message]);
    await appendToJsonl(id, [message, { role: 'assistant', content: 'hi' }]);
    const restored = await readJsonl(id);
    expect(restored).toEqual([message, { role: 'assistant', content: 'hi' }]);
    const raw = fs.readFileSync(path.join(process.cwd(), 'user_space', id, 'session.jsonl'), 'utf8');
    expect(raw).toContain('"version":1');
  });
});
