import { BaseRemoteAdapter } from './BaseRemoteAdapter.mjs';

/**
 * OpenCoworkSandboxAdapter — OpenCowork 沙箱适配器
 *
 * 连接 OpenCowork 沙箱服务，支持 WSL2/Lima/Docker 平台自动检测
 */
export class OpenCoworkSandboxAdapter extends BaseRemoteAdapter {
  constructor(context) {
    super(context);
    this.platform = context.platform || this._detectPlatform();
  }

  _detectPlatform() {
    if (process.platform === 'win32') return 'wsl2';
    if (process.platform === 'darwin') return 'lima';
    return 'docker';
  }

  getAdapterName() {
    return 'opencowork';
  }

  getDefaultEndpoint() {
    return 'http://localhost:7892';
  }

  getHealthPath() {
    return '/api/health';
  }

  getExecutePath() {
    return '/api/v1/sandbox/execute';
  }

  /**
   * OpenCowork 需要 platform 参数
   */
  buildPayload(prompt, context) {
    return {
      ...super.buildPayload(prompt, context),
      platform: this.platform,
    };
  }

  getInfo() {
    return {
      mode: 'opencowork',
      platform: this.platform,
      endpoint: this.endpoint
    };
  }
}
