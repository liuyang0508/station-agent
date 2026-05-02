import { spawn } from 'node:child_process';

export class BaseExecutor {
  constructor({ workspaceRoot }) {
    this.workspaceRoot = workspaceRoot;
    this.started = false;
    this.pid = null;
  }

  async start() {
    this.started = true;
    return { ok: true };
  }

  async stop() {
    this.started = false;
    this.pid = null;
    return { ok: true };
  }

  async execute(command, cwd) {
    throw new Error('Not implemented');
  }

  async getStatus() {
    return {
      ok: this.started,
      platform: this.platform,
      pid: this.pid,
    };
  }

  getPlatform() {
    return this.platform;
  }

  async healthCheck() {
    try {
      const result = await this.execute('echo health check', this.workspaceRoot);
      return { ok: result.ok, platform: this.platform };
    } catch (error) {
      return { ok: false, platform: this.platform, error: error.message };
    }
  }
}
