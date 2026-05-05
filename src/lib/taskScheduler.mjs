/**
 * TaskScheduler — 定时任务调度器
 *
 * 支持的 cadence 类型:
 * - "once" / "realtime": 立即执行
 * - "hourly": 每小时
 * - "daily HH:MM": 每天定点
 * - "weekday HH:MM": 工作日定点
 * - "weekly DAY HH:MM": 每周定点
 * - "monthly DD HH:MM": 每月定点
 * - "every N min": 间隔执行
 */

import { wait } from '../runtime/agentRuntime.mjs';

const SCHEDULER_INTERVAL_MS = 30000; // 30 seconds

export class TaskScheduler {
  constructor({ store, subagentManager }) {
    this.store = store;
    this.subagentManager = subagentManager;
    this.interval = null;
    this.lastRunTimes = new Map();
    this.runningTasks = new Map();  // 防止重复执行
    this.listeners = new Set();       // 事件监听器
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this._tick(), SCHEDULER_INTERVAL_MS);
    console.log('[TaskScheduler] Started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[TaskScheduler] Stopped');
    }
  }

  /**
   * 添加事件监听器
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 触发事件
   */
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[TaskScheduler] Listener error:', error.message);
      }
    }
  }

  async _tick() {
    const tasks = this.store.listTasks?.() || [];
    const activeTasks = tasks.filter(t => t.status === 'active' || t.status === 'paused');

    for (const task of activeTasks) {
      if (task.status === 'paused') continue;
      if (this._shouldRun(task)) {
        // 防止同一任务重复执行
        if (this.runningTasks.has(task.id)) {
          continue;
        }
        await this._executeTask(task);
      }
    }
  }

  _shouldRun(task) {
    const cadence = task.cadence;
    if (!cadence || cadence === 'realtime') return false;  // realtime 需要手动触发
    if (cadence === 'once') {
      // once 类型只在首次运行时执行
      if (task.lastRunAt) return false;
      return true;
    }

    const lastRun = this.lastRunTimes.get(task.id) || (task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0);
    const now = Date.now();

    // hourly
    if (cadence === 'hourly') {
      return now - lastRun >= 3600000;
    }

    // every N min
    const everyMinMatch = cadence.match(/every\s+(\d+)\s*min/);
    if (everyMinMatch) {
      const minutes = parseInt(everyMinMatch[1]);
      return now - lastRun >= minutes * 60000;
    }

    // daily HH:MM
    const dailyMatch = cadence.match(/^daily\s+(\d{1,2}):(\d{2})$/);
    if (dailyMatch) {
      return this._checkDaily(dailyMatch, lastRun, now);
    }

    // weekday HH:MM
    const weekdayMatch = cadence.match(/^weekday\s+(\d{1,2}):(\d{2})$/);
    if (weekdayMatch) {
      return this._checkWeekday(weekdayMatch, lastRun, now);
    }

    // weekly DAY HH:MM (e.g., "weekly mon 09:00")
    const weeklyMatch = cadence.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (weeklyMatch) {
      return this._checkWeekly(weeklyMatch, lastRun, now);
    }

    // monthly DD HH:MM (e.g., "monthly 15 09:00")
    const monthlyMatch = cadence.match(/^monthly\s+(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (monthlyMatch) {
      return this._checkMonthly(monthlyMatch, lastRun, now);
    }

    return false;
  }

  _checkDaily(dailyMatch, lastRun, now) {
    const [, hourStr, minStr] = dailyMatch;
    const hour = parseInt(hourStr);
    const min = parseInt(minStr);
    const nowDate = new Date(now);

    const scheduledMs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
      hour, min
    ).getTime();

    return now >= scheduledMs && lastRun < scheduledMs;
  }

  _checkWeekday(weekdayMatch, lastRun, now) {
    const [, hourStr, minStr] = weekdayMatch;
    const hour = parseInt(hourStr);
    const min = parseInt(minStr);
    const nowDate = new Date(now);
    const dayOfWeek = nowDate.getDay();

    // 1-5 是工作日
    if (dayOfWeek < 1 || dayOfWeek > 5) return false;

    const scheduledMs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
      hour, min
    ).getTime();

    return now >= scheduledMs && lastRun < scheduledMs;
  }

  _checkWeekly(weeklyMatch, lastRun, now) {
    const [, dayStr, hourStr, minStr] = weeklyMatch;
    const hour = parseInt(hourStr);
    const min = parseInt(minStr);

    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const targetDay = dayMap[dayStr.toLowerCase()];
    if (targetDay === undefined) return false;

    const nowDate = new Date(now);
    const dayOfWeek = nowDate.getDay();

    if (dayOfWeek !== targetDay) return false;

    const scheduledMs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
      hour, min
    ).getTime();

    return now >= scheduledMs && lastRun < scheduledMs;
  }

  _checkMonthly(monthlyMatch, lastRun, now) {
    const [, dayStr, hourStr, minStr] = monthlyMatch;
    const day = parseInt(dayStr);
    const hour = parseInt(hourStr);
    const min = parseInt(minStr);

    const nowDate = new Date(now);
    if (nowDate.getDate() !== day) return false;

    const scheduledMs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      day,
      hour, min
    ).getTime();

    return now >= scheduledMs && lastRun < scheduledMs;
  }

  async _executeTask(task) {
    console.log(`[TaskScheduler] Executing: ${task.title} (${task.cadence})`);

    // 标记为运行中
    this.runningTasks.set(task.id, true);
    this.lastRunTimes.set(task.id, Date.now());

    // 触发开始事件
    this.emit({ type: 'task.start', task });

    try {
      switch (task.action) {
        case 'notify':
          await this._notifyClient(task);
          break;
        case 'gateway':
          await this._sendToGateway(task);
          break;
        case 'subagent':
          await this._spawnSubagent(task);
          break;
        case 'webhook':
          await this._callWebhook(task);
          break;
        case 'skill':
          await this._runSkill(task);
          break;
        default:
          if (task.command) {
            await this._runCommand(task);
          }
      }

      // 更新任务状态
      const now = new Date().toISOString();
      this.store.updateTask?.(task.id, {
        lastRunAt: now,
        runCount: (task.runCount || 0) + 1,
        lastStatus: 'success'
      });

      this.emit({ type: 'task.complete', task, result: { success: true } });
    } catch (error) {
      console.error(`[TaskScheduler] Task "${task.title}" failed:`, error.message);

      this.store.updateTask?.(task.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'error',
        lastError: error.message
      });

      this.emit({ type: 'task.error', task, error: error.message });
    } finally {
      this.runningTasks.delete(task.id);

      // 如果是 once 类型，标记为完成
      if (task.cadence === 'once') {
        this.store.updateTask?.(task.id, { status: 'completed' });
      }
    }
  }

  async _notifyClient(task) {
    console.log(`[TaskScheduler] Task "${task.title}" would notify client inbox`);
    // TODO: 实现客户端通知
  }

  async _sendToGateway(task) {
    console.log(`[TaskScheduler] Task "${task.title}" would send to gateway`);
    // TODO: 实现网关发送
  }

  async _spawnSubagent(task) {
    if (!this.subagentManager) return;

    this.subagentManager.spawn({
      task: task.title,
      parentSessionId: null,
      priority: task.priority || 'normal'
    });
  }

  async _callWebhook(task) {
    if (!task.webhookUrl) return;

    const response = await fetch(task.webhookUrl, {
      method: task.webhookMethod || 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: task.title,
        executedAt: new Date().toISOString(),
        data: task.webhookData || {}
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.statusText}`);
    }
  }

  async _runSkill(task) {
    if (!task.skillId) return;

    // TODO: 集成 skill 执行
    console.log(`[TaskScheduler] Would run skill: ${task.skillId}`);
  }

  async _runCommand(task) {
    if (!task.command) return;

    const { runReadOnlyCommand } = await import('./commandRunner.mjs');
    const result = await runReadOnlyCommand({
      command: task.command,
      cwd: task.cwd || process.cwd(),
      workspaceRoot: task.workspaceRoot || process.cwd(),
      timeoutMs: task.timeoutMs || 60000
    });

    if (!result.ok) {
      throw new Error(`Command failed: ${result.stderr || result.exitCode}`);
    }

    return result.stdout;
  }

  /**
   * 手动触发一个任务
   */
  async trigger(taskId) {
    const tasks = this.store.listTasks?.() || [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    await this._executeTask(task);
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    return {
      running: this.interval !== null,
      activeTasks: Array.from(this.runningTasks.keys()),
      lastTick: this.lastRunTimes.size > 0 ? new Date(Math.max(...this.lastRunTimes.values())) : null
    };
  }
}
