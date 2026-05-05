/**
 * ToolLoop — 共享工具执行循环
 *
 * 提供统一的工具调用处理逻辑，供所有适配器使用
 */

import { wait } from '../agentRuntime.mjs';

export const MAX_TOOL_LOOPS = 20;

/**
 * 解析 LLM 响应的 content blocks
 */
export function parseContentBlocks(content) {
  if (!content) return { thinking: [], text: [], toolUse: [] };

  const blocks = Array.isArray(content) ? content : [];

  return {
    thinking: blocks.filter(b => b.type === 'thinking'),
    text: blocks.filter(b => b.type === 'text'),
    toolUse: blocks.filter(b => b.type === 'tool_use')
  };
}

/**
 * 构建工具执行结果消息
 */
export function buildToolResultMessage(toolName, toolArgs, result) {
  const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
  return {
    role: 'user',
    content: `工具 "${toolName}" (id: ${toolArgs?.id || 'unknown'}) 执行完成，结果：${resultStr.slice(0, 3000)}`
  };
}

/**
 * 执行工具循环
 * @param {Object} context - 执行上下文
 * @param {Array} conversationMessages - 对话消息数组（会被修改）
 * @param {Function} yield - 生成器 yield 函数
 * @param {Object} tools - 工具注册表
 * @param {Object} options - 配置选项
 * @returns {Object} - { done: boolean, detail: string }
 */
export async function* executeToolLoop(context, conversationMessages, tools, options = {}) {
  const {
    autonomousLoop = false,
    maxLoops = MAX_TOOL_LOOPS,
    onChunkText = null,
    onThinking = null
  } = options;

  let turnCount = 0;

  while (turnCount < maxLoops) {
    turnCount++;

    // 让调用者 yield 当前状态
    yield { type: 'loop', turnCount };

    // 解析 blocks
    const { thinking, text, toolUse } = parseContentBlocks(context.lastContent);

    // 输出 thinking
    for (const block of thinking) {
      if (onThinking) {
        yield* onThinking(block.thinking || '');
      } else {
        yield { type: 'thinking', detail: block.thinking || '' };
      }
      await wait(20);
    }

    // 输出文本
    const textContent = text.map(b => b.text).join('\n');
    if (textContent) {
      yield { type: 'trace', title: '输出生成', detail: '开始向客户端流式返回结果。', status: 'running' };

      if (onChunkText) {
        yield* onChunkText(textContent);
      } else {
        for (const delta of chunkText(textContent)) {
          yield { type: 'assistant.delta', delta };
          await wait(28);
        }
      }
    }

    // 处理工具调用
    if (toolUse.length > 0) {
      for (const toolBlock of toolUse) {
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
          if (tools && tools.has(toolName)) {
            result = await tools.run(toolName, toolInput);
          } else {
            result = { error: `Unknown tool: ${toolName}` };
          }

          yield {
            type: 'tool',
            tool: toolName,
            status: 'ok',
            detail: typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result)
          };

          conversationMessages.push(buildToolResultMessage(toolName, { id: toolId }, result));
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

      // 继续循环
      conversationMessages.push({
        role: 'user',
        content: '继续。请基于工具执行结果完成回答，或继续调用工具。'
      });

      yield {
        type: 'trace',
        title: '工具循环',
        detail: `已执行 ${toolUse.length} 个工具调用，继续推理...`,
        status: 'running'
      };
      await wait(160);

      // 返回信号让调用者继续发送请求
      yield { type: 'continue', conversationMessages };
      continue;
    }

    // 无工具调用，检查自主循环退出信号
    if (autonomousLoop && textContent) {
      const upper = textContent.toUpperCase();
      if (upper.includes('DONE') || upper.includes('完成')) {
        yield { type: 'trace', title: '自主循环', detail: 'Agent 报告任务完成，退出循环', status: 'ok' };
        yield { type: 'done', detail: '运行完成（Agent 自主结束）' };
        return { done: true, detail: 'Agent 自主结束' };
      }
      if (upper.includes('WAIT') || upper.includes('等待')) {
        yield { type: 'trace', title: '自主循环', detail: 'Agent 请求用户确认，继续等待', status: 'ok' };
        yield { type: 'done', detail: '运行完成（等待用户确认）' };
        return { done: true, detail: '等待用户确认' };
      }
    }

    // 正常结束
    yield { type: 'done', detail: '运行完成' };
    return { done: false, detail: '正常结束' };
  }

  // 达到最大循环次数
  yield { type: 'trace', title: '工具循环', detail: `达到最大循环次数 ${maxLoops}，强制退出`, status: 'warn' };
  yield { type: 'done', detail: `运行完成（达到最大循环 ${maxLoops}）` };
  return { done: true, detail: '达到最大循环' };
}

/**
 * 分块文本
 */
function chunkText(text, size = 72) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}
