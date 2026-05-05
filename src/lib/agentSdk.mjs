/**
 * Agent SDK — 自定义 Agent 构建框架
 *
 * 提供 SDK 风格的接口，让用户可以构建自己的 Agent workflow。
 *
 * 用法示例：
 * ```javascript
 * import { createAgent } from './agentSdk.mjs';
 *
 * const agent = createAgent({
 *   name: 'my-agent',
 *   model: 'minimax',
 *   tools: ['workspace.list', 'workspace.read'],
 *   systemPrompt: '你是一个代码审查助手'
 * });
 *
 * for await (const event of agent.run('审查这个 PR')) {
 *   console.log(event);
 * }
 * ```
 */

/**
 * Agent 事件类型
 */
export const AgentEvent = {
  START: 'start',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  MESSAGE: 'message',
  THINKING: 'thinking',
  ERROR: 'error',
  DONE: 'done'
};

/**
 * 内置工具注册表（可在运行时替换）
 */
const BUILTIN_TOOLS = {
  'workspace.list': {
    description: '列出工作区目录',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.' },
        limit: { type: 'number', default: 50 }
      }
    }
  },
  'workspace.read': {
    description: '读取文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  'memory.search': {
    description: '搜索记忆',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    }
  }
};

/**
 * 创建 Agent 实例
 */
export function createAgent(config) {
  return new Agent(config);
}

/**
 * Agent — 可编程的 Agent 实例
 */
export class Agent {
  constructor(config) {
    this.id = config.id || crypto.randomUUID();
    this.name = config.name || 'agent';
    this.model = config.model || 'minimax';
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.apiKeyEnv = config.apiKeyEnv || 'AIAGENT_API_KEY';

    // 工具配置
    this.allowedTools = new Set(config.tools || []);
    this.deniedTools = new Set(config.deniedTools || []);
    this.toolHandlers = new Map();  // toolName -> handler function

    // 系统提示词
    this.systemPrompt = config.systemPrompt || '你是一个智能助手。';

    // 运行时配置
    this.maxLoops = config.maxLoops || 20;
    this.temperature = config.temperature ?? 0.7;
    this.timeoutMs = config.timeoutMs || 120000;

    // 记忆配置
    this.memoryEnabled = config.memoryEnabled !== false;
    this.maxMemoryItems = config.maxMemoryItems || 50;

    // 内部状态
    this._messages = [];
    this._runtime = null;
  }

  /**
   * 注册工具处理器
   */
  registerTool(toolName, handler, schema) {
    if (typeof handler !== 'function') {
      throw new Error('Tool handler must be a function');
    }
    this.toolHandlers.set(toolName, { handler, schema });
    return this;
  }

  /**
   * 清除会话历史
   */
  clearHistory() {
    this._messages = [];
    return this;
  }

  /**
   * 添加消息到历史
   */
  addMessage(role, content) {
    this._messages.push({ role, content, timestamp: new Date().toISOString() });
    return this;
  }

  /**
   * 运行 Agent
   * @param {string} prompt - 用户输入
   * @param {Object} context - 额外上下文
   * @returns {AsyncGenerator} 事件流
   */
  async *run(prompt, context = {}) {
    yield { type: AgentEvent.START, agent: this.name, prompt };

    // 如果有工具，需要初始化运行时
    if (this.allowedTools.size > 0 || this.toolHandlers.size > 0) {
      yield { type: AgentEvent.TOOL_CALL, tool: 'system', status: 'init' };
    }

    try {
      // 构建消息
      const messages = this._buildMessages(prompt, context);

      // 调用 LLM
      const result = yield* this._callLLM(messages, context);

      // 处理结果
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls) {
          yield* this._executeTool(toolCall, context);
        }
      }

