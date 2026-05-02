import { spawn } from 'node:child_process';
import { BaseExecutor } from './baseExecutor.mjs';
import path from 'node:path';

export class Wsl2Executor extends BaseExecutor {
  constructor(context) {
    super(context);
    this.platform = 'wsl2';
    this.distribution = context.distribution || 'Ubuntu-22.04';
  }

  async checkWslAvailable() {
    return new Promise((resolve) => {
      const child = spawn('wsl.exe', ['--status'], { shell: false });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.on('close', (code) => {
        resolve({ ok: code === 0, output });
      });
      child.on('error', (error) => {
        resolve({ ok: false, error: error.message });
      });
    });
  }

  async start() {
    const check = await this.checkWslAvailable();
    if (!check.ok) {
      throw new Error(`WSL2 not available: ${check.error || 'not installed'}`);
    }
    this.started = true;
    return { ok: true, platform: this.platform };
  }

  _wslPath(windowsPath) {
    return windowsPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (match, letter) => `/${letter.toLowerCase()}`);
  }

  async execute(command, cwd = '.') {
    if (!this.started) {
      throw new Error('Executor not started');
    }

    const wslCwd = this._wslPath(path.resolve(this.workspaceRoot, cwd || '.'));

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const child = spawn('wsl.exe', ['-d', this.distribution, 'bash', '-c', command], {
        shell: false,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, 30000);

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, command, platform: this.platform, stderr: error.message, durationMs: Date.now() - startedAt });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, command, platform: this.platform, exitCode: code, stdout, stderr, durationMs: Date.now() - startedAt });
      });
    });
  }

  async healthCheck() {
    try {
      const result = await this.execute('echo "WSL2 OK"', this.workspaceRoot);
      return { ok: result.ok, platform: this.platform };
    } catch (error) {
      return { ok: false, platform: this.platform, error: error.message };
    }
  }
}
