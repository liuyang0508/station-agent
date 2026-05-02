import { spawn } from 'node:child_process';
import { BaseExecutor } from './baseExecutor.mjs';

export class LimaExecutor extends BaseExecutor {
  constructor(context) {
    super(context);
    this.platform = 'lima';
    this.instance = context.instance || 'aia-agent';
  }

  async checkLimaAvailable() {
    return new Promise((resolve) => {
      const child = spawn('limactl', ['--version'], { shell: false });
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
    const check = await this.checkLimaAvailable();
    if (!check.ok) {
      throw new Error(`Lima not available: ${check.error || 'not installed'}`);
    }

    // Start the Lima instance if not running
    return new Promise((resolve) => {
      const child = spawn('limactl', ['start', '--name', this.instance, this.instance], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        this.started = code === 0;
        resolve({ ok: this.started, platform: this.platform, stderr: stderr.slice(0, 500) });
      });

      child.on('error', (error) => {
        resolve({ ok: false, platform: this.platform, error: error.message });
      });
    });
  }

  async execute(command, cwd = '.') {
    if (!this.started) {
      throw new Error('Executor not started');
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const child = spawn('limactl', ['shell', this.instance, 'bash', '-c', command], {
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
      const result = await this.execute('echo "Lima OK"', this.workspaceRoot);
      return { ok: result.ok, platform: this.platform };
    } catch (error) {
      return { ok: false, platform: this.platform, error: error.message };
    }
  }
}
