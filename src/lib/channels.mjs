/**
 * Channels — 多渠道消息集成
 *
 * 支持 Slack、Discord、Telegram 等消息平台的接入。
 * 工作原理：
 * 1. 配置各渠道的 Webhook 或 Bot Token
 * 2. 渠道消息通过 HTTP POST 转发到 /api/channels/inbound
 * 3. 消息经过路由匹配后，转发给对应的 session 或创建新 session
 */

import { randomUUID } from 'node:crypto';

/**
 * 渠道类型枚举
 */
export const ChannelType = {
  SLACK: 'slack',
  DISCORD: 'discord',
  TELEGRAM: 'telegram',
  WEBHOOK: 'webhook'  // 通用 Webhook
};

/**
 * 消息事件类型
 */
export const MessageEvent = {
  MESSAGE: 'message',
  MENTION: 'mention',
  DIRECT: 'direct',
  COMMAND: 'command'
};

/**
 * Channel — 单个渠道配置
 */
export class Channel {
  constructor(config) {
    this.id = config.id || randomUUID();
    this.name = config.name;
    this.type = config.type;
    this.enabled = config.enabled !== false;
    this.webhookUrl = config.webhookUrl;
    this.botToken = config.botToken;
    this.chatId = config.chatId;  // Telegram chat ID 或 Discord channel ID
    this.filters = config.filters || {};
    this.createdAt = new Date().toISOString();
  }

  /**
   * 检查消息是否匹配渠道过滤器
   */
  matches(message) {
    if (!this.enabled) return false;

    // 关键词过滤
    if (this.filters.keywords?.length > 0) {
      const hasKeyword = this.filters.keywords.some(kw =>
        message.content.includes(kw)
      );
      if (!hasKeyword) return false;
    }

    // 否定关键词
    if (this.filters.excludeKeywords?.length > 0) {
      const hasExcluded = this.filters.excludeKeywords.some(kw =>
        message.content.includes(kw)
      );
      if (hasExcluded) return false;
    }

    // 消息类型过滤
    if (this.filters.eventTypes?.length > 0) {
      if (!this.filters.eventTypes.includes(message.event)) {
        return false;
      }
    }

    return true;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      chatId: this.chatId,
      filters: this.filters,
      createdAt: this.createdAt
      // 不包含敏感信息
    };
  }
}

/**
 * Channels Manager — 渠道管理器
 */
export class ChannelsManager {
  constructor({ store }) {
    this.store = store;
    this.channels = new Map();
    this.webhookSecrets = new Map();  // channelId -> secret for HMAC verification
    this.messageHandlers = new Set();
    this.outboundQueue = [];  // 待发送消息队列
    this.pollIntervals = new Map();  // Telegram polling intervals

    // 从 store 加载渠道配置
    this._loadChannels();
  }

  _loadChannels() {
    const configs = this.store.listChannels?.() || [];
    for (const config of configs) {
      const channel = new Channel(config);
      this.channels.set(channel.id, channel);

      // 如果有 webhook secret，保存
      if (config.webhookSecret) {
        this.webhookSecrets.set(channel.id, config.webhookSecret);
      }
    }
  }

  /**
   * 添加渠道
   */
  addChannel(config) {
    const channel = new Channel(config);
    this.channels.set(channel.id, channel);

    // 如果是 Telegram，启用 polling
    if (channel.type === ChannelType.TELEGRAM && channel.enabled && channel.botToken) {
      this._startTelegramPolling(channel);
    }

    return channel;
  }

  /**
   * 移除渠道
   */
  removeChannel(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    // 停止 Telegram polling
    if (channel.type === ChannelType.TELEGRAM) {
      this._stopTelegramPolling(channelId);
    }

    this.channels.delete(channelId);
    return true;
  }

  /**
   * 更新渠道
   */
  updateChannel(channelId, updates) {
    const channel = this.channels.get(channelId);
    if (!channel) return null;

    // 如果 Telegram 配置变了，重启 polling
    const needsRestart =
      (channel.type === ChannelType.TELEGRAM) &&
      (updates.botToken !== undefined || updates.enabled !== undefined);

    if (needsRestart) {
      this._stopTelegramPolling(channelId);
    }

    Object.assign(channel, updates);

    if (needsRestart && channel.enabled && channel.botToken) {
      this._startTelegramPolling(channel);
    }

    return channel;
  }

  /**
   * 获取所有渠道
   */
  listChannels() {
    return Array.from(this.channels.values()).map(c => c.toJSON());
  }

  /**
   * 获取单个渠道
   */
  getChannel(channelId) {
    return this.channels.get(channelId)?.toJSON();
  }

  /**
   * 验证 Webhook 签名
   */
  verifySignature(channelId, signature, payload) {
    const secret = this.webhookSecrets.get(channelId);
    if (!secret) return true;  // 没有 secret 则跳过验证

    // 简单的 HMAC 验证（实际应该用 crypto.createHmac）
    const expected = this._hmacSha256(secret, payload);
    return signature === expected;
  }

