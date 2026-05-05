import { BaseRemoteAdapter } from './BaseRemoteAdapter.mjs';

/**
 * HermesRuntime — Hermes CLI HTTP 适配器
 *
 * 注释: Hermes CLI via WebSocket (实际使用 HTTP)
 * 如果需要 WebSocket 支持，请实现 HermesWebSocketAdapter
 */
export class HermesRuntime extends BaseRemoteAdapter {
  getAdapterName() {
    return 'hermes';
  }

  getDefaultEndpoint() {
    return 'http://localhost:7890';
  }

  getHealthPath() {
    return '/health';
  }

  getExecutePath() {
    return '/v1/agent/run';
  }
}