      yield { type: AgentEvent.DONE, result: result.text };
    } catch (error) {
      yield { type: AgentEvent.ERROR, error: error.message };
    }
  }

  /**
   * 同步运行（返回最终结果）
   */
  async runSync(prompt, context = {}) {
    let finalResult = '';
    for await (const event of this.run(prompt, context)) {
      if (event.type === AgentEvent.DONE) {
        finalResult = event.result;
      }
    }
    return finalResult;
  }

  _buildMessages(prompt, context) {
    const messages = [];

    // 系统提示词
    let systemContent = this.systemPrompt;

    // 添加工具描述
    if (this.allowedTools.size > 0 || this.toolHandlers.size > 0) {
      const toolDescriptions = this._getToolDescriptions();
      if (toolDescriptions) {
        systemContent += `\n\n可用工具:\n${toolDescriptions}`;
      }
    }

    messages.push({ role: 'system', content: systemContent });

    // 历史消息
    messages.push(...this._messages.slice(-20));

    // 用户输入
    messages.push({ role: 'user', content: prompt });

    return messages;
  }

  _getToolDescriptions() {
    const descriptions = [];

    // 内置工具
    for (const [name, tool] of Object.entries(BUILTIN_TOOLS)) {
      if (this.allowedTools.has(name)) {
        descriptions.push(`- ${name}: ${tool.description}`);
      }
    }

    // 自定义工具
    for (const [name, { schema }] of this.toolHandlers.entries()) {
      if (this.allowedTools.size === 0 || this.allowedTools.has(name)) {
        descriptions.push(`- ${name}: ${schema?.description || '自定义工具'}`);
      }
    }

    return descriptions.join('\n');
  }

  async *_callLLM(messages, context) {
    const { runtime } = context;

    // 使用提供的 runtime 或创建新的
    const rt = runtime || this._createRuntime();
    const events = [];

    for await (const event of rt.runTurn(messages[messages.length - 1].content, {
      session: { id: this.id },
      history: messages.slice(1, -1),
      settings: this._getSettings(),
      skills: [],
      memories: [],
      connectors: [],
      tools: this._createToolRegistry()
    })) {
      events.push(event);

      // 转发事件
      if (event.type === 'thinking') {
        yield { type: AgentEvent.THINKING, content: event.detail };
      } else if (event.type === 'assistant.delta') {
        yield { type: AgentEvent.MESSAGE, delta: event.delta };
      } else if (event.type === 'tool') {
        yield { type: AgentEvent.TOOL_RESULT, tool: event.tool, status: event.status, result: event.detail };
      }
    }

    // 解析最终结果
    const textParts = events
      .filter(e => e.type === 'assistant.delta')
      .map(e => e.delta)
      .join('');

    const toolCalls = events
      .filter(e => e.type === 'tool' && e.status === 'running')
      .map(e => ({ name: e.tool, input: {} }));  // 简化

    return { text: textParts, toolCalls };
  }

  async *_executeTool(toolCall, context) {
    const { name, input } = toolCall;

    yield { type: AgentEvent.TOOL_CALL, tool: name, input };

    try {
      // 检查工具是否允许
      if (this.allowedTools.size > 0 && !this.allowedTools.has(name)) {
        throw new Error(`Tool not allowed: ${name}`);
      }

      if (this.deniedTools.has(name)) {
        throw new Error(`Tool denied: ${name}`);
      }

      // 查找工具处理器
      const toolInfo = this.toolHandlers.get(name);
      if (!toolInfo) {
        // 尝试内置工具
        const builtin = BUILTIN_TOOLS[name];
        if (!builtin) {
          throw new Error(`Tool not found: ${name}`);
        }
        // TODO: 实现内置工具
        throw new Error(`Builtin tool not implemented: ${name}`);
      }

      // 执行工具
      const result = await toolInfo.handler(input, context);

      yield { type: AgentEvent.TOOL_RESULT, tool: name, result, status: 'ok' };
    } catch (error) {
      yield { type: AgentEvent.TOOL_RESULT, tool: name, error: error.message, status: 'error' };
    }
  }

  _createRuntime() {
    if (this._runtime) return this._runtime;

    // 懒加载 runtime
    const { createAgentRuntime } = require('./runtime/agentRuntime.mjs');
    this._runtime = createAgentRuntime(
      { runtimeMode: this.model, baseUrl: this.baseUrl, apiKeyEnv: this.apiKeyEnv },
      { skills: [], memories: [] }
    );
    return this._runtime;
  }

  _createToolRegistry() {
    // 返回一个简化版的工具注册表
    const registry = new Map();

    for (const [name, { handler, schema }] of this.toolHandlers.entries()) {
      registry.set(name, {
        name,
        description: schema?.description || '',
        inputSchema: schema?.inputSchema || {},
        run: handler
      });
    }

    return {
      has: (name) => this.allowedTools.has(name) && (registry.has(name) || BUILTIN_TOOLS[name]),
      run: async (name, input) => {
        const tool = registry.get(name);
        if (tool) return tool.run(input, {});
        throw new Error(`Tool not found: ${name}`);
      },
      registry
    };
  }

  _getSettings() {
    return {
      runtimeMode: this.model,
      baseUrl: this.baseUrl,
      apiKeyEnv: this.apiKeyEnv,
      model: this.model
    };
  }
}

/**
 * Workflow — 多步骤工作流
 */
export class Workflow {
  constructor(steps = []) {
    this.steps = steps;
    this.context = {};
  }

  addStep(name, handler) {
    this.steps.push({ name, handler });
    return this;
  }

  async *run(initialInput) {
    let input = initialInput;

    for (const step of this.steps) {
      yield { type: 'step.start', name: step.name, input };

      try {
        const output = await step.handler(input);
        yield { type: 'step.complete', name: step.name, output };
        input = output;
      } catch (error) {
        yield { type: 'step.error', name: step.name, error: error.message };
        throw error;
      }
    }

    yield { type: 'workflow.complete', result: input };
    return input;
  }
}

/**
 * 创建 Workflow
 */
export function createWorkflow(steps) {
  return new Workflow(steps);
}
