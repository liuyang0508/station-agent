import { spawn } from 'node:child_process';
import { BaseExecutor } from './baseExecutor.mjs';
import { randomUUID } from 'node:crypto';

export class DockerExecutor extends BaseExecutor {
  constructor(context) {
    super(context);
    this.platform = 'docker';
    this.image = context.image || 'ubuntu:22.04';
    this.containerId = null;
  }

  async checkDockerAvailable() {
    return new Promise((resolve) => {
      const child = spawn('docker', ['--version'], { shell: false });
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
    const check = await this.checkDockerAvailable();
    if (!check.ok) {
      throw new Error(`Docker not available: ${check.error || 'not installed'}`);
    }
    this.started = true;
    return { ok: true, platform: this.platform };
  }

  async createContainer() {
    if (!this.started) {
      throw new Error('Executor not started');
    }

    const containerName = `aia-agent-${randomUUID().slice(0, 8)}`;

    return new Promise((resolve) => {
      const child = spawn('docker', ['create', '-i', '--name', containerName, '-w', this.workspaceRoot, this.image], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          this.containerId = containerName;
          resolve({ ok: true, containerId: containerName });
        } else {
          resolve({ ok: false, stderr: stderr.slice(0, 500) });
        }
      });

      child.on('error', (error) => {
        resolve({ ok: false, error: error.message });
      });
    });
  }

  async execute(command, cwd = '.') {
    if (!this.started) {
      throw new Error('Executor not started');
    }

    // Ensure container exists
    if (!this.containerId) {
      const container = await this.createContainer();
      if (!container.ok) {
        throw new Error(`Failed to create container: ${container.stderr}`);
      }
    }

    const workDir = cwd || this.workspaceRoot;

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const child = spawn('docker', ['exec', '-w', workDir, this.containerId, 'bash', '-c', command], {
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

  async stop() {
    if (this.containerId) {
      spawn('docker', ['rm', '-f', this.containerId], { shell: false });
      this.containerId = null;
    }
    this.started = false;
    return { ok: true };
  }

  async healthCheck() {
    try {
      const result = await this.execute('echo "Docker OK"', this.workspaceRoot);
      return { ok: result.ok, platform: this.platform };
    } catch (error) {
      return { ok: false, platform: this.platform, error: error.message };
    }
  }
}
