import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { createWorkspace, restoreWorkspace, getWorkspace, cleanupStaleWorkspaces, deleteWorkspace } from '@/lib/workspace/manager';

const ids: string[] = [];

afterEach(async () => {
  for (const id of ids.splice(0)) {
    await deleteWorkspace(id);
    fs.rmSync(path.join(process.cwd(), 'user_space', id), { recursive: true, force: true });
  }
});

describe('workspace lifecycle', () => {
  it('preserves a partially completed project across restoration', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    const first = await createWorkspace(id);
    const draftPath = path.join(first.workspacePath, 'scripts', 'draft.js');
    fs.writeFileSync(draftPath, 'const importantProgress = 42;');
    await restoreWorkspace(id);
    expect(fs.readFileSync(draftPath, 'utf8')).toBe('const importantProgress = 42;');
  });

  it('stale registry cleanup does not erase saved game files', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    const ws = await createWorkspace(id);
    const draft = path.join(ws.workspacePath, 'scripts', 'game.js');
    fs.writeFileSync(draft, 'const game = true;');
    await cleanupStaleWorkspaces(-1000);
    expect(getWorkspace(id)).toBeNull();
    expect(fs.existsSync(draft)).toBe(true);
    await restoreWorkspace(id);
    expect(fs.readFileSync(draft, 'utf8')).toBe('const game = true;');
  });
});
