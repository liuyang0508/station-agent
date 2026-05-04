import { DemoRuntime } from './adapters/DemoRuntime.mjs';
import { OpenAICompatibleRuntime } from './adapters/OpenAICompatibleRuntime.mjs';
import { MiniMaxRuntime } from './adapters/MiniMaxRuntime.mjs';
import { HermesRuntime } from './adapters/HermesRuntime.mjs';
import { OpenClawGatewayAdapter } from './adapters/OpenClawGatewayAdapter.mjs';
import { OpenCoworkSandboxAdapter } from './adapters/OpenCoworkSandboxAdapter.mjs';
import { referenceBlueprint } from '../lib/referenceBlueprint.mjs';
import { createToolRegistry } from './toolRegistry.mjs';
import { AgentLoop } from './agentLoop.mjs';
import { Harness } from './harness.mjs';
import { SkillCache } from '../lib/skillCache.mjs';
import { createSkillEvolution } from '../lib/skillEvolution.mjs';
import { JsonStore } from '../lib/store.mjs';

export const agentLoop = new AgentLoop({
  maxIterations: 100,
  loopThreshold: 3,
  autoContinue: true,
  contextThreshold: 0.8
});

export const harness = new Harness({
  enabled: true,
  maxSnapshots: 10
});

export function wait(ms) {
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
    .map((skill) => `[${skill.name}] ${skill.description}`)
    .join('\n');
  const memoryContext = memories
    .slice(0, 8)
    .map((memory) => `${memory.title}: ${memory.content}`)
    .join('\n');

  // Extract karpathy-guidelines body as mandatory constraints
  const karpathySkill = skills.find(s => s.name === 'karpathy-guidelines' && s.enabled);
  const karpathyConstraints = karpathySkill?.metadata?.body
    ? `\n\n强制约束（必须遵守）:\n${karpathySkill.metadata.body.slice(0, 2000)}`
    : '';

  return [
    '你是 AIAgent Client 的本地 Agent Runtime。',
    '你必须用中文优先回答，表达要专业、直接、可执行。',
    '你运行在一个本地优先客户端中，所有文件和命令动作都必须遵守工作区边界和审批策略。',
    '当任务复杂时，先给出可执行计划，再推进到交付物、命令或代码变更。',
    `可用技能:\n${enabledSkills || '暂无启用技能。'}`,
    `长期记忆:\n${memoryContext || '暂无长期记忆。'}`,
    `产品原则:\n${referenceBlueprint.runtimePrinciples.join('\n')}`,
    karpathyConstraints
  ].join('\n\n');
}

function shouldListWorkspace(prompt) {
  return /工作区|目录|文件|workspace|list files/i.test(prompt);
}

export function createAgentRuntime(settings, { skills, memories, tools, mcpTools = [] }) {
  const runtimeMode = settings.runtimeMode || 'demo';
  const baseUrl = (settings.baseUrl || '').replace(/\/+$/, '');

  // Auto-detect provider from baseUrl to handle "remote" mode intelligently
  const isMiniMax = baseUrl.includes('minimax.io');
  const isOpenAI = baseUrl.includes('openai.com') || baseUrl.includes('azure.com');

  // If baseUrl points to a real API and runtimeMode is demo, still use real runtime
  const useRealRuntime = isMiniMax || isOpenAI || runtimeMode === 'remote' || runtimeMode === 'minimax' || runtimeMode === 'anthropic';

  switch (runtimeMode) {
    case 'hermes':
      return new HermesRuntime({ settings, skills, memories, tools });
    case 'openclaw':
      return new OpenClawGatewayAdapter({ settings, skills, memories, tools });
    case 'opencowork':
      return new OpenCoworkSandboxAdapter({ settings, skills, memories, tools });
    case 'minimax':
      return new MiniMaxRuntime({ settings, skills, memories, tools });
    case 'remote':
      if (isMiniMax) return new MiniMaxRuntime({ settings, skills, memories, tools });
      if (isOpenAI) return new OpenAICompatibleRuntime({ settings, skills, memories, tools });
      return new MiniMaxRuntime({ settings, skills, memories, tools });
    case 'openai':
      return new OpenAICompatibleRuntime({ settings, skills, memories, tools });
    case 'anthropic':
      if (isMiniMax) return new MiniMaxRuntime({ settings, skills, memories, tools });
      return new OpenAICompatibleRuntime({ settings, skills, memories, tools });
    case 'demo':
    default:
      // For demo mode, use real runtime if baseUrl is configured
      if (isMiniMax) return new MiniMaxRuntime({ settings, skills, memories, tools });
      if (isOpenAI) return new OpenAICompatibleRuntime({ settings, skills, memories, tools });
      return new DemoRuntime({ settings, skills, memories, tools });
  }
}

export async function* runAgentTurn(context) {
  const { prompt, session, history, settings, skills, connectors, memories = [], mcpTools = [] } = context;
  const tools = createToolRegistry({ settings, mcpTools, skills });

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
  const runtime = createAgentRuntime(settings, { skills, memories, tools, mcpTools });

  // 获取技能缓存和进化状态
  let skillCacheStats = { sqliteSize: 0, memorySize: 0 };
  let skillEvolutionStatus = null;
  try {
    const store = new JsonStore();
    const sc = new SkillCache(store);
    const cacheStatus = sc.getStatus ? sc.getStatus() : { sqliteSize: 0, memorySize: 0 };
    skillCacheStats = { sqliteSize: cacheStatus.skillsInSQLite || 0, memorySize: cacheStatus.memoryCacheSize || 0 };
    const se = createSkillEvolution(store);
    skillEvolutionStatus = se.getStatus ? se.getStatus() : null;
  } catch (e) {
    // ignore
  }

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

  // Agent Loop 状态
  const loopStatus = agentLoop.getStatus();
  yield {
    type: 'trace',
    title: 'Agent Loop',
    detail: `状态: ${loopStatus.state}, 迭代: ${loopStatus.iteration}/${loopStatus.maxIterations}, 自动继续: ${loopStatus.autoContinue}`,
    status: 'ok'
  };
  await wait(80);

  // Harness 状态
  const harnessStatus = harness.getStatus();
  yield {
    type: 'trace',
    title: 'Harness Engineering',
    detail: `约束检查: ${harnessStatus.constraints.length} 条, 快照: ${harnessStatus.snapshots}, 启用: ${harnessStatus.enabled}`,
    status: 'ok'
  };
  await wait(80);

  // Skill Cache 状态
  yield {
    type: 'trace',
    title: 'Skill Cache',
    detail: `SQLite: ${skillCacheStats.sqliteSize}, Memory: ${skillCacheStats.memorySize}`,
    status: 'ok'
  };
  await wait(80);

  // Skill Evolution 状态
  if (skillEvolutionStatus) {
    yield {
      type: 'trace',
      title: 'Skill Evolution',
      detail: `技能数: ${skillEvolutionStatus.totalSkills || 0}, 触发: ${skillEvolutionStatus.recentTriggers?.length || 0}`,
      status: 'ok'
    };
    await wait(80);
  }

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
