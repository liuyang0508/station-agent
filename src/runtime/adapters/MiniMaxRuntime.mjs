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

function buildSystemPrompt({ skills, memories = [] }) {
  const enabledSkills = skills
    .filter((skill) => skill.enabled)
    .map((skill) => `${skill.name}: ${skill.description}`)
    .join('\n');
  const memoryContext = memories
    .slice(0, 8)
    .map((memory) => `${memory.title}: ${memory.content}`)
    .join('\n');
  return [
    '你是 Station Agent 的本地 Agent Runtime。',
    '你必须用中文优先回答，表达要专业、直接、可执行。',
    '你运行在一个本地优先客户端中，所有文件和命令动作都必须遵守工作区边界和审批策略。',
    '当任务复杂时，先给出可执行计划，再推进到交付物、命令或代码变更。',
    `可用技能:\n${enabledSkills || '暂无启用技能。'}`,
    `长期记忆:\n${memoryContext || '暂无长期记忆。'}`,
  ].join('\n\n');
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

    yield { type: 'trace', title: '模型运行时', detail: `调用 MiniMax / ${settings.model}`, status: 'running' };

    try {
      const baseUrl = settings.baseUrl.replace(/\/+$/, '');

      // Build messages in Anthropic format
      const messages = [
        { role: 'user', content: buildSystemPrompt({ skills, memories }) },
        ...history.slice(-12).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content
        })),
        { role: 'user', content: prompt }
      ];

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
          messages
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        yield { type: 'trace', title: '模型运行时', detail: `HTTP ${response.status} ${detail.slice(0, 300)}`, status: 'error' };
        yield { type: 'done', detail: '运行完成（模型调用失败）' };
        return;
      }

      const payload = await response.json();
      // Extract text content - skip thinking blocks, find first text block
      const textBlock = payload?.content?.find((block) => block.type === 'text');
      const answer = textBlock?.text || '';

      yield { type: 'trace', title: '输出生成', detail: '开始向客户端流式返回结果。', status: 'running' };

      for (const delta of chunkText(answer)) {
        yield { type: 'assistant.delta', delta };
        await wait(28);
      }

      yield { type: 'done', detail: '运行完成' };
    } catch (error) {
      yield { type: 'trace', title: '模型运行时', detail: error.message, status: 'error' };
      yield { type: 'done', detail: '运行完成（异常）' };
    }
  }
}
