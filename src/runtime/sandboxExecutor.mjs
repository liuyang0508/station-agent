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
        info: (...args) { output.stdout += args.map(String).join(' ') + '\n'; }
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
  }

  spawn({ task, parentSessionId, priority = 'normal' }) {
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
      createdAt: new Date().toISOString()
    };

    this.activeSubagents.set(subagentId, subagent);
    this.store.updateSession(session.id, { status: 'subagent', parentId: parentSessionId });

    return subagent;
  }

  complete(subagentId, result) {
    const subagent = this.activeSubagents.get(subagentId);
    if (!subagent) return;
    subagent.status = 'completed';
    subagent.result = result;
    subagent.completedAt = new Date().toISOString();
    this.store.updateSession(subagent.sessionId, { status: 'idle' });
  }

  fail(subagentId, error) {
    const subagent = this.activeSubagents.get(subagentId);
    if (!subagent) return;
    subagent.status = 'failed';
    subagent.error = error;
    subagent.completedAt = new Date().toISOString();
    this.store.updateSession(subagent.sessionId, { status: 'idle' });
  }

  listActive() {
    return Array.from(this.activeSubagents.values()).filter(s => s.status === 'running');
  }

  get(subagentId) {
    return this.activeSubagents.get(subagentId);
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
