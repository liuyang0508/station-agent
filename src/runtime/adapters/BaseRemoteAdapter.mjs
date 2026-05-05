/**
 * BaseRemoteAdapter — HTTP 代理适配器基类
 *
 * 提取 OpenCoworkSandboxAdapter、OpenClawGatewayAdapter、HermesRuntime
 * 的公共逻辑，减少代码重复。
 */

import { AgentRuntimeAdapter } from './BaseRuntime.mjs';
import { getCircuitBreaker } from '../../lib/circuitBreaker.mjs';

const DEFAULT_HISTORY_WINDOW = 20;
const DEFAULT_MEMORY_LIMIT = 8;

export class BaseRemoteAdapter extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this.endpoint = context.endpoint || this.getDefaultEndpoint();
    this.name = context.name || this.getAdapterName();
    // Create a circuit breaker for this adapter
    this.circuitBreaker = getCircuitBreaker(`remote-${this.name}`, {
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeoutMs: 30000
    });
  }

  getDefaultEndpoint() {
    return 'http://localhost:8080';
  }

  getAdapterName() {
    return 'remote';
  }

  /**
   * 健康检查 — 子类可覆盖
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.endpoint}${this.getHealthPath()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return {
        ok: response.ok,
        status: response.ok ? 'connected' : 'error',
        message: response.statusText
      };
    } catch (error) {
      return {
        ok: false,
        status: 'network_error',
        message: error.message
      };
    }
  }

  getHealthPath() {
    return '/health';
  }

  /**
   * 构建请求 payload — 子类可覆盖
   */
  buildPayload(prompt, context) {
    const { session, history, settings, skills, memories = [] } = context;

    return {
      prompt,
      ...(session?.id && { session: session.id }),
      history: history.slice(-DEFAULT_HISTORY_WINDOW),
      workspace: settings.workspaceRoot,
      skills: skills.filter(s => s.enabled).map(s => s.name),
      memories: memories.slice(0, DEFAULT_MEMORY_LIMIT).map(m => m.content),
    };
  }

  /**
   * 获取请求路径 — 子类覆盖
   */
  getExecutePath() {
    return '/api/v1/agent';
  }

  /**
   * 获取请求方法 — 子类可覆盖
   */
  getExecuteMethod() {
    return 'POST';
  }

  /**
   * 解析响应 — 子类可覆盖
   */
  parseResponse(result) {
    return result.delta || [];
  }

  /**
   * 提取 delta 列表 — 子类可覆盖
   */
  extractDeltas(result) {
    return this.parseResponse(result);
  }

  /**
   * 通用 runTurn 实现
   */
  async *runTurn(prompt, context) {
    const { tools } = context;

    yield {
      type: 'trace',
      title: this.name,
      detail: `连接 ${this.endpoint}`,
      status: 'running'
    };

    if (tools) {
      yield {
        type: 'trace',
        title: '工具注册',
        detail: `注册 ${tools?.list?.()?.length || 0} 个工具`,
        status: 'ok'
      };
    }

    try {
      const executePath = this.getExecutePath();
      const executeMethod = this.getExecuteMethod();

      // Use circuit breaker to wrap the fetch call
      const response = await this.circuitBreaker.execute(async () => {
        return fetch(`${this.endpoint}${executePath}`, {
          method: executeMethod,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(this.buildPayload(prompt, context)),
          signal: AbortSignal.timeout(120000)
        });
      });

      if (!response.ok) {
        yield {
          type: 'trace',
          title: this.name,
          detail: `执行失败: ${response.statusText}`,
          status: 'error'
        };
        yield { type: 'done', detail: `${this.name} 执行失败` };
        return;
      }

      const result = await response.json();
      const deltas = this.extractDeltas(result);

      for (const delta of deltas) {
        yield { type: 'assistant.delta', delta };
      }

      yield { type: 'done', detail: '运行完成' };
    } catch (error) {
      // Check if circuit breaker is open
      if (error.message === 'Circuit breaker is OPEN') {
        yield {
          type: 'trace',
          title: this.name,
          detail: '服务暂时不可用 (熔断器已触发)，请稍后重试',
          status: 'error'
        };
        yield { type: 'done', detail: '服务熔断中，请稍后重试' };
        return;
      }

      yield {
        type: 'trace',
        title: this.name,
        detail: error.message,
        status: 'error'
      };
      yield { type: 'done', detail: `${this.name} 运行异常` };
    }
  }

  getInfo() {
    return {
      mode: this.getAdapterName(),
      endpoint: this.endpoint,
      circuitState: this.circuitBreaker.getState()
    };
  }
}
