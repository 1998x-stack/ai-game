// ═════════════════════════════════════════════════════════════
// Git operations for per-session workspace repos
// ═════════════════════════════════════════════════════════════
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import * as path from 'path';

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    }).trim();
  } catch {
    return '';
  }
}

function execThrow(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000,
  }).trim();
}

export function initGitRepo(workspacePath: string): void {
  // Initialize git repo
  execThrow('git init', workspacePath);

  // Set safe defaults for commits (author info required)
  exec('git config user.name "AI Game Studio Agent"', workspacePath);
  exec('git config user.email "agent@ai-game.local"', workspacePath);

  // .gitignore: ignore build output (regenerated), keep scripts/assets tracked
  writeFileSync(
    path.join(workspacePath, '.gitignore'),
    'output/\n',
  );

  // Initial commit of scaffold
  exec('git add -A', workspacePath);
  exec('git commit -m "Initial scaffold"', workspacePath);
}

export function gitCommit(workspacePath: string, message: string): boolean {
  const addResult = exec('git add -A', workspacePath);
  const status = exec('git status --porcelain', workspacePath);
  if (!status) return false; // nothing to commit

  // Sanitize message: keep first line only, strip special chars
  const sanitized = message.split('\n')[0].replace(/[^\w\s\-.,!?()[\]@]/g, '').trim() || 'Update';
  execThrow(`git commit -m "${sanitized.replace(/"/g, '\\"')}"`, workspacePath);
  return true;
}

export function gitLog(workspacePath: string, count: number = 10): string {
  return exec(`git log --oneline -${count}`, workspacePath) || '(no commits)';
}

export function gitDiff(workspacePath: string, commit?: string): string {
  const base = commit || 'HEAD';
  return exec(`git diff ${base} -- . ':!output'`, workspacePath) || '(no changes)';
}

export function gitDiffStaged(workspacePath: string): string {
  return exec("git diff --staged -- . ':!output'", workspacePath) || '(no staged changes)';
}

export function gitStatus(workspacePath: string): string {
  return exec('git status --short', workspacePath) || '(clean)';
}

export function gitShow(workspacePath: string, commit: string): string {
  return exec(`git show ${commit}`, workspacePath) || `(commit ${commit} not found)`;
}
