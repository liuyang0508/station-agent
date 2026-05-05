import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

export class JavaScriptSandbox {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async run(code, context = {}) {
    const output = { stdout: '', stderr: '' };

    const sandbox = {
      console: {
        log: (...args) => { output.stdout += args.map(String).join(' ') + '\n'; },
        error: (...args) => { output.stderr += args.map(String).join(' ') + '\n'; },
        warn: (...args) => { output.stdout += '[warn] ' + args.map(String).join(' ') + '\n'; },
        info: (...args) => { output.stdout += args.map(String).join(' ') + '\n'; }
      },
      JSON,
      Math,
      Date,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      Promise,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      encodeURIComponent,
      decodeURIComponent,
      isNaN,
      isFinite,
      parseInt,
      parseFloat,
      crypto: { randomUUID: () => randomUUID() },
      setTimeout: (fn, ms) => {
        if (ms > 5000) throw new Error('setTimeout max 5s');
        return setTimeout(fn, ms);
      },
      clearTimeout,
      fetch: globalThis.fetch,
      Buffer,
      Uint8Array,
      ...context
    };

    try {
      const script = new vm.Script(code, { timeout: this.timeoutMs });
      const ctx = vm.createContext(sandbox);
      const result = script.runInContext(ctx, { timeout: this.timeoutMs });
      return {
        ok: true,
        result: result !== undefined ? String(result) : undefined,
        stdout: output.stdout,
        stderr: output.stderr
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        stdout: output.stdout,
        stderr: output.stderr
      };
    }
  }
}

export class PythonSandbox {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async run(code, context = {}) {
    const output = { stdout: '', stderr: '' };
    const startTime = Date.now();

    // Serialize context to JSON and pass to python via environment
    const serializedContext = Buffer.from(JSON.stringify(context)).toString('base64');

    const childCode = `
import sys
import os
import json
import traceback

_context_json = os.environ.get('SANDBOX_CONTEXT', '{}')
try:
    _context = json.loads(_context_json)
except:
    _context = {}

exec('''${code.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}\''')
`;
    const env = { ...process.env, SANDBOX_CONTEXT: serializedContext };

    return new Promise((resolve) => {
      const child = spawn('python3', ['-u', '-c', childCode], {
        timeout: this.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

      child.on('error', (err) => {
        resolve({ ok: false, error: err.message, stdout, stderr });
      });

      child.on('close', (exitCode) => {
        resolve({
          ok: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startTime
        });
      });
    });
  }
}

export class SandboxExecutor {
  constructor(options = {}) {
    this.jsSandbox = new JavaScriptSandbox(options);
    this.pySandbox = new PythonSandbox(options);
  }

  async execute(code, language, context = {}) {
    if (language === 'javascript' || language === 'js' || language === 'mjs') {
      return this.jsSandbox.run(code, context);
    }
    if (language === 'python' || language === 'py') {
      return this.pySandbox.run(code, context);
    }
    return { ok: false, error: `Unsupported language: ${language}` };
  }

  detectLanguage(entrypoint) {
    if (!entrypoint) return 'shell';
    if (entrypoint.endsWith('.mjs') || entrypoint.endsWith('.js')) return 'javascript';
    if (entrypoint.endsWith('.py')) return 'python';
    return 'shell';
  }
}

export class SubagentManager {
  constructor({ store, settings }) {
    this.store = store;
    this.settings = settings;
    this.activeSubagents = new Map();
    this.listeners = new Set();
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
        console.warn('[SubagentManager] Listener error:', error.message);
      }
    }
  }

  /**
   * 创建子任务
   */
  spawn({ task, parentSessionId, priority = 'normal', timeoutMs = 300000 }) {
    const subagentId = randomUUID();
    const session = this.store.createSession({
      title: `子任务: ${String(task).slice(0, 50)}`,
      workspaceRoot: this.settings.workspaceRoot
    });

    const subagent = {
      id: subagentId,
      sessionId: session.id,
      task,
      parentSessionId,
      priority,
      status: 'running',
      createdAt: new Date().toISOString(),
      timeoutMs,
      timeoutHandle: null
    };

    // 设置超时
    subagent.timeoutHandle = setTimeout(() => {
      this.fail(subagentId, 'Timeout');
    }, timeoutMs);

    this.activeSubagents.set(subagentId, subagent);
    this.store.updateSession(session.id, { status: 'subagent', parentId: parentSessionId });

    this.emit({ type: 'subagent.spawn', subagent });

    return subagent;
  }

