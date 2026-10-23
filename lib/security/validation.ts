import fs from 'fs';
import path from 'path';

const REPO_NAME = /^[A-Za-z0-9_.-]+$/;
const SENSITIVE_NAMES = new Set([
  '.gitmodules',
  '.gitattributes',
  '.gitconfig',
  '.gitignore',
]);

export function validateRepoName(value: string): string {
  if (!REPO_NAME.test(value) || value.length > 100) {
    throw new Error('Invalid repository name. Use only letters, numbers, dots, underscores, and hyphens.');
  }
  return value;
}

export function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
  return secrets.filter((secret): secret is string => Boolean(secret)).reduce(
    (result, secret) => result.split(secret).join('[REDACTED]'),
    message,
  );
}

export function validateBaseUrl(value: string, allowedHosts: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid provider base URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname.includes('..')) {
    throw new Error('Provider base URL must be an HTTPS endpoint');
  }
  if (!allowedHosts.includes(parsed.host)) {
    throw new Error(`Provider base URL is not allowed: ${parsed.host}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function isSensitiveWorkspacePath(userPath: string): boolean {
  const segments = userPath.split(/[\\/]+/).filter(Boolean);
  return segments.includes('.git') || segments.some((segment) => SENSITIVE_NAMES.has(segment));
}

export function validateWorkspacePath(userPath: string, workspaceRoot: string, forWrite = false): string {
  if (!userPath || userPath.includes('\0') || path.isAbsolute(userPath) ||
      userPath.includes('..') || isSensitiveWorkspacePath(userPath)) {
    throw new Error('Path is not allowed inside the workspace');
  }

  // Resolve the nearest existing ancestor so deeply nested new files work.
  // Checking only the immediate parent incorrectly rejected safe new paths.
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const resolved = path.resolve(root, userPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path is outside the workspace root');
  }
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Workspace path cannot be resolved safely');
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== root && !realAncestor.startsWith(root + path.sep)) {
    throw new Error('Path resolves outside the workspace root');
  }

  if (forWrite) {
    let current = root;
    for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('Writing through symbolic links is not allowed');
      }
    }
  }
  return resolved;
}
