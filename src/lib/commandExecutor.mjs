import { spawn } from 'node:child_process';
import path from 'node:path';
import { validateCommand, validateWorkspacePath } from './safety.mjs';

export const OperationType = {
  FILE_WRITE: 'file_write',
  FILE_DELETE: 'file_delete',
  FILE_RENAME: 'file_rename',
  COMMAND_EXEC: 'command_exec',
};

const WRITE_COMMANDS = new Set(['mkdir', 'rmdir', 'rm', 'mv', 'cp', 'touch', 'tee']);
const SHELL_META_PATTERN = /[|;&<>`$]/;

export function classifyCommand(command) {
  const sanitized = String(command || '').trim();
  if (SHELL_META_PATTERN.test(sanitized)) {
    return { type: 'blocked', reason: 'Shell meta characters not allowed' };
  }

  const parts = sanitized.split(/\s+/);
  const base = path.basename(parts[0] || '');

  if (WRITE_COMMANDS.has(base)) {
    return { type: 'write', command: sanitized, executable: base, args: parts.slice(1) };
  }

  return { type: 'read', command: sanitized, executable: base, args: parts.slice(1) };
}

export class CommandExecutor {
  constructor({ store, workspaceRoot }) {
    this.store = store;
    this.workspaceRoot = workspaceRoot;
  }

  async execute(command, cwd = '.', options = {}) {
    const classification = classifyCommand(command);
    const requestedCwd = path.isAbsolute(cwd)
      ? cwd
      : path.resolve(this.workspaceRoot, cwd || '.');
    const cwdValidation = validateWorkspacePath(this.workspaceRoot, requestedCwd);
    if (!cwdValidation.allowed) {
      throw new Error(cwdValidation.reason);
    }

    // For write commands, create an approval
    if (classification.type === 'write') {
      const approval = this.store.createApproval({
        title: `写命令: ${classification.command}`,
        detail: `工作区内写操作: ${requestedCwd}`,
        kind: 'command',
        risk: 'high',
        payload: {
          command: classification.command,
          cwd: requestedCwd,
          executable: classification.executable,
          args: classification.args,
        },
      });
      return { ok: false, requiresApproval: true, approvalId: approval.id, classification };
    }

    // For read commands, validate and execute
    const validation = validateCommand(command);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    return this._spawnExecution(validation.sanitizedCommand, cwdValidation.target, options);
  }

  async executeApproved(approvalId, options = {}) {
    const approval = this.store.getApproval(approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }
    if (approval.status !== 'approved') {
      throw new Error(`Approval not approved: ${approval.status}`);
    }

    const { command, cwd } = approval.payload;
    const validation = validateCommand(command);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    const cwdValidation = validateWorkspacePath(this.workspaceRoot, cwd);
    if (!cwdValidation.allowed) {
      throw new Error(cwdValidation.reason);
    }

    const result = await this._spawnExecution(validation.sanitizedCommand, cwdValidation.target, options);
    this.store.consumeApproval(approvalId, result);
    return result;
  }

  _spawnExecution(command, cwd, options = {}) {
    return new Promise((resolve) => {
      const { timeoutMs = 30000, maxOutputBytes = 96 * 1024 } = options;
      const startedAt = Date.now();

      const parts = command.split(/\s+/);
      const executable = parts[0];
      const args = parts.slice(1);

      const child = spawn(executable, args, {
        cwd,
        shell: false,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
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

      child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, command, cwd, exitCode: null, stdout, stderr, durationMs: Date.now() - startedAt, error: error.message, timedOut });
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ ok: exitCode === 0 && !timedOut, command, cwd, exitCode, stdout, stderr, durationMs: Date.now() - startedAt, timedOut });
      });
    });
  }
}
