import { BaseRemoteAdapter } from './BaseRemoteAdapter.mjs';

/**
 * OpenClawGatewayAdapter — OpenClaw 多通道消息网关适配器
 *
 * 连接本地部署的 OpenClaw Gateway，用于多设备/多节点协调
 */
export class OpenClawGatewayAdapter extends BaseRemoteAdapter {
  getAdapterName() {
    return 'openclaw';
  }

  getDefaultEndpoint() {
    return 'http://localhost:7891';
  }

  getHealthPath() {
    return '/api/health';
  }

  getExecutePath() {
    return '/api/v1/agent';
  }

  /**
   * OpenClaw 支持 session 亲和性
   */
  buildPayload(prompt, context) {
    const payload = super.buildPayload(prompt, context);
    if (context.session?.id) {
      payload.session = context.session.id;
    }
    return payload;
  }
}
