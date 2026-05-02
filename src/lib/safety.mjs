import fs from 'node:fs';
import path from 'node:path';

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\s+\//,
  /\bsudo\s+.*\brm\b/,
  /\bchmod\s+777\s+\//,
  /\bchown\s+.*\s+\//,
  /\bdd\s+.*of=\/dev/,
  /\bmkfs\b/,
  /\bcurl\s+.*\|\s*(ba)?sh/,
  /\bwget\s+.*\|\s*(ba)?sh/,
  />\s*\/etc\//,
  />\s*\/dev\/(?!null)/,
  /\beval\s/
];

export function normalizeWorkspaceRoot(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot || process.cwd());
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function normalizeTargetPath(targetPath) {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync(resolved);
  }

  const missingSegments = [];
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }

  const realBase = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.join(realBase, ...missingSegments);
}

export function isPathInside(root, target) {
  const normalizedRoot = normalizeWorkspaceRoot(root);
  const normalizedTarget = normalizeTargetPath(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateWorkspacePath(workspaceRoot, targetPath) {
  if (!targetPath) {
    return { allowed: false, reason: '缺少目标路径' };
  }

  const root = normalizeWorkspaceRoot(workspaceRoot);
  const target = normalizeTargetPath(targetPath);
  if (!isPathInside(root, target)) {
    return {
      allowed: false,
      reason: `目标路径不在工作区内: ${target}`
    };
  }

  try {
    if (fs.existsSync(target)) {
      const realTarget = fs.realpathSync(target);
      if (!isPathInside(root, realTarget)) {
        return {
          allowed: false,
          reason: `符号链接越界: ${target} -> ${realTarget}`
        };
      }
    }
  } catch (error) {
    return {
      allowed: false,
      reason: `路径校验失败: ${error.message}`
    };
  }

  return { allowed: true, root, target };
}

export function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    return { allowed: false, reason: '缺少命令' };
  }

  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: `命令命中高风险模式: ${pattern.toString()}`
      };
    }
  }

  return { allowed: true, sanitizedCommand: command.trim() };
}

export function redactSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return '********';
  return `${text.slice(0, 3)}...${text.slice(-4)}`;
}