  /**
   * 标记子任务完成
   */
  complete(subagentId, result) {
    const subagent = this.activeSubagents.get(subagentId);
    if (!subagent) return;
    this._clearTimeout(subagent);

    subagent.status = 'completed';
    subagent.result = result;
    subagent.completedAt = new Date().toISOString();
    this.store.updateSession(subagent.sessionId, { status: 'idle' });

    this.emit({ type: 'subagent.complete', subagent, result });

    // 如果有父任务，通知完成
    if (subagent.parentSessionId) {
      this.emit({
        type: 'subagent.parent.notify',
        parentId: subagent.parentSessionId,
        subagentId,
        result
      });
    }
  }

  /**
   * 标记子任务失败
   */
  fail(subagentId, error) {
    const subagent = this.activeSubagents.get(subagentId);
    if (!subagent) return;
    this._clearTimeout(subagent);

    subagent.status = 'failed';
    subagent.error = error;
    subagent.completedAt = new Date().toISOString();
    this.store.updateSession(subagent.sessionId, { status: 'idle' });

    this.emit({ type: 'subagent.fail', subagent, error });

    // 如果有父任务，通知失败
    if (subagent.parentSessionId) {
      this.emit({
        type: 'subagent.parent.notify',
        parentId: subagent.parentSessionId,
        subagentId,
        error
      });
    }
  }

  _clearTimeout(subagent) {
    if (subagent.timeoutHandle) {
      clearTimeout(subagent.timeoutHandle);
      subagent.timeoutHandle = null;
    }
  }

  /**
   * 列出活跃子任务
   */
  listActive() {
    return Array.from(this.activeSubagents.values()).filter(s => s.status === 'running');
  }

  /**
   * 获取子任务
   */
  get(subagentId) {
    return this.activeSubagents.get(subagentId);
  }

  /**
   * 获取子任务结果（等待完成）
   */
  async waitForResult(subagentId, timeoutMs = 300000) {
    const subagent = this.activeSubagents.get(subagentId);
    if (!subagent) throw new Error('Subagent not found');

    if (subagent.status !== 'running') {
      return subagent;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener(listener);
        reject(new Error('Timeout waiting for subagent'));
      }, timeoutMs);

      const listener = (event) => {
        if (event.subagentId === subagentId &&
            (event.type === 'subagent.complete' || event.type === 'subagent.fail')) {
          clearTimeout(timeout);
          this.removeListener(listener);
          resolve(this.get(subagentId));
        }
      };

      this.addListener(listener);
    });
  }

  /**
   * 批量创建并行子任务
   */
  spawnTeam(tasks, options = {}) {
    const { parallel = true, stopOnError = false } = options;
    const teamId = randomUUID();

    const team = {
      id: teamId,
      tasks: tasks.map((task, index) => ({
        id: randomUUID(),
        task,
        index,
        status: 'pending'
      })),
      parallel,
      stopOnError,
      status: 'running',
      createdAt: new Date().toISOString()
    };

    this.emit({ type: 'team.spawn', team });

    if (parallel) {
      // 并行执行所有任务
      for (const task of team.tasks) {
        const subagent = this.spawn({
          task: task.task,
          parentSessionId: null,
          priority: 'normal'
        });
        task.subagentId = subagent.id;
      }
    } else {
      // 串行执行第一个任务
      this._spawnNext(team);
    }

    return team;
  }

  _spawnNext(team) {
    const nextTask = team.tasks.find(t => t.status === 'pending');
    if (!nextTask) {
      team.status = 'completed';
      this.emit({ type: 'team.complete', team });
      return;
    }

    const subagent = this.spawn({
      task: nextTask.task,
      parentSessionId: null,
      priority: 'normal'
    });
    nextTask.subagentId = subagent.id;
    nextTask.status = 'running';
  }

  /**
   * 获取团队状态
   */
  getTeamStatus(teamId) {
    const team = this.teams?.get(teamId);
    if (!team) return null;

    const results = team.tasks.map(t => ({
      index: t.index,
      status: t.status,
      result: t.subagent ? this.get(t.subagentId)?.result : null,
      error: t.subagent ? this.get(t.subagentId)?.error : null
    }));

    return {
      teamId,
      status: team.status,
      completed: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'failed').length,
      total: results.length,
      results
    };
  }

  /**
   * 列出所有活跃子任务
   */
  listAll() {
    return Array.from(this.activeSubagents.values());
  }

  /**
   * 清理已完成的子任务
   */
  cleanup(maxAgeMs = 3600000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, subagent] of this.activeSubagents.entries()) {
      if (subagent.status !== 'running' &&
          subagent.completedAt &&
          new Date(subagent.completedAt).getTime() < cutoff) {
        this.activeSubagents.delete(id);
      }
    }
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }
}

