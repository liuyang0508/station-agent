import { AgentRuntimeAdapter } from './BaseRuntime.mjs';
import { referenceBlueprint } from '../../lib/referenceBlueprint.mjs';

function chunkText(text, size = 72) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDemoAnswer({ prompt, settings, skills, connectors, memories = [] }) {
  const enabledSkills = skills.filter((skill) => skill.enabled).map((skill) => skill.name);
  const plannedConnectors = connectors
    .filter((connector) => connector.status !== 'ready')
    .map((connector) => connector.name);
  return [
    `我已收到任务："${prompt}"。`,
    '',
    '按当前 v0.1 客户端能力，我会这样推进：',
    '1. 把任务拆成会话目标、工作区动作、交付件和外部连接器四类。',
    '2. 在执行前校验工作区路径，涉及命令、跨目录访问或远程发送时进入审批队列。',
    '3. 优先调用已启用技能完成稳定流程，再把中间状态写入 Trace，方便人工复核。',
    '4. 如果配置了真实 OpenAI-compatible 模型，会切换到真实推理；当前没有检测到可用 API Key 或 Base URL，所以使用本地演示运行时。',
    '',
    `当前工作区: ${settings.workspaceRoot}`,
    `已启用技能: ${enabledSkills.join('、') || '无'}`,
    `待接入连接器: ${plannedConnectors.join('、') || '无'}`,
    `长期记忆: ${memories.length ? memories.slice(0, 3).map((memory) => memory.title).join('、') : '无'}`,
    '',
    '下一步建议：在设置里填入 Base URL，并在启动服务前设置 `AIAGENT_API_KEY`，即可让这个客户端从演示运行时切换到真实模型运行时。'
  ].join('\n');
}

export class DemoRuntime extends AgentRuntimeAdapter {
  async *runTurn(prompt, context) {
    const { session, history, settings, skills, connectors, memories = [], tools } = context;

    yield { type: 'trace', title: '任务解析', detail: '识别用户目标、当前会话、工作区和可用技能。', status: 'running' };
    await wait(160);

    yield { type: 'trace', title: '安全边界', detail: `工作区边界已绑定到 ${session?.workspaceRoot || settings.workspaceRoot}`, status: 'ok' };
    await wait(160);

    yield { type: 'tool', tool: 'reference.blueprint', status: 'ok', detail: '已加载产品架构映射。' };
    await wait(160);

    yield { type: 'tool', tool: 'skills.registry', status: 'ok', detail: `启用 ${skills.filter((s) => s.enabled).length} 个技能，${skills.length} 个技能已注册。` };
    await wait(160);

    const answer = buildDemoAnswer({ prompt, settings, skills, connectors, memories });

    yield { type: 'trace', title: '输出生成', detail: '开始向客户端流式返回结果。', status: 'running' };

    for (const delta of chunkText(answer)) {
      yield { type: 'assistant.delta', delta };
      await wait(28);
    }

    yield { type: 'done', detail: '运行完成' };
  }
}
