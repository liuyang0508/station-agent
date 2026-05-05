/**
 * RemoteControl — 跨设备 Session 迁移
 *
 * 允许用户将当前工作从一台设备迁移到另一台设备。
 * 工作原理：
 * 1. 当前设备生成一个一次性"迁移票据"
 * 2. 票据通过 URL 或二维码分享到目标设备
 * 3. 目标设备使用票据获取完整的 session 状态
 * 4. 迁移后原 session 被标记为"已移交"
 */

import { randomUUID } from 'node:crypto';

const TICKET_EXPIRY_MS = 5 * 60 * 1000;  // 5 minutes
const TICKET_LENGTH = 8;  // 短码长度

/**
 * 生成短码票据
 */
function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < TICKET_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * RemoteControl — 会话迁移控制器
 */
export class RemoteControl {
  constructor({ store }) {
    this.store = store;
    this.pendingTickets = new Map();  // shortCode -> ticket
    this.cleanupInterval = null;

    // 启动清理定时器
    this._startCleanup();
  }

  _startCleanup() {
    // 每分钟清理过期票据
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [code, ticket] of this.pendingTickets.entries()) {
        if (now > ticket.expiresAt) {
          this.pendingTickets.delete(code);
        }
      }
    }, 60000);
  }

  /**
   * 停止清理定时器
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 创建迁移票据
   * @param {string} sessionId - 要迁移的 session ID
   * @param {Object} options - 配置选项
   * @returns {Object} - { shortCode, fullCode, expiresAt, ticketUrl }
   */
  createTicket(sessionId, options = {}) {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const messages = this.store.listMessages(sessionId);
    const skills = this.store.listSkills();
    const memories = this.store.listMemories();

    // 生成唯一短码
    let shortCode;
    do {
      shortCode = generateShortCode();
    } while (this.pendingTickets.has(shortCode));

    const ticketId = randomUUID();
    const expiresAt = Date.now() + TICKET_EXPIRY_MS;

    const ticket = {
      id: ticketId,
      shortCode,
      sessionId,
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        workspaceRoot: session.workspaceRoot,
        createdAt: session.createdAt
      },
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      })),
      skills: skills.filter(s => s.enabled).map(s => s.id),
      memories: memories.slice(0, 20).map(m => ({
        id: m.id,
        title: m.title,
        content: m.content
      })),
      createdAt: new Date().toISOString(),
      expiresAt,
      used: false
    };

    this.pendingTickets.set(shortCode, ticket);

    // 生成完整票据码（用于 URL）
    const fullCode = Buffer.from(JSON.stringify({
      id: ticketId,
      short: shortCode
    })).toString('base64url');

    // 生成迁移 URL
    const ticketUrl = options.baseUrl
      ? `${options.baseUrl}/teleport?code=${fullCode}`
      : null;

    return {
      shortCode,
      fullCode,
      expiresAt,
      ticketUrl,
      ticketId
    };
  }

  /**
   * 使用票据恢复会话
   * @param {string} code - 短码或完整票据码
   * @returns {Object} - 恢复的 session 数据
   */
  async redeemTicket(code) {
    // 尝试短码
    let shortCode = code;

    // 如果是完整码（base64url），解码获取短码
    if (!this.pendingTickets.has(code)) {
      try {
        const decoded = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
        shortCode = decoded.short;
      } catch {
        throw new Error('Invalid ticket code');
      }
    }

    const ticket = this.pendingTickets.get(shortCode);
    if (!ticket) {
      throw new Error('Ticket not found or expired');
    }

    if (ticket.used) {
      throw new Error('Ticket already used');
    }

    if (Date.now() > ticket.expiresAt) {
      this.pendingTickets.delete(shortCode);
      throw new Error('Ticket expired');
    }

    // 标记为已使用
    ticket.used = true;

    // 创建新 session
    const newSession = this.store.createSession({
      title: `[已迁移] ${ticket.session.title}`,
      workspaceRoot: ticket.session.workspaceRoot
    });

    // 恢复消息
    for (const msg of ticket.messages) {
      this.store.addMessage({
        sessionId: newSession.id,
        role: msg.role,
        content: msg.content
      });
    }

    // 记录迁移历史
    this.store.updateSession(newSession.id, {
      migratedFrom: ticket.sessionId,
      migratedAt: new Date().toISOString()
    });

    return {
      session: newSession,
      messages: ticket.messages,
      skills: ticket.skills,
      memories: ticket.memories
    };
  }

  /**
   * 获取待使用票据
   */
  listPendingTickets() {
    const now = Date.now();
    const tickets = [];
    for (const ticket of this.pendingTickets.values()) {
      if (!ticket.used && now <= ticket.expiresAt) {
        tickets.push({
          shortCode: ticket.shortCode,
          sessionTitle: ticket.session.title,
          expiresAt: ticket.expiresAt,
          remainingMs: ticket.expiresAt - now
        });
      }
    }
    return tickets;
  }

  /**
   * 取消票据
   */
  cancelTicket(shortCode) {
    return this.pendingTickets.delete(shortCode);
  }

  /**
   * 生成二维码数据（供外部生成二维码使用）
   */
  getQrData(ticket) {
    return JSON.stringify({
      type: 'station-agent-teleport',
      code: ticket.fullCode,
      title: ticket.sessionTitle
    });
  }
}

/**
 * 创建 RemoteControl 实例
 */
export function createRemoteControl(store) {
  return new RemoteControl({ store });
}