export class ContextCompactor {
  constructor({ maxMessages = 40, maxTokens = 60000 } = {}) {
    this.maxMessages = maxMessages;
    this.maxTokens = maxTokens;
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  compact(messages) {
    if (messages.length <= this.maxMessages) {
      return { messages, compacted: false };
    }

    const totalTokens = messages.reduce((sum, m) =>
      sum + this.estimateTokens(m.content), 0);

    if (totalTokens <= this.maxTokens) {
      return { messages, compacted: false };
    }

    const summary = this._summarize(messages);
    const recentCount = Math.floor(this.maxMessages * 0.7);
    const recentMessages = messages.slice(-recentCount);

    return {
      messages: [
        {
          id: 'compacted',
          role: 'system',
          content: `[对话历史已压缩: ${summary}]`,
          createdAt: new Date().toISOString()
        },
        ...recentMessages
      ],
      compacted: true,
      originalCount: messages.length,
      newCount: recentCount + 1
    };
  }

  _summarize(messages) {
    const decisions = messages
      .filter(m => /decided|concluded|agreed|chose|selected|built|created|added|changed|fixed|implemented/i.test(m.content))
      .map(m => m.content.slice(0, 100));

    const topicWords = this._extractTopics(messages);
    const topicStr = topicWords.slice(0, 5).join(', ');
    const decisionStr = decisions.slice(0, 3).join('. ');

    return [
      topicStr ? `主题: ${topicStr}` : '',
      decisionStr ? `决策: ${decisionStr}` : '',
      `共 ${messages.length} 条消息`
    ].filter(Boolean).join(' | ');
  }

  _extractTopics(messages) {
    const allText = messages.map(m => m.content).join(' ');
    const stopWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
      'their', 'what', 'when', 'where', 'which', 'while', 'would',
      'could', 'should', 'about', 'into', 'then', 'than', 'only',
      'other', 'some', 'these', 'those', 'very', 'just', 'like',
      'function', 'return', 'class', 'const', 'let', 'var', 'async',
      'await', 'import', 'export', 'default'
    ]);
    const words = allText.split(/\W+/).filter(w => w.length > 4 && !stopWords.has(w.toLowerCase()));
    const freq = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  }
}

export class TokenBudget {
  constructor({ store, dailyLimit = 100000 } = {}) {
    this.store = store;
    this.dailyLimit = dailyLimit;
    this.windowMs = 24 * 60 * 60 * 1000;
  }

  record(sessionId, usage) {
    this.store.addTokenUsage({
      sessionId,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      model: usage.model || 'unknown',
      timestamp: Date.now()
    });
  }

  getWindowUsage() {
    const cutoff = Date.now() - this.windowMs;
    return this.store.listTokenUsage()
      .filter(e => e.timestamp > cutoff)
      .reduce((acc, e) => {
        acc.input += e.inputTokens;
        acc.output += e.outputTokens;
        acc.total += e.totalTokens;
        return acc;
      }, { input: 0, output: 0, total: 0 });
  }

  checkBudget() {
    const usage = this.getWindowUsage();
    return {
      withinBudget: usage.total < this.dailyLimit,
      usage,
      limit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - usage.total),
      percentUsed: Math.round((usage.total / this.dailyLimit) * 100)
    };
  }
}
