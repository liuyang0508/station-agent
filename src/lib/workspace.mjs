import fs from 'node:fs';
import path from 'node:path';
import { normalizeWorkspaceRoot, validateWorkspacePath } from './safety.mjs';

export function resolveWorkspaceTarget(workspaceRoot, relativePath = '.') {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const target = path.resolve(normalizedWorkspaceRoot, relativePath || '.');
  const validation = validateWorkspacePath(normalizedWorkspaceRoot, target);
  if (!validation.allowed) {
    const error = new Error(validation.reason || 'Path is outside workspace');
    error.statusCode = 403;
    throw error;
  }

  return {
    workspaceRoot: normalizedWorkspaceRoot,
    target: validation.target,
    relativePath: path.relative(normalizedWorkspaceRoot, validation.target) || '.'
  };
}

export function fileKind(entry) {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) return 'symlink';
  return 'other';
}

export function listWorkspaceDirectory(workspaceRoot, relativePath = '.', limit = 300) {
  const resolved = resolveWorkspaceTarget(workspaceRoot, relativePath);
  const normalizedWorkspaceRoot = resolved.workspaceRoot;
  const stat = fs.statSync(resolved.target);
  if (!stat.isDirectory()) {
    const error = new Error('Path is not a directory');
    error.statusCode = 400;
    throw error;
  }

  const entries = fs
    .readdirSync(resolved.target, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .slice(0, limit)
    .map((entry) => {
      const fullPath = path.join(resolved.target, entry.name);
      const entryValidation = validateWorkspacePath(normalizedWorkspaceRoot, fullPath);
      if (!entryValidation.allowed) return null;
      const entryStat = fs.statSync(fullPath);
      return {
        name: entry.name,
        kind: fileKind(entry),
        path: path.relative(normalizedWorkspaceRoot, entryValidation.target) || '.',
        size: entryStat.size,
        updatedAt: entryStat.mtime.toISOString()
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  return {
    workspaceRoot: normalizedWorkspaceRoot,
    path: resolved.relativePath,
    parent: resolved.relativePath === '.' ? null : path.dirname(resolved.relativePath),
    entries
  };
}

export function readWorkspaceFile(workspaceRoot, relativePath, maxBytes = 512 * 1024) {
  const resolved = resolveWorkspaceTarget(workspaceRoot, relativePath);
  const stat = fs.statSync(resolved.target);
  if (!stat.isFile()) {
    const error = new Error('Path is not a file');
    error.statusCode = 400;
    throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error(`File is larger than ${Math.round(maxBytes / 1024)}KB preview limit`);
    error.statusCode = 413;
    throw error;
  }

  return {
    workspaceRoot: resolved.workspaceRoot,
    path: resolved.relativePath,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    content: fs.readFileSync(resolved.target, 'utf8')
  };
}
