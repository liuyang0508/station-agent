import { Wsl2Executor } from './executors/wsl2Executor.mjs';
import { LimaExecutor } from './executors/limaExecutor.mjs';
import { DockerExecutor } from './executors/dockerExecutor.mjs';
import { randomUUID } from 'node:crypto';

export class ExecutorManager {
  constructor({ store, workspaceRoot }) {
    this.store = store;
    this.workspaceRoot = workspaceRoot;
    this.executors = new Map();
    this.activeExecutor = null;
  }

  selectExecutor(platform) {
    switch (platform) {
      case 'wsl2':
        return new Wsl2Executor({ workspaceRoot: this.workspaceRoot });
      case 'lima':
        return new LimaExecutor({ workspaceRoot: this.workspaceRoot });
      case 'docker':
        return new DockerExecutor({ workspaceRoot: this.workspaceRoot });
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  async start(executorId) {
    const config = this.store.getExecutorConfig?.(executorId) || this._defaultConfig(executorId);
    const executor = this.selectExecutor(config.platform);
    await executor.start();
    this.executors.set(executorId, executor);
    this.activeExecutor = executorId;
    return { ok: true, executorId, platform: config.platform };
  }

  async stop(executorId) {
    const executor = this.executors.get(executorId);
    if (!executor) {
      return { ok: false, error: 'Executor not found' };
    }
    await executor.stop();
    this.executors.delete(executorId);
    if (this.activeExecutor === executorId) {
      this.activeExecutor = null;
    }
    return { ok: true };
  }

  async executeInExecutor(executorId, command, cwd) {
    const executor = this.executors.get(executorId);
    if (!executor) {
      throw new Error('Executor not running');
    }
    return executor.execute(command, cwd);
  }

  async healthCheck(executorId) {
    const executor = this.executors.get(executorId);
    if (!executor) {
      return { ok: false, error: 'Executor not found' };
    }
    return executor.healthCheck();
  }

  getExecutor(executorId) {
    return this.executors.get(executorId);
  }

  listExecutors() {
    return Array.from(this.executors.entries()).map(([id, executor]) => ({
      id,
      platform: executor.platform,
      started: executor.started,
    }));
  }

  _defaultConfig(executorId) {
    const platform = executorId.replace(/Executor$/, '').toLowerCase();
    return { platform, workspaceRoot: this.workspaceRoot };
  }

  async autoSelect() {
    const platform = process.platform === 'win32' ? 'wsl2'
      : process.platform === 'darwin' ? 'lima'
      : 'docker';

    const executorId = `${platform}Executor`;
    await this.start(executorId);
    return executorId;
  }
}
