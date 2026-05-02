import { DemoRuntime } from './adapters/DemoRuntime.mjs';
import { OpenAICompatibleRuntime } from './adapters/OpenAICompatibleRuntime.mjs';
import { HermesRuntime } from './adapters/HermesRuntime.mjs';
import { OpenClawGatewayAdapter } from './adapters/OpenClawGatewayAdapter.mjs';
import { OpenCoworkSandboxAdapter } from './adapters/OpenCoworkSandboxAdapter.mjs';
import { referenceBlueprint } from '../lib/referenceBlueprint.mjs';
import { createToolRegistry } from './toolRegistry.mjs';

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
    '你是 AIAgent Client 的本地 Agent Runtime。',
    '你必须用中文优先回答，表达要专业、直接、可执行。',
    '你运行在一个本地优先客户端中，所有文件和命令动作都必须遵守工作区边界和审批策略。',
    '当任务复杂时，先给出可执行计划，再推进到交付物、命令或代码变更。',
    `可用技能:\n${enabledSkills || '暂无启用技能。'}`,
    `长期记忆:\n${memoryContext || '暂无长期记忆。'}`,
    `产品原则:\n${referenceBlueprint.runtimePrinciples.join('\n')}`
  ].join('\n\n');
}

function shouldListWorkspace(prompt) {
  return /工作区|目录|文件|workspace|list files/i.test(prompt);
}

export function createAgentRuntime(settings, { skills, memories, tools }) {
  const runtimeMode = settings.runtimeMode || 'demo';

  switch (runtimeMode) {
    case 'hermes':
      return new HermesRuntime({ settings, skills, memories, tools });
    case 'openclaw':
      return new OpenClawGatewayAdapter({ settings, skills, memories, tools });
    case 'opencowork':
      return new OpenCoworkSandboxAdapter({ settings, skills, memories, tools });
    case 'remote':
    case 'openai':
    case 'anthropic':
      return new OpenAICompatibleRuntime({ settings, skills, memories, tools });
    case 'demo':
    default:
      return new DemoRuntime({ settings, skills, memories, tools });
  }
}

export async function* runAgentTurn(context) {
  const { prompt, session, history, settings, skills, connectors, memories = [] } = context;
  const tools = createToolRegistry({ settings });

  // Add tools to context for adapters
  const runtimeContext = { ...context, tools };

  // If prompt mentions workspace, do a pre-check
  let localToolContext = '';
  if (shouldListWorkspace(prompt)) {
    try {
      const listing = tools.run('workspace.list', { path: '.', limit: 12 });
      localToolContext = [
        '',
        '工作区根目录预览:',
        ...listing.entries.map((entry) => `- ${entry.kind}: ${entry.path}`)
      ].join('\n');
    } catch (error) {
      // Ignore workspace list errors
    }
  }

  // Create and run the appropriate runtime
  const runtime = createAgentRuntime(settings, { skills, memories, tools });

  yield {
    type: 'trace',
    title: '任务解析',
    detail: '识别用户目标、当前会话、工作区和可用技能。',
    status: 'running'
  };
  await wait(160);

  yield {
    type: 'trace',
    title: '安全边界',
    detail: `工作区边界已绑定到 ${session?.workspaceRoot || settings.workspaceRoot}`,
    status: 'ok'
  };
  await wait(160);

  yield {
    type: 'trace',
    title: '运行时选择',
    detail: `使用 ${runtime.constructor.name} 运行时`,
    status: 'ok'
  };
  await wait(160);

  // Delegate to the runtime adapter
  for await (const event of runtime.runTurn(prompt, runtimeContext)) {
    if (event.type === 'assistant.delta' && localToolContext) {
      // Prepend workspace context to first delta
      yield { ...event, delta: event.delta + localToolContext };
      localToolContext = '';
    } else {
      yield event;
    }
  }
}
