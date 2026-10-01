// Git operations for per-session workspace repos.
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import * as path from 'path';

const SAFE_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_NOGLOBAL: '1',
  GIT_OPTIONAL_LOCKS: '0',
};

function exec(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
      env: SAFE_ENV,
    }).trim();
  } catch {
    return '';
  }
}

function execThrow(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000,
    env: SAFE_ENV,
  }).trim();
}

export function initGitRepo(workspacePath: string): void {
  execThrow(['init'], workspacePath);
  exec(['config', '--local', 'user.name', 'AI Game Studio Agent'], workspacePath);
  exec(['config', '--local', 'user.email', 'agent@ai-game.local'], workspacePath);
  exec(['config', '--local', 'core.hooksPath', '/dev/null'], workspacePath);
  writeFileSync(path.join(workspacePath, '.gitignore'), 'output/\n');
  exec(['add', '-A'], workspacePath);
  exec(['commit', '-m', 'Initial scaffold', '--no-verify'], workspacePath);
}

export function gitCommit(workspacePath: string, message: string): boolean {
  exec(['add', '-A'], workspacePath);
  const status = exec(['status', '--porcelain'], workspacePath);
  if (!status) return false;

  const sanitized = message.split('\n')[0].replace(/[^\w\s\-.,!?()[\]@]/g, '').trim() || 'Update';
  execThrow(['commit', '-m', sanitized, '--no-verify'], workspacePath);
  return true;
}

export function gitLog(workspacePath: string, count: number = 10): string {
  const safeCount = Math.min(Math.max(1, Math.floor(count)), 50);
  return exec(['log', '--oneline', `-${safeCount}`], workspacePath) || '(no commits)';
}

export function gitDiff(workspacePath: string, commit: string = 'HEAD'): string {
  if (!/^[A-Za-z0-9._/~-]+$/.test(commit)) return '(invalid commit reference)';
  return exec(['diff', commit, '--', '.', ':!output'], workspacePath) || '(no changes)';
}

export function gitDiffStaged(workspacePath: string): string {
  return exec(['diff', '--staged', '--', '.', ':!output'], workspacePath) || '(no staged changes)';
}

export function gitStatus(workspacePath: string): string {
  return exec(['status', '--short'], workspacePath) || '(clean)';
}

export function gitShow(workspacePath: string, commit: string): string {
  if (!/^[A-Za-z0-9._/~-]+$/.test(commit)) return `(commit ${commit} not found)`;
  return exec(['show', commit], workspacePath) || `(commit ${commit} not found)`;
}
