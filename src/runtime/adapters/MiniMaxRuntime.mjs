import { AgentRuntimeAdapter } from './BaseRuntime.mjs';
import { readModelApiKey } from '../../lib/secrets.mjs';

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
    '你是 Station Agent 的本地 Agent Runtime。',
    '你必须用中文优先回答，表达要专业、直接、可执行。',
    '你运行在一个本地优先客户端中，所有文件和命令动作都必须遵守工作区边界和审批策略。',
    '当任务复杂时，先给出可执行计划，再推进到交付物、命令或代码变更。',
    toolDescriptions ? `可用工具:\n${toolDescriptions}` : null,
    `可用技能:\n${enabledSkills || '暂无启用技能。'}`,
    `长期记忆:\n${memoryContext || '暂无长期记忆。'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildToolResultMessage(toolName, toolArgs, result) {
  const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
  return {
    role: 'user',
    content: `工具结果: ${toolName}\n参数: ${JSON.stringify(toolArgs)}\n输出:\n${resultStr.slice(0, 4000)}`
  };
}

export class MiniMaxRuntime extends AgentRuntimeAdapter {
  constructor(context) {
    super(context);
    this._apiKey = null;
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
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.settings.model || 'MiniMax-M2.7',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK.' }]
        })
      });
      return { ok: response.ok, status: response.ok ? 'connected' : 'error', message: response.statusText };
    } catch (error) {
      return { ok: false, status: 'network_error', message: error.message };
    }
  }

  async *runTurn(prompt, context) {
    const { session, history, settings, skills, connectors, memories = [], tools, autonomousLoop = false } = context;

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

    const toolList = tools.list ? tools.list() : [];
    yield { type: 'trace', title: '模型运行时', detail: `调用 MiniMax / ${settings.model}，可用工具 ${toolList.length} 个`, status: 'running' };

    const baseUrl = settings.baseUrl.replace(/\/+$/, '');
    const MAX_TURN_LOOPS = autonomousLoop ? 50 : 10;
    let turnCount = 0;

    // Build the continuation prompt for autonomous mode
    const continuePrompt = autonomousLoop
      ? '\n\n请决定下一步：继续执行任务，或者回复"DONE"表示任务完成。如果需要用户确认才继续，请回复"WAIT"。'
      : '';

    const systemMessage = {
      role: 'user',
      content: buildSystemPrompt({ skills, memories, tools: toolList })
    };

    const conversationMessages = [
      systemMessage,
      ...history.slice(-12).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      })),
      { role: 'user', content: prompt + continuePrompt }
    ];

    while (turnCount < MAX_TURN_LOOPS) {
      turnCount++;

      try {
        const response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: settings.model || 'MiniMax-M2.7',
            max_tokens: 4096,
            messages: conversationMessages
          })
        });

        if (!response.ok) {
          const detail = await response.text();
          yield { type: 'trace', title: '模型运行时', detail: `HTTP ${response.status} ${detail.slice(0, 300)}`, status: 'error' };
          yield { type: 'done', detail: '运行完成（模型调用失败）' };
          return;
        }

        const payload = await response.json();
        const contentBlocks = payload?.content || [];

        // Separate thinking, text and tool_use blocks
        const thinkingBlocks = contentBlocks.filter((b) => b.type === 'thinking');
        const textBlocks = contentBlocks.filter((b) => b.type === 'text');
        const toolUseBlocks = contentBlocks.filter((b) => b.type === 'tool_use');

        // Stream thinking content first
        for (const thinkBlock of thinkingBlocks) {
          yield { type: 'thinking', detail: thinkBlock.thinking || '' };
          await wait(20);
        }

        // Record token usage if available
        if (payload?.usage && context.recordUsage) {
          context.recordUsage({
            input_tokens: payload.usage.input_tokens,
            output_tokens: payload.usage.output_tokens,
            total_tokens: payload.usage.total_tokens,
            model: settings.model
          });
        }

        // Stream text content first
        const textContent = textBlocks.map((b) => b.text).join('\n');
        if (textContent) {
          yield { type: 'trace', title: '输出生成', detail: '开始向客户端流式返回结果。', status: 'running' };
          for (const delta of chunkText(textContent)) {
            yield { type: 'assistant.delta', delta };
            await wait(28);
          }
        }

        // Handle tool calls
        if (toolUseBlocks.length > 0) {
          for (const toolBlock of toolUseBlocks) {
            const toolName = toolBlock.name;
            const toolInput = toolBlock.input || {};
            const toolId = toolBlock.id;

            yield {
              type: 'tool',
              tool: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}...`
            };

            try {
              let result;
              if (tools.has(toolName)) {
                result = tools.run(toolName, toolInput);
              } else {
                result = { error: `Unknown tool: ${toolName}` };
              }

              yield {
                type: 'tool',
                tool: toolName,
                status: 'ok',
                detail: typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result)
              };

              conversationMessages.push({
                role: 'user',
                content: `工具 "${toolName}" (id: ${toolId}) 执行完成，结果：${JSON.stringify(result).slice(0, 3000)}`
              });
            } catch (error) {
              yield {
                type: 'tool',
                tool: toolName,
                status: 'error',
                detail: error.message
              };
              conversationMessages.push({
                role: 'user',
                content: `工具 "${toolName}" (id: ${toolId}) 执行失败：${error.message}`
              });
            }
          }

          // Continue the loop - add a continuation prompt
          conversationMessages.push({
            role: 'user',
            content: '继续。请基于工具执行结果完成回答，或继续调用工具。'
          });

          yield {
            type: 'trace',
            title: '工具循环',
            detail: `已执行 ${toolUseBlocks.length} 个工具调用，继续推理...`,
            status: 'running'
          };
          await wait(160);
          continue;
        }

        // No tool calls - check for autonomous loop exit signals
        if (autonomousLoop && textContent) {
          const upper = textContent.toUpperCase();
          if (upper.includes('DONE') || upper.includes('完成')) {
            yield { type: 'trace', title: '自主循环', detail: 'Agent 报告任务完成，退出循环', status: 'ok' };
            yield { type: 'done', detail: '运行完成（Agent 自主结束）' };
            return;
          }
          if (upper.includes('WAIT') || upper.includes('等待')) {
            yield { type: 'trace', title: '自主循环', detail: 'Agent 请求用户确认，继续等待', status: 'ok' };
            yield { type: 'done', detail: '运行完成（等待用户确认）' };
            return;
          }
        }

        yield { type: 'done', detail: '运行完成' };
        return;
      } catch (error) {
        yield { type: 'trace', title: '模型运行时', detail: error.message, status: 'error' };
        yield { type: 'done', detail: '运行完成（异常）' };
        return;
      }
    }

    yield {
      type: 'trace',
      title: '工具循环',
      detail: `已达到最大循环次数（${MAX_TURN_LOOPS}），强制结束`,
      status: 'warn'
    };
    yield { type: 'done', detail: '运行完成（达到最大循环次数）' };
  }
}
