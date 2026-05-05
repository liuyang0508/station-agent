import { AgentRuntimeAdapter } from './BaseRuntime.mjs';
import { readModelApiKey } from '../../lib/secrets.mjs';
import { ContextCompactor } from '../sandboxExecutor.mjs';
import { getCircuitBreaker } from '../../lib/circuitBreaker.mjs';

const MAX_TURN_LOOPS = 20;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text, size = 72) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

function buildSystemPrompt({ skills, memories = [], tools = [] }) {
  const enabledSkills = skills
    .filter((skill) => skill.enabled)
    .map((skill) => `${skill.name}: ${skill.description}`)
    .join('\n');
  const memoryContext = memories
    .slice(0, 8)
    .map((memory) => `${memory.title}: ${memory.content}`)
    .join('\n');
  const toolDescriptions = tools
    .map((tool) => `  - ${tool.name}: ${tool.description}`)
    .join('\n');
  return [
    '你是 AIAgent Client 的本地 Agent Runtime。',
    '你必须用中文优先回答，表达要专业、直接、可执行。',
    '你运行在一个本地优先客户端中，所有文件和命令动作都必须遵守工作区边界和审批策略。',
    '当任务复杂时，先给出可执行计划，再推进到交付物、命令或代码变更。',
    toolDescriptions ? `可用工具:\n${toolDescriptions}` : null,
    `可用技能:\n${enabledSkills || '暂无启用技能。'}`,
    `长期记忆:\n${memoryContext || '暂无长期记忆。'}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * OpenAI 格式的工具定义
 */
function toOpenAITools(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }));
}

export class OpenAICompatibleRuntime extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this._apiKey = null;
    this.contextCompactor = new ContextCompactor({ maxMessages: 40, maxTokens: 60000 });
    // Circuit breaker for model API calls
    this.circuitBreaker = getCircuitBreaker('openai-compatible-model', {
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeoutMs: 30000
    });
  }

  _getApiKey() {
    if (!this._apiKey) {
      this._apiKey = readModelApiKey(this.settings.apiKeyEnv || 'AIAGENT_API_KEY').value;
    }
    return this._apiKey;
  }

  async testConnection() {
    const apiKey = this._getApiKey();
    if (!apiKey || !this.settings.baseUrl) {
      return { ok: false, status: 'no_credentials', message: 'Missing API key or base URL' };
    }

    try {
      const baseUrl = this.settings.baseUrl.replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` }
      });
      return { ok: response.ok, status: response.ok ? 'connected' : 'error', message: response.statusText };
    } catch (error) {
      return { ok: false, status: 'network_error', message: error.message };
    }
  }

  async *runTurn(prompt, context) {
    const { session, history, settings, skills, connectors, memories = [], tools } = context;

    yield { type: 'trace', title: '任务解析', detail: '识别用户目标、当前会话、工作区和可用技能。', status: 'running' };
    await wait(160);

    yield { type: 'trace', title: '安全边界', detail: `工作区边界已绑定到 ${session?.workspaceRoot || settings.workspaceRoot}`, status: 'ok' };
    await wait(160);

    const apiKey = this._getApiKey();
    if (!apiKey || !settings.baseUrl) {
      yield { type: 'trace', title: '模型运行时', detail: '未检测到 API Key 或 Base URL，演示模式。', status: 'warn' };
      yield { type: 'done', detail: '运行完成（降级到演示模式）' };
      return;
    }

    yield { type: 'trace', title: '模型运行时', detail: `调用 ${settings.provider} / ${settings.model}`, status: 'running' };

    // Compact history if needed
    const { messages: compactedHistory, compacted } = this.contextCompactor.compact(history);
    if (compacted) {
      yield {
        type: 'trace',
        title: '上下文压缩',
        detail: `历史记录从 ${history.length} 条压缩至 ${compactedHistory.length} 条`,
        status: 'ok'
      };
    }

    const toolList = tools ? Array.from(tools.registry.values()) : [];
    const hasTools = toolList.length > 0;

    try {
      let turnCount = 0;
      const baseUrl = settings.baseUrl.replace(/\/+$/, '');

      // 构建初始消息
      const conversationMessages = [
        { role: 'system', content: buildSystemPrompt({ skills, memories, tools: toolList }) },
        ...compactedHistory.slice(-20).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content
        })),
        { role: 'user', content: prompt }
      ];

      while (turnCount < MAX_TURN_LOOPS) {
        turnCount++;

        const requestBody = {
          model: settings.model || 'gpt-5.2',
          messages: conversationMessages,
          temperature: 0.2
        };

        // 如果有工具，添加工具定义
        if (hasTools) {
          requestBody.tools = toOpenAITools(toolList);
          requestBody.tool_choice = 'auto';
        }

        // Use circuit breaker for API calls
        const response = await this.circuitBreaker.execute(async () => {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
          });
          // Circuit breaker will track failures via non-2xx responses
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return res;
        });

        if (!response.ok) {
          const detail = await response.text();
          // Differentiate error types
          let errorHint = '';
          if (response.status === 401 || response.status === 403) {
            errorHint = '请检查 API Key 是否正确';
          } else if (response.status >= 500) {
            errorHint = '服务器错误，请稍后重试';
          }
          const errorDetail = errorHint ? `${detail.slice(0, 200)} (${errorHint})` : detail.slice(0, 300);
          yield { type: 'trace', title: '模型运行时', detail: `HTTP ${response.status} ${errorDetail}`, status: 'error' };
          yield { type: 'done', detail: `运行完成（${response.status === 401 || response.status === 403 ? '认证失败' : '模型调用失败'}）` };
          return;
        }

        const payload = await response.json();
        const message = payload?.choices?.[0]?.message;

        // 检查是否有工具调用
        const toolCalls = message?.tool_calls || [];

        if (toolCalls.length > 0) {
          // 添加工具调用消息到对话
          conversationMessages.push(message);

          // 执行工具
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

            yield {
              type: 'tool',
              tool: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}...`
            };

            try {
              let result;
              if (tools && tools.has(toolName)) {
                result = await tools.run(toolName, toolArgs);
              } else {
                result = { error: `Unknown tool: ${toolName}` };
              }

              yield {
                type: 'tool',
                tool: toolName,
                status: 'ok',
                detail: typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result)
              };

              // 添加工具结果消息
              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: typeof result === 'object' ? JSON.stringify(result) : String(result)
              });
            } catch (error) {
              yield {
                type: 'tool',
                tool: toolName,
                status: 'error',
                detail: error.message
              };

              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`
              });
            }
          }

          yield {
            type: 'trace',
            title: '工具循环',
            detail: `已执行 ${toolCalls.length} 个工具调用，继续推理...`,
            status: 'running'
          };
          await wait(160);

          continue;  // 继续循环
        }

        // 没有工具调用，输出文本
        const answer = message?.content || '';

        yield { type: 'trace', title: '输出生成', detail: '开始向客户端流式返回结果。', status: 'running' };

        for (const delta of chunkText(answer)) {
          yield { type: 'assistant.delta', delta };
          await wait(28);
        }

        yield { type: 'done', detail: '运行完成' };
        return;
      }

      // 达到最大循环次数
      yield { type: 'trace', title: '工具循环', detail: `达到最大循环次数 ${MAX_TURN_LOOPS}，强制退出`, status: 'warn' };
      yield { type: 'done', detail: `运行完成（达到最大循环 ${MAX_TURN_LOOPS}）` };
    } catch (error) {
      // Check if circuit breaker is open
      if (error.message === 'Circuit breaker is OPEN') {
        yield { type: 'trace', title: '模型运行时', detail: '服务暂时不可用 (熔断器已触发)，请稍后重试', status: 'error' };
        yield { type: 'done', detail: '运行完成（熔断器触发，请稍后重试）' };
        return;
      }
      yield { type: 'trace', title: '模型运行时', detail: error.message, status: 'error' };
      yield { type: 'done', detail: '运行完成（异常）' };
    }
  }
}
