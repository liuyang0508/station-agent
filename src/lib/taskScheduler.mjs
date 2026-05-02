import { parseCronExpression } from './utils.mjs';

const SCHEDULER_INTERVAL_MS = 30000; // 30 seconds

export class TaskScheduler {
  constructor({ store, subagentManager }) {
    this.store = store;
    this.subagentManager = subagentManager;
    this.interval = null;
    this.lastRunTimes = new Map();
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

  async _tick() {
    const tasks = this.store.listTasks().filter(t => t.status === 'active' || t.status === 'paused');
    for (const task of tasks) {
      if (task.status === 'paused') continue;
      if (this._shouldRun(task)) {
        await this._executeTask(task);
      }
    }
  }

  _shouldRun(task) {
    const cadence = task.cadence;
    if (!cadence || cadence === 'realtime') return true;

    const lastRun = this.lastRunTimes.get(task.id) || 0;
    const now = Date.now();

    // weekday 18:30
    const weekdayMatch = cadence.match(/weekday\s+(\d{1,2}):(\d{2})/);
    if (weekdayMatch) {
      const [_, hourStr, minStr] = weekdayMatch;
      const hour = parseInt(hourStr);
      const min = parseInt(minStr);
      const nowDate = new Date();
      const dayOfWeek = nowDate.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const scheduledMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hour, min).getTime();
        if (now >= scheduledMs && lastRun < scheduledMs) {
          this.lastRunTimes.set(task.id, now);
          return true;
        }
      }
      return false;
    }

    // hourly
    if (cadence === 'hourly') {
      return now - lastRun >= 3600000;
    }

    // daily
    const dailyMatch = cadence.match(/daily\s+(\d{1,2}):(\d{2})/);
    if (dailyMatch) {
      const [_, hourStr, minStr] = dailyMatch;
      const hour = parseInt(hourStr);
      const min = parseInt(minStr);
      const nowDate = new Date();
      const scheduledMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hour, min).getTime();
      if (now >= scheduledMs && lastRun < scheduledMs) {
        this.lastRunTimes.set(task.id, now);
        return true;
      }
      return false;
    }

    // interval in minutes
    const intervalMatch = cadence.match(/every\s+(\d+)\s*min/);
    if (intervalMatch) {
      const minutes = parseInt(intervalMatch[1]);
      return now - lastRun >= minutes * 60000;
    }

    return false;
  }

  async _executeTask(task) {
    console.log(`[TaskScheduler] Executing: ${task.title} (${task.cadence})`);
    this.lastRunTimes.set(task.id, Date.now());

    switch (task.target) {
      case 'client inbox':
        // TODO: send notification to connected clients
        console.log(`[TaskScheduler] Task "${task.title}" would notify client inbox`);
        break;
      case 'gateway':
        // TODO: send to external gateway
        console.log(`[TaskScheduler] Task "${task.title}" would send to gateway`);
        break;
      case 'subagent':
        this.subagentManager.spawn({
          task: task.title,
          parentSessionId: null,
          priority: 'low'
        });
        break;
      default:
        if (task.command) {
          // Direct tool call
        }
    }

    // Update last run
    this.store.updateTask?.(task.id, { lastRunAt: new Date().toISOString() });
  }
}