  _hmacSha256(secret, payload) {
    // Node.js 的 crypto 模块
    const crypto = require('node:crypto');
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * 处理入站消息
   */
  async handleInboundMessage(channelId, message) {
    const channel = this.channels.get(channelId);
    if (!channel || !channel.matches(message)) {
      return { handled: false, reason: 'no_match' };
    }

    // 触发消息处理器
    for (const handler of this.messageHandlers) {
      try {
        const result = await handler(channel, message);
        if (result?.handled) {
          return result;
        }
      } catch (error) {
        console.error(`[Channels] Handler error:`, error.message);
      }
    }

    return { handled: true, channel: channel.toJSON() };
  }

  /**
   * 添加消息处理器
   */
  addMessageHandler(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * 发送出站消息（通用）
   */
  async sendMessage(channelId, content, options = {}) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');

    switch (channel.type) {
      case ChannelType.SLACK:
        return this._sendSlack(channel, content, options);
      case ChannelType.DISCORD:
        return this._sendDiscord(channel, content, options);
      case ChannelType.TELEGRAM:
        return this._sendTelegram(channel, content, options);
      case ChannelType.WEBHOOK:
        return this._sendWebhook(channel, content, options);
      default:
        throw new Error(`Unknown channel type: ${channel.type}`);
    }
  }

  /**
   * 发送 Slack 消息
   */
  async _sendSlack(channel, content, options = {}) {
    if (!channel.webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    const body = {
      text: content,
      ...(options.threadTs && { thread_ts: options.threadTs })
    };

    const response = await fetch(channel.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }

    return { ok: true };
  }

  /**
   * 发送 Discord 消息
   */
  async _sendDiscord(channel, content, options = {}) {
    if (!channel.webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }

    const body = {
      content: content,
      ...(options.embeds && { embeds: options.embeds })
    };

    const response = await fetch(channel.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.statusText}`);
    }

    return { ok: true };
  }

  /**
   * 发送 Telegram 消息
   */
  async _sendTelegram(channel, content, options = {}) {
    if (!channel.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    const apiUrl = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;

    const body = {
      chat_id: channel.chatId,
      text: content,
      parse_mode: 'Markdown'
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.statusText}`);
    }

    return { ok: true };
  }

  /**
   * 发送通用 Webhook
   */
  async _sendWebhook(channel, content, options = {}) {
    if (!channel.webhookUrl) {
      throw new Error('Webhook URL not configured');
    }

    const body = {
      channel: channel.name,
      content,
      timestamp: new Date().toISOString(),
      ...options
    };

    const response = await fetch(channel.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.statusText}`);
    }

    return { ok: true };
  }

  /**
   * 启动 Telegram Long Polling
   */
  _startTelegramPolling(channel) {
    if (this.pollIntervals.has(channel.id)) return;

    let offset = 0;

    const poll = async () => {
      try {
        const updates = await this._telegramGetUpdates(channel.botToken, offset);
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);

          if (update.message) {
            const message = {
              id: update.message.message_id,
              content: update.message.text || update.message.caption || '',
              event: update.message.chat.id.toString() === channel.chatId
                ? MessageEvent.DIRECT
                : MessageEvent.MENTION,
              userId: update.message.from?.id,
              chatId: update.message.chat.id,
              timestamp: new Date(update.message.date * 1000).toISOString()
            };

            await this.handleInboundMessage(channel.id, message);
          }
        }
      } catch (error) {
        console.error(`[Channels/Telegram] Poll error:`, error.message);
      }
    };

    // 立即执行一次，然后每 1 秒轮询
    poll();
    const interval = setInterval(poll, 1000);
    this.pollIntervals.set(channel.id, interval);
  }

  /**
   * 停止 Telegram Long Polling
   */
  _stopTelegramPolling(channelId) {
    const interval = this.pollIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(channelId);
    }
  }

  /**
   * Telegram getUpdates API
   */
  async _telegramGetUpdates(botToken, offset) {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=0`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return data.ok ? data.result : [];
  }

  /**
   * 解析 Slack 事件
   */
  parseSlackEvent(payload) {
    // Slack URL verification
    if (payload.type === 'url_verification') {
      return { handled: true, response: payload.challenge };
    }

    // Slack events API
    if (payload.event) {
      return {
        channelId: payload.team_id,
        message: {
          id: payload.event_ts,
          content: payload.event.text || '',
          event: payload.event.type === 'message' && payload.event.channel_type === 'direct'
            ? MessageEvent.DIRECT
            : MessageEvent.MENTION,
          userId: payload.event.user
        }
      };
    }

    return null;
  }

  /**
   * 解析 Discord 事件
   */
  parseDiscordEvent(payload) {
    if (payload.event === 'MESSAGE_CREATE') {
      return {
        channelId: payload.d.guild_id,
        message: {
          id: payload.d.id,
          content: payload.d.content,
          event: payload.d.channel_type === 1
            ? MessageEvent.DIRECT
            : MessageEvent.MESSAGE,
          userId: payload.d.author?.id
        }
      };
    }
    return null;
  }

  /**
   * 解析 Telegram 更新
   */
  parseTelegramUpdate(update) {
    if (update.message) {
      return {
        message: {
          id: update.message.message_id,
          content: update.message.text || '',
          event: MessageEvent.MESSAGE,
          userId: update.message.from?.id,
          chatId: update.message.chat.id
        }
      };
    }
    return null;
  }

  /**
   * 停止所有轮询
   */
  stop() {
    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
  }
}

/**
 * 创建 ChannelsManager 实例
 */
export function createChannelsManager(store) {
  return new ChannelsManager({ store });
}
