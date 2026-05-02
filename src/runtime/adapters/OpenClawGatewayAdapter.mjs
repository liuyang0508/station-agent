import { AgentRuntimeAdapter } from './BaseRuntime.mjs';

export class OpenClawGatewayAdapter extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this.gatewayUrl = context.gatewayUrl || 'http://localhost:7891';
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.gatewayUrl}/api/health`, { method: 'GET' });
      return { ok: response.ok, status: response.ok ? 'connected' : 'error', message: response.statusText };
    } catch (error) {
      return { ok: false, status: 'network_error', message: error.message };
    }
  }

  async *runTurn(prompt, context) {
    const { session, history, settings, skills, memories = [], tools } = context;

    yield { type: 'trace', title: 'OpenClaw Gateway', detail: `连接 ${this.gatewayUrl}`, status: 'running' };
    yield { type: 'trace', title: '设备节点', detail: '检查可用节点...', status: 'ok' };

    try {
      const response = await fetch(`${this.gatewayUrl}/api/v1/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          session: session?.id,
          history: history.slice(-20),
          workspace: settings.workspaceRoot,
          skills: skills.filter(s => s.enabled).map(s => s.name),
          memories: memories.slice(0, 8).map(m => m.content),
        })
      });

      if (!response.ok) {
        yield { type: 'trace', title: 'OpenClaw Gateway', detail: `连接失败: ${response.statusText}`, status: 'error' };
        yield { type: 'done', detail: 'Gateway 连接失败' };
        return;
      }

      const result = await response.json();
      for (const delta of result.delta || []) {
        yield { type: 'assistant.delta', delta };
      }

      yield { type: 'done', detail: '运行完成' };
    } catch (error) {
      yield { type: 'trace', title: 'OpenClaw Gateway', detail: error.message, status: 'error' };
      yield { type: 'done', detail: 'Gateway 运行异常' };
    }
  }

  getInfo() {
    return { mode: 'openclaw', gatewayUrl: this.gatewayUrl };
  }
}
