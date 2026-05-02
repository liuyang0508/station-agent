import { AgentRuntimeAdapter } from './BaseRuntime.mjs';

export class HermesRuntime extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this.endpoint = context.hermesEndpoint || 'http://localhost:7890';
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.endpoint}/health`, { method: 'GET' });
      return { ok: response.ok, status: response.ok ? 'connected' : 'error', message: response.statusText };
    } catch (error) {
      return { ok: false, status: 'network_error', message: error.message };
    }
  }

  async *runTurn(prompt, context) {
    const { session, history, settings, skills, memories = [], tools } = context;

    yield { type: 'trace', title: 'Hermes Runtime', detail: `连接 ${this.endpoint}`, status: 'running' };
    yield { type: 'trace', title: '工具注册', detail: `注册 ${tools?.list()?.length || 0} 个工具`, status: 'ok' };

    // Hermes CLI 通过 WebSocket 连接
    try {
      const response = await fetch(`${this.endpoint}/v1/agent/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          history: history.slice(-20),
          skills: skills.filter(s => s.enabled).map(s => s.name),
          memories: memories.slice(0, 8).map(m => m.content),
        })
      });

      if (!response.ok) {
        yield { type: 'trace', title: 'Hermes Runtime', detail: `连接失败: ${response.statusText}`, status: 'error' };
        yield { type: 'done', detail: 'Hermes 连接失败' };
        return;
      }

      const result = await response.json();
      for (const delta of result.delta || []) {
        yield { type: 'assistant.delta', delta };
      }

      yield { type: 'done', detail: '运行完成' };
    } catch (error) {
      yield { type: 'trace', title: 'Hermes Runtime', detail: error.message, status: 'error' };
      yield { type: 'done', detail: 'Hermes 运行异常' };
    }
  }

  getInfo() {
    return { mode: 'hermes', endpoint: this.endpoint };
  }
}
