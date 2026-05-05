/**
 * Routines — 云端定时任务
 *
 * 支持在客户端关闭时仍能执行的定时任务。
 * 实现方式：
 * 1. 将任务持久化到 store
 * 2. 支持 webhook trigger（外部服务调用触发）
 * 3. 支持 cron-style scheduling
 * 4. 任务执行结果回调通知
 */

import { randomUUID } from 'node:crypto';

/**
 * Routine 状态
 */
export const RoutineStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Routine 触发类型
 */
export const RoutineTrigger = {
  SCHEDULE: 'schedule',       // 定时触发
  WEBHOOK: 'webhook',       // Webhook 触发
  EVENT: 'event'             // 事件触发（如 GitHub webhook）
};

/**
 * Routine — 单个定时任务
 */
export class Routine {
  constructor(config) {
    this.id = config.id || randomUUID();
    this.name = config.name || 'Untitled Routine';
    this.description = config.description || '';

    // 触发配置
    this.trigger = config.trigger || RoutineTrigger.SCHEDULE;
    this.schedule = config.schedule || null;  // cron 表达式或 human-readable
    this.webhookPath = config.webhookPath || `/api/routines/${this.id}/trigger`;
    this.events = config.events || [];  // 支持的事件类型

    // 执行配置
    this.action = config.action || 'notify';  // notify, webhook, skill, subagent
    this.actionConfig = config.actionConfig || {};

    // 状态
    this.status = config.status || RoutineStatus.ACTIVE;
    this.lastRunAt = config.lastRunAt || null;
    this.lastResult = config.lastResult || null;
    this.nextRunAt = config.nextRunAt || null;
    this.runCount = config.runCount || 0;
    this.runHistory = [];

    // 时间戳
    this.createdAt = config.createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  /**
   * 计算下次执行时间
   */
  calculateNextRun() {
    if (!this.schedule || this.status !== RoutineStatus.ACTIVE) {
      return null;
    }

    const now = Date.now();
    const next = parseCronNext(this.schedule, now);
    this.nextRunAt = next ? new Date(next).toISOString() : null;
    return this.nextRunAt;
  }

  /**
   * 记录执行结果
   */
  recordRun(result) {
    this.lastRunAt = new Date().toISOString();
    this.lastResult = result;
    this.runCount++;

    this.runHistory.push({
      id: randomUUID(),
      executedAt: this.lastRunAt,
      result,
      success: result?.success !== false
    });

    // 只保留最近 100 条历史
    if (this.runHistory.length > 100) {
      this.runHistory = this.runHistory.slice(-100);
    }

    // 更新下次执行时间
    this.calculateNextRun();
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      trigger: this.trigger,
      schedule: this.schedule,
      webhookPath: this.webhookPath,
      events: this.events,
      action: this.action,
      actionConfig: this.actionConfig,
      status: this.status,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      nextRunAt: this.nextRunAt,
      runCount: this.runCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

/**
 * Routines Manager — 定时任务管理器
 */
export class RoutinesManager {
  constructor({ store, taskScheduler, channelsManager }) {
    this.store = store;
    this.taskScheduler = taskScheduler;
    this.channelsManager = channelsManager;
    this.routines = new Map();
    this.webhookSecrets = new Map();
    this.pollInterval = null;

    // 从 store 加载 routines
    this._loadRoutines();
  }

  _loadRoutines() {
    const configs = this.store.listRoutines?.() || [];
    for (const config of configs) {
      const routine = new Routine(config);
      this.routines.set(routine.id, routine);

      // 重新计算下次执行时间
      routine.calculateNextRun();

      // 如果有 webhook secret，保存
      if (config.webhookSecret) {
        this.webhookSecrets.set(routine.id, config.webhookSecret);
      }
    }
  }

  /**
   * 创建 Routine
   */
  createRoutine(config) {
    const routine = new Routine(config);
    routine.calculateNextRun();
    this.routines.set(routine.id, routine);
    this._persistRoutine(routine);
    return routine.toJSON();
  }

  /**
   * 获取 Routine
   */
  getRoutine(id) {
    return this.routines.get(id)?.toJSON();
  }

  /**
   * 更新 Routine
   */
  updateRoutine(id, updates) {
    const routine = this.routines.get(id);
    if (!routine) return null;

    Object.assign(routine, updates);
    routine.calculateNextRun();
    routine.updatedAt = new Date().toISOString();

    this._persistRoutine(routine);
    return routine.toJSON();
  }

  /**
   * 删除 Routine
   */
  deleteRoutine(id) {
    const deleted = this.routines.delete(id);
    if (deleted) {
      this.store.deleteRoutine?.(id);
    }
    return deleted;
  }

  /**
   * 列出所有 Routine
   */
  listRoutines() {
    return Array.from(this.routines.values()).map(r => r.toJSON());
  }

  /**
   * 列出活跃的 Routine
   */
  listActiveRoutines() {
    return Array.from(this.routines.values())
      .filter(r => r.status === RoutineStatus.ACTIVE)
      .map(r => r.toJSON());
  }

  /**
   * 触发 Routine（手动或 webhook）
   */
  async trigger(id, payload = {}) {
    const routine = this.routines.get(id);
    if (!routine) {
      throw new Error('Routine not found');
    }

    if (routine.status !== RoutineStatus.ACTIVE) {
      throw new Error('Routine is not active');
    }

    try {
      const result = await this._executeRoutine(routine, payload);
      routine.recordRun({ success: true, result });
      this._persistRoutine(routine);
      return result;
    } catch (error) {
      routine.recordRun({ success: false, error: error.message });
      this._persistRoutine(routine);
      throw error;
    }
  }

  /**
   * 执行 Routine
   */
  async _executeRoutine(routine, payload) {
    switch (routine.action) {
      case 'notify':
        return this._actionNotify(routine, payload);
      case 'webhook':
        return this._actionWebhook(routine, payload);
      case 'skill':
        return this._actionSkill(routine, payload);
      case 'subagent':
        return this._actionSubagent(routine, payload);
      case 'routine':
        return this._actionRoutine(routine, payload);
      default:
        throw new Error(`Unknown action: ${routine.action}`);
    }
  }

  async _actionNotify(routine, payload) {
    const { message, channelId } = routine.actionConfig;

    if (channelId) {
      // 通过 Channels 发送
      if (this.channelsManager) {
        await this.channelsManager.sendMessage(channelId, message || routine.name);
      }
    } else {
      // TODO: 实现应用内通知
      console.log(`[Routines] Would notify: ${routine.name}`);
    }

    return { notified: true };
  }

  async _actionWebhook(routine, payload) {
    const { url, method, headers, body } = routine.actionConfig;
    if (!url) throw new Error('Webhook URL not configured');

    const response = await fetch(url, {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({
        routine: routine.id,
        routineName: routine.name,
        triggeredAt: new Date().toISOString(),
        payload,
        ...(body && typeof body === 'object' ? body : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.statusText}`);
    }

    const result = await response.json().catch(() => ({}));
    return { webhook: true, response: result };
  }

  async _actionSkill(routine, payload) {
    const { skillId, input } = routine.actionConfig;
    if (!skillId) throw new Error('Skill ID not configured');

    // TODO: 集成 skill 执行
    console.log(`[Routines] Would run skill: ${skillId}`);
    return { skillId, executed: true };
  }

  async _actionSubagent(routine, payload) {
    const { task, priority } = routine.actionConfig;

    // TODO: 集成 subagent
    console.log(`[Routines] Would spawn subagent: ${task}`);
    return { subagent: true, task };
  }

  async _actionRoutine(routine, payload) {
    // 触发另一个 routine
    const { targetRoutineId, targetPayload } = routine.actionConfig;
    if (!targetRoutineId) throw new Error('Target routine not configured');

    return this.trigger(targetRoutineId, { ...targetPayload, ...payload });
  }

  /**
   * 验证 webhook 签名
   */
  verifyWebhookSignature(routineId, signature, payload) {
    const secret = this.webhookSecrets.get(routineId);
    if (!secret) return true;  // 没有 secret 则跳过验证

    // 简单的 HMAC 验证
    const crypto = require('node:crypto');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === `sha256=${expected}`;
  }

  /**
   * 设置 webhook secret
   */
  setWebhookSecret(routineId, secret) {
    this.webhookSecrets.set(routineId, secret);
  }

  /**
   * 获取 webhook URL
   */
  getWebhookUrl(routineId, baseUrl) {
    const routine = this.routines.get(routineId);
    if (!routine) return null;
    return `${baseUrl}${routine.webhookPath}`;
  }

  /**
   * 启动轮询（检查定时任务）
   */
  start() {
    if (this.pollInterval) return;

    // 每分钟检查一次
    this.pollInterval = setInterval(() => {
      this._checkScheduled();
    }, 60000);

    // 立即检查一次
    this._checkScheduled();
  }

  /**
   * 停止轮询
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * 检查定时任务
   */
  async _checkScheduled() {
    const now = Date.now();

    for (const routine of this.routines.values()) {
      if (routine.status !== RoutineStatus.ACTIVE) continue;
      if (routine.trigger !== RoutineTrigger.SCHEDULE) continue;

      const nextRun = routine.nextRunAt ? new Date(routine.nextRunAt).getTime() : null;
      if (nextRun && nextRun <= now) {
        try {
          await this.trigger(routine.id);
        } catch (error) {
          console.error(`[Routines] Failed to trigger ${routine.name}:`, error.message);
        }
      }
    }
  }

  /**
   * 持久化 Routine
   */
  _persistRoutine(routine) {
    try {
      this.store.saveRoutine?.(routine.toJSON());
    } catch (error) {
      console.warn(`[Routines] Failed to persist:`, error.message);
    }
  }

  /**
   * 获取执行历史
   */
  getHistory(id, limit = 10) {
    const routine = this.routines.get(id);
    if (!routine) return [];
    return routine.runHistory.slice(-limit);
  }
}

/**
 * 解析 cron 表达式，计算下次执行时间（简化版）
 */
function parseCronNext(cron, now) {
  // 支持简化格式：
  // "daily HH:MM" -> 每天指定时间
  // "hourly" -> 每小时
  // "every N min" -> 每 N 分钟

  const dailyMatch = cron.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const [, hour, min] = dailyMatch.map(Number);
    const date = new Date(now);
    date.setHours(hour, min, 0, 0);
    if (date.getTime() <= now) {
      date.setDate(date.getDate() + 1);
    }
    return date.getTime();
  }

  if (cron === 'hourly') {
    const date = new Date(now);
    date.setMinutes(date.getMinutes() + 1, 0, 0);
    return date.getTime();
  }

  const everyMinMatch = cron.match(/^every\s+(\d+)\s*min$/);
  if (everyMinMatch) {
    const mins = Number(everyMinMatch[1]);
    const date = new Date(now);
    date.setMinutes(date.getMinutes() + mins, 0, 0);
    return date.getTime();
  }

  return null;
}

/**
 * 创建 RoutinesManager 实例
 */
export function createRoutinesManager(store, options = {}) {
  return new RoutinesManager(store, options);
}
