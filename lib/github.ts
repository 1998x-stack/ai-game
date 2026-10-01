// ═════════════════════════════════════════════════════════════
// GitHub operations via gh CLI (primary) + REST API (fallback)
// ═════════════════════════════════════════════════════════════
import { execFileSync, execSync } from 'child_process';
import { existsSync, chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import * as path from 'path';
import { validateRepoName } from '@/lib/security/validation';

interface GitHubPushResult {
  success: boolean;
  repoUrl?: string;
  pagesUrl?: string;
  error?: string;
}

function ghExec(args: string[], token: string, cwd?: string): string {
  return execFileSync('gh', args, {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  }).trim();
}

function hasGhCli(): boolean {
  try {
    execSync('gh --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function withGitToken<T>(workspacePath: string, token: string, action: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-game-askpass-'));
  const askpass = path.join(dir, 'askpass.cjs');
  writeFileSync(askpass, '#!/usr/bin/env node\nprocess.stdout.write(process.env.AI_GAME_GIT_TOKEN || "");\n', { mode: 0o700 });
  chmodSync(askpass, 0o700);
  try {
    return action({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: askpass,
      AI_GAME_GIT_TOKEN: token,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_NOGLOBAL: '1',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gitExec(args: string[], cwd: string, token?: string): string {
  const run = (env?: NodeJS.ProcessEnv) => execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    env,
  }).trim();
  return token ? withGitToken(cwd, token, run) : run();
}

async function createRepoApi(
  token: string,
  repoName: string,
  isPrivate: boolean,
): Promise<{ html_url: string; full_name: string }> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      name: repoName,
      private: isPrivate,
      auto_init: false,
      description: 'Game built with AI Game Studio',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (create repo): ${res.status} ${body}`);
  }

  return res.json();
}

async function enablePagesApi(
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        source: { branch: 'main', path: '/' },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (enable pages): ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.html_url as string;
}

async function getPagesUrlApi(
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.html_url as string;
  } catch {
    return null;
  }
}

export async function githubPush(
  workspacePath: string,
  token: string,
  repoName?: string,
  isPrivate: boolean = false,
): Promise<GitHubPushResult> {
  const outputPath = path.join(workspacePath, 'output', 'index.html');
  if (!existsSync(outputPath)) {
    return { success: false, error: 'No built game found. Run build_game first.' };
  }

  const name = validateRepoName(repoName || `ai-game-${Date.now()}`);

  try {
    if (hasGhCli()) {
      return await pushWithGhCli(workspacePath, token, name, isPrivate);
    }
    return await pushWithApi(workspacePath, token, name, isPrivate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

async function pushWithGhCli(
  workspacePath: string,
  token: string,
  repoName: string,
  isPrivate: boolean,
): Promise<GitHubPushResult> {
  const visibility = isPrivate ? '--private' : '--public';

  ghExec(['repo', 'create', repoName, visibility, '--description', 'Game built with AI Game Studio'], token);

  const remote = `https://github.com/${repoName}.git`;
  try { gitExec(['remote', 'remove', 'origin'], workspacePath); } catch { /* no existing remote */ }
  gitExec(['remote', 'add', 'origin', remote], workspacePath);
  gitExec(['push', '-u', 'origin', 'main', '--force'], workspacePath, token);

  let pagesUrl: string | undefined;
  try {
    pagesUrl = ghExec(['api', `/repos/${repoName}/pages`, '--method', 'POST', '-f', 'source[branch]=main', '-f', 'source[path]=/'], token);
    const parsed = JSON.parse(pagesUrl);
    pagesUrl = parsed.html_url as string;
  } catch {
    pagesUrl = `https://${repoName.split('/')[0]}.github.io/${repoName.split('/')[1]}`;
  }

  return {
    success: true,
    repoUrl: `https://github.com/${repoName}`,
    pagesUrl,
  };
}

async function pushWithApi(
  workspacePath: string,
  token: string,
  repoName: string,
  isPrivate: boolean,
): Promise<GitHubPushResult> {
  const { full_name } = await createRepoApi(token, repoName, isPrivate);

  const remote = `https://github.com/${full_name}.git`;
  try { gitExec(['remote', 'remove', 'origin'], workspacePath); } catch { /* no existing remote */ }
  gitExec(['remote', 'add', 'origin', remote], workspacePath);
  gitExec(['push', '-u', 'origin', 'main', '--force'], workspacePath, token);

  const [owner, repo] = full_name.split('/');
  let pagesUrl: string | undefined;
  try {
    pagesUrl = await enablePagesApi(token, owner, repo);
  } catch {
    const existing = await getPagesUrlApi(token, owner, repo);
    pagesUrl = existing || `https://${owner}.github.io/${repo}`;
  }

  return {
    success: true,
    repoUrl: `https://github.com/${full_name}`,
    pagesUrl,
  };
}
