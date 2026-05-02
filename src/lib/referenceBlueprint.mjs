export const referenceBlueprint = {
  productName: 'Station Agent',
  positioning: '本地优先的专业 AI Agent 客户端，面向个人和团队的自动化工作台。',
  references: [
    {
      repo: 'OpenCoworkAI/open-cowork',
      localPath: '../open-cowork',
      role: '桌面客户端、会话管理、沙箱、MCP、技能与远控的产品参考',
      adopted: [
        '工作区优先的会话模型',
        '沙箱/路径边界作为默认安全层',
        '设置、技能、远程控制、Trace 面板集中到同一个客户端体验'
      ]
    },
    {
      repo: 'openclaw/openclaw',
      localPath: '../open-claw',
      role: '多通道网关、设备节点、插件 SDK、消息路由的架构参考',
      adopted: [
        'Gateway 作为会话、通道、设备和自动化的控制面',
        '通道连接器与 Agent Runtime 解耦',
        '配对、允许列表、状态健康检查作为远控基础设施'
      ]
    },
    {
      repo: 'NousResearch/hermes-agent',
      localPath: '../hermes-agent/code',
      role: '工具注册、技能自进化、记忆、定时任务、多运行环境的运行时参考',
      adopted: [
        '工具元数据注册表',
        '技能、记忆、计划任务形成闭环',
        '运行时适配层支持 CLI、本地服务、云端和自定义模型'
      ]
    }
  ],
  capabilities: [
    {
      id: 'local-first-chat',
      title: '本地优先对话工作台',
      status: 'ready',
      source: 'OpenCowork session model + Hermes CLI ergonomics'
    },
    {
      id: 'runtime-adapter',
      title: '可替换 Agent Runtime',
      status: 'ready',
      source: 'Hermes runtime/provider split'
    },
    {
      id: 'skills',
      title: '技能中心',
      status: 'ready',
      source: 'OpenCowork skills + Hermes tool registry'
    },
    {
      id: 'gateway',
      title: '远程控制与多通道网关',
      status: 'scaffolded',
      source: 'OpenClaw gateway/channel architecture'
    },
    {
      id: 'sandbox',
      title: '工作区安全边界',
      status: 'ready',
      source: 'OpenCowork path guard'
    },
    {
      id: 'automation',
      title: '任务编排与计划执行',
      status: 'scaffolded',
      source: 'Hermes cron + OpenClaw automation'
    }
  ],
  runtimePrinciples: [
    '客户端不直接绑定单一模型厂商，默认支持 OpenAI-compatible API。',
    '任何文件/命令能力都必须经过工作区边界和审批层。',
    '技能、工具、连接器、记忆是独立注册对象，不写死到聊天 UI。',
    '本地演示运行时必须可用，真实模型运行时通过配置无缝替换。',
    'Trace 是一等产品面，用户必须能看见 Agent 的计划、工具和状态。'
  ]
};

export function summarizeReferences() {
  return referenceBlueprint.references.map((item) => ({
    repo: item.repo,
    role: item.role,
    adopted: item.adopted
  }));
}
