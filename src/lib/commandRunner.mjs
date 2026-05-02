import { spawn } from 'node:child_process';
import path from 'node:path';
import { validateCommand, validateWorkspacePath } from './safety.mjs';

const READ_ONLY_COMMANDS = new Set(['pwd', 'ls', 'find', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'git']);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'rev-parse',
  'ls-files',
  'describe'
]);
const SHELL_META_PATTERN = /[|;&<>`$]/;

export function splitCommand(command) {
  const input = String(command || '').trim();
  const parts = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error('命令引号未闭合');
  }
  if (current) parts.push(current);
  return parts;
}

export function validateReadOnlyCommand(command) {
  const base = validateCommand(command);
  if (!base.allowed) return base;
  const sanitizedCommand = base.sanitizedCommand;
  if (SHELL_META_PATTERN.test(sanitizedCommand)) {
    return { allowed: false, reason: '受限执行器不支持 shell 元字符、管道或重定向' };
  }

  let parts;
  try {
    parts = splitCommand(sanitizedCommand);
  } catch (error) {
    return { allowed: false, reason: error.message };
  }
  const executable = path.basename(parts[0] || '');
  if (!READ_ONLY_COMMANDS.has(executable)) {
    return { allowed: false, reason: `当前只允许只读命令: ${Array.from(READ_ONLY_COMMANDS).join(', ')}` };
  }
  if (executable === 'git') {
    const subcommand = parts.find((part) => !part.startsWith('-') && part !== parts[0]);
    if (subcommand && !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return { allowed: false, reason: `git ${subcommand} 不在只读允许列表内` };
    }
  }
  return { allowed: true, executable: parts[0], args: parts.slice(1), sanitizedCommand };
}

export function runReadOnlyCommand({ command, cwd = '.', workspaceRoot, timeoutMs = 10000, maxOutputBytes = 96 * 1024 }) {
  const validation = validateReadOnlyCommand(command);
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }

  const requestedCwd = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(workspaceRoot, cwd || '.');
  const cwdValidation = validateWorkspacePath(workspaceRoot, requestedCwd);
  if (!cwdValidation.allowed) {
    throw new Error(cwdValidation.reason);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(validation.executable, validation.args, {
      cwd: cwdValidation.target,
      shell: false,
      env: {
        ...process.env,
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (target, chunk) => {
      const next = target + chunk.toString('utf8');
      return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: validation.sanitizedCommand,
        cwd: cwdValidation.target,
        exitCode: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        command: validation.sanitizedCommand,
        cwd: cwdValidation.target,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });
  });
}
