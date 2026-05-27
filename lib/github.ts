// ═════════════════════════════════════════════════════════════
// GitHub operations via gh CLI (primary) + REST API (fallback)
// ═════════════════════════════════════════════════════════════
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

interface GitHubPushResult {
  success: boolean;
  repoUrl?: string;
  pagesUrl?: string;
  error?: string;
}

function ghExec(cmd: string, token: string, cwd?: string): string {
  return execSync(`gh ${cmd}`, {
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

  const name = repoName || `ai-game-${Date.now()}`;

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

  ghExec(
    `repo create ${repoName} ${visibility} --description "Game built with AI Game Studio"`,
    token,
  );

  const remote = `https://x-access-token:${token}@github.com/${repoName}.git`;
  execSync(`git remote add origin ${remote} 2>/dev/null || git remote set-url origin ${remote}`, {
    cwd: workspacePath,
    stdio: 'pipe',
  });

  execSync('git push -u origin main --force', {
    cwd: workspacePath,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 30_000,
  });

  let pagesUrl: string | undefined;
  try {
    pagesUrl = ghExec(
      `api /repos/${repoName}/pages --method POST -f source[branch]=main -f source[path]=/`,
      token,
    );
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

  const remote = `https://x-access-token:${token}@github.com/${full_name}.git`;
  execSync(`git remote add origin ${remote} 2>/dev/null || git remote set-url origin ${remote}`, {
    cwd: workspacePath,
    stdio: 'pipe',
  });

  execSync('git push -u origin main --force', {
    cwd: workspacePath,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 30_000,
  });

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
