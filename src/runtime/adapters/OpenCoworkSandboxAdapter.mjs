import { AgentRuntimeAdapter } from './BaseRuntime.mjs';

export class OpenCoworkSandboxAdapter extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this.sandboxUrl = context.sandboxUrl || 'http://localhost:7892';
    this.platform = context.platform || this._detectPlatform();
  }

  _detectPlatform() {
    if (process.platform === 'win32') return 'wsl2';
    if (process.platform === 'darwin') return 'lima';
    return 'docker';
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.sandboxUrl}/api/health`, { method: 'GET' });
      return { ok: response.ok, status: response.ok ? 'connected' : 'error', message: response.statusText };
    } catch (error) {
      return { ok: false, status: 'network_error', message: error.message };
    }
  }

  async *runTurn(prompt, context) {
    const { session, history, settings, skills, memories = [], tools } = context;

    yield { type: 'trace', title: 'OpenCowork Sandbox', detail: `平台: ${this.platform}, 端点: ${this.sandboxUrl}`, status: 'running' };
    yield { type: 'trace', title: '沙箱隔离', detail: `工作区: ${settings.workspaceRoot}`, status: 'ok' };

    try {
      const response = await fetch(`${this.sandboxUrl}/api/v1/sandbox/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          platform: this.platform,
          history: history.slice(-20),
          workspace: settings.workspaceRoot,
          skills: skills.filter(s => s.enabled).map(s => s.name),
          memories: memories.slice(0, 8).map(m => m.content),
        })
      });

      if (!response.ok) {
        yield { type: 'trace', title: 'OpenCowork Sandbox', detail: `执行失败: ${response.statusText}`, status: 'error' };
        yield { type: 'done', detail: 'Sandbox 执行失败' };
        return;
      }

      const result = await response.json();
      for (const delta of result.delta || []) {
        yield { type: 'assistant.delta', delta };
      }

      yield { type: 'done', detail: '运行完成' };
    } catch (error) {
      yield { type: 'trace', title: 'OpenCowork Sandbox', detail: error.message, status: 'error' };
      yield { type: 'done', detail: 'Sandbox 运行异常' };
    }
  }

  getInfo() {
    return { mode: 'opencowork', platform: this.platform, sandboxUrl: this.sandboxUrl };
  }
}
