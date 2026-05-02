import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeWorkspaceRoot } from './safety.mjs';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dataDir =
  process.env.AIAGENT_DATA_DIR || path.join(projectRoot, 'data');
const defaultStorePath =
  process.env.AIAGENT_STORE_PATH || path.join(dataDir, 'store.json');

function now() {
  return new Date().toISOString();
}

function createDefaultState() {
  const workspaceRoot = normalizeWorkspaceRoot(
    process.env.AIAGENT_WORKSPACE_ROOT || path.resolve(projectRoot, '..')
  );
  const firstSessionId = randomUUID();
  return {
    schemaVersion: 1,
    settings: {
      workspaceRoot,
      runtimeMode: 'demo',
      autonomousMode: false,
      provider: 'openai-compatible',
      baseUrl: '',
      model: 'gpt-5.2',
      apiKeyEnv: 'AIAGENT_API_KEY',
      approvalMode: 'ask',
      language: 'zh-CN'
    },
    sessions: [
      {
        id: firstSessionId,
        title: '产品架构工作台',
        workspaceRoot,
        createdAt: now(),
        updatedAt: now(),
        status: 'idle'
      }
    ],
    messages: [
      {
        id: randomUUID(),
        sessionId: firstSessionId,
        role: 'assistant',
        content:
          'AIAgent Client 已就绪。当前是本地演示运行时，可在设置里切换到 OpenAI-compatible API，并通过环境变量提供密钥。',
        createdAt: now(),
        trace: []
      }
    ],
    skills: [
      {
        id: 'document-studio',
        name: '文档工坊',
        description: '生成和修订 PPTX、DOCX、XLSX、PDF 交付件。',
        enabled: true,
        source: 'OpenCowork skills'
      },
      {
        id: 'workspace-operator',
        name: '工作区操作',
        description: '在受控工作区内读写文件、整理目录、生成报告。',
        enabled: true,
        source: 'OpenCowork sandbox + Hermes file tools'
      },
      {
        id: 'browser-research',
        name: '浏览器研究',
        description: '通过 MCP/浏览器连接器采集公开资料并沉淀引用。',
        enabled: false,
        source: 'OpenClaw browser tools + MCP'
      },
      {
        id: 'memory-loop',
        name: '长期记忆',
        description: '把稳定偏好、项目知识和复盘结论沉淀为可检索上下文。',
        enabled: true,
        source: 'Hermes memory'
      }
    ],
    connectors: [
      {
        id: 'wechat',
        name: '微信/企微',
        status: 'planned',
        channel: 'mobile',
        source: 'workspace skills'
      },
      {
        id: 'slack',
        name: 'Slack',
        status: 'planned',
        channel: 'remote',
        source: 'OpenClaw channels'
      },
      {
        id: 'feishu',
        name: '飞书',
        status: 'planned',
        channel: 'remote',
        source: 'OpenCowork remote control'
      },
      {
        id: 'local-browser',
        name: '本地浏览器',
        status: 'scaffolded',
        channel: 'mcp',
        source: 'MCP'
      }
    ],
    tasks: [
      {
        id: randomUUID(),
        title: '每日工作区摘要',
        cadence: 'weekday 18:30',
        status: 'paused',
        target: 'client inbox'
      },
      {
        id: randomUUID(),
        title: '远程消息收敛',
        cadence: 'realtime',
        status: 'planned',
        target: 'gateway'
      }
    ],
    approvals: [
      {
        id: randomUUID(),
        title: '高风险命令默认需要确认',
        status: 'policy',
        detail: '命令执行、跨目录访问和外部连接器发送消息都必须经过审批策略。'
      }
    ],
    mcpServers: [
      {
        id: 'local-browser',
        name: '本地浏览器 MCP',
        command: '',
        args: [],
        cwd: workspaceRoot,
        env: {},
        enabled: false,
        status: 'stopped',
        source: 'OpenClaw gateway pattern',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    memories: [
      {
        id: randomUUID(),
        title: '客户端原则',
        content: 'AIAgent Client 默认本地优先、中文优先，命令和外部动作必须经过审批策略。',
        tags: ['product', 'safety'],
        source: 'system',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    skillRuns: [],
    tokenUsage: [],
    modelConfigs: []
  };
}

function uniqueTags(tags) {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : String(tags || '').split(','))
        .map((tag) => String(tag).trim())
        .filter(Boolean)
    )
  );
}

function normalizeArgs(args) {
  if (Array.isArray(args)) return args.map((arg) => String(arg));
  if (!args) return [];
  return String(args)
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function normalizeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => /^[A-Z0-9_]+$/i.test(key) && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );
}

export class JsonStore {
  constructor(filePath = defaultStorePath) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const state = createDefaultState();
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
      return state;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const state = JSON.parse(raw);
    return this.migrate(state);
  }

  migrate(state) {
    let changed = false;
    const defaults = createDefaultState();
    for (const key of ['mcpServers', 'memories', 'skillRuns', 'evolutionEntries', 'modelConfigs']) {
      if (!Array.isArray(state[key])) {
        state[key] = defaults[key];
        changed = true;
      }
    }
    if (!Array.isArray(state.approvals)) {
      state.approvals = defaults.approvals;
      changed = true;
    }
    if (!Array.isArray(state.tokenUsage)) {
      state.tokenUsage = defaults.tokenUsage;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
    }
    return state;
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getSettings() {
    return this.state.settings;
  }

  getStorePath() {
    return this.filePath;
  }

  updateSettings(patch) {
    this.state.settings = {
      ...this.state.settings,
      ...patch,
      workspaceRoot: patch.workspaceRoot
        ? normalizeWorkspaceRoot(patch.workspaceRoot)
        : this.state.settings.workspaceRoot
    };
    this.save();
    return this.state.settings;
  }

  listSessions() {
    return [...this.state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getSession(sessionId) {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  createSession({ title, workspaceRoot } = {}) {
    const session = {
      id: randomUUID(),
      title: title || '新的 Agent 会话',
      workspaceRoot: normalizeWorkspaceRoot(workspaceRoot || this.state.settings.workspaceRoot),
      createdAt: now(),
      updatedAt: now(),
      status: 'idle'
    };
    this.state.sessions.unshift(session);
    this.save();
    return session;
  }

  updateSession(sessionId, patch) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: now() });
    this.save();
    return session;
  }

  listMessages(sessionId) {
    return this.state.messages
      .filter((message) => message.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addMessage({ sessionId, role, content, trace = [] }) {
    const message = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      trace,
      createdAt: now()
    };
    this.state.messages.push(message);
    this.updateSession(sessionId, { status: 'idle' });
    this.save();
    return message;
  }

  listSkills() {
    return this.state.skills;
  }

  toggleSkill(skillId) {
    const skill = this.state.skills.find((item) => item.id === skillId);
    if (!skill) return null;
    skill.enabled = !skill.enabled;
    this.save();
    return skill;
  }

  installSkill({ name, description, source = 'local', entrypoint = '', command = '', args = [], metadata = {} }) {
    const skill = {
      id: randomUUID(),
      name: String(name || '').trim(),
      description: String(description || '').trim() || '本地安装技能',
      enabled: true,
      source: String(source || 'local'),
      entrypoint: String(entrypoint || ''),
      command: String(command || ''),
      args: normalizeArgs(args),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      installedAt: now(),
      updatedAt: now()
    };
    if (!skill.name) {
      throw new Error('技能名称不能为空');
    }
    this.state.skills.unshift(skill);
    this.save();
    return skill;
  }

  recordSkillRun({ skillId, status, input = {}, output = '', error = '' }) {
    const skill = this.state.skills.find((item) => item.id === skillId);
    if (!skill) return null;
    const run = {
      id: randomUUID(),
      skillId,
      skillName: skill.name,
      status,
      input,
      output: String(output || ''),
      error: String(error || ''),
      createdAt: now()
    };
    this.state.skillRuns.unshift(run);
    this.state.skillRuns = this.state.skillRuns.slice(0, 100);
    this.save();
    return run;
  }

  listSkillRuns(skillId) {
    return this.state.skillRuns.filter((run) => !skillId || run.skillId === skillId);
  }

  // Evolution entries tracking
  listEvolutionEntries(skillId = null) {
    const entries = this.state.evolutionEntries || [];
    if (skillId) return entries.filter(e => e.skillId === skillId);
    return entries;
  }

  addEvolutionEntry(entry) {
    if (!this.state.evolutionEntries) {
      this.state.evolutionEntries = [];
    }
    this.state.evolutionEntries.unshift(entry);
    this.state.evolutionEntries = this.state.evolutionEntries.slice(0, 200);
    this.save();
    return entry;
  }

  updateEvolutionEntry(entryId, patch) {
    const entries = this.state.evolutionEntries;
    const idx = entries.findIndex(e => e.id === entryId);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], ...patch };
      this.save();
    }
    return entries[idx];
  }

  updateSkill(skillId, patch) {
    const skills = this.state.skills;
    const idx = skills.findIndex(s => s.id === skillId);
    if (idx >= 0) {
      skills[idx] = { ...skills[idx], ...patch, updatedAt: now() };
      this.save();
      return skills[idx];
    }
    return null;
  }

  listConnectors() {
    return this.state.connectors;
  }

  listMcpServers() {
    return this.state.mcpServers;
  }

  getMcpServer(serverId) {
    return this.state.mcpServers.find((server) => server.id === serverId);
  }

  createMcpServer({ name, command = '', args = [], cwd, env = {}, enabled = false }) {
    const server = {
      id: randomUUID(),
      name: String(name || '').trim(),
      command: String(command || '').trim(),
      args: normalizeArgs(args),
      cwd: normalizeWorkspaceRoot(cwd || this.state.settings.workspaceRoot),
      env: normalizeEnv(env),
      enabled: Boolean(enabled),
      status: 'stopped',
      source: 'custom',
      createdAt: now(),
      updatedAt: now()
    };
    if (!server.name) {
      throw new Error('MCP 服务名称不能为空');
    }
    this.state.mcpServers.unshift(server);
    this.save();
    return server;
  }

  updateMcpServer(serverId, patch) {
    const server = this.getMcpServer(serverId);
    if (!server) return null;
    const next = {
      ...patch,
      args: patch.args === undefined ? server.args : normalizeArgs(patch.args),
      env: patch.env === undefined ? server.env : normalizeEnv(patch.env),
      cwd: patch.cwd ? normalizeWorkspaceRoot(patch.cwd) : server.cwd,
      updatedAt: now()
    };
    Object.assign(server, next);
    this.save();
    return server;
  }

  removeMcpServer(serverId) {
    const index = this.state.mcpServers.findIndex((server) => server.id === serverId);
    if (index < 0) return null;
    const [server] = this.state.mcpServers.splice(index, 1);
    this.save();
    return server;
  }

  listTasks() {
    return this.state.tasks;
  }

  updateTask(taskId, patch) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return null;
    Object.assign(task, patch);
    this.save();
    return task;
  }

  listApprovals() {
    return this.state.approvals;
  }

  getApproval(approvalId) {
    return this.state.approvals.find((approval) => approval.id === approvalId);
  }

  createApproval({ title, detail, kind = 'generic', payload = {}, risk = 'medium' }) {
    const approval = {
      id: randomUUID(),
      title: String(title || '').trim() || '待审批动作',
      detail: String(detail || '').trim(),
      kind,
      payload,
      risk,
      status: 'pending',
      createdAt: now(),
      updatedAt: now()
    };
    this.state.approvals.unshift(approval);
    this.save();
    return approval;
  }

  decideApproval(approvalId, decision, decidedBy = 'local-user') {
    const approval = this.getApproval(approvalId);
    if (!approval) return null;
    approval.status = decision === 'approved' ? 'approved' : 'rejected';
    approval.decidedBy = decidedBy;
    approval.decidedAt = now();
    approval.updatedAt = now();
    this.save();
    return approval;
  }

  consumeApproval(approvalId, result = {}) {
    const approval = this.getApproval(approvalId);
    if (!approval) return null;
    approval.status = 'used';
    approval.result = result;
    approval.usedAt = now();
    approval.updatedAt = now();
    this.save();
    return approval;
  }

  listMemories() {
    return [...this.state.memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createMemory({ title, content, tags = [], source = 'manual' }) {
    const memory = {
      id: randomUUID(),
      title: String(title || '').trim(),
      content: String(content || '').trim(),
      tags: uniqueTags(tags),
      source: String(source || 'manual'),
      createdAt: now(),
      updatedAt: now()
    };
    if (!memory.title || !memory.content) {
      throw new Error('记忆标题和内容不能为空');
    }
    this.state.memories.unshift(memory);
    this.save();
    return memory;
  }

  deleteMemory(memoryId) {
    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) return null;
    const [memory] = this.state.memories.splice(index, 1);
    this.save();
    return memory;
  }

  addTokenUsage(entry) {
    const usage = {
      id: randomUUID(),
      sessionId: entry.sessionId || null,
      inputTokens: entry.inputTokens || 0,
      outputTokens: entry.outputTokens || 0,
      totalTokens: entry.totalTokens || (entry.inputTokens || 0) + (entry.outputTokens || 0),
      model: entry.model || 'unknown',
      timestamp: entry.timestamp || Date.now()
    };
    this.state.tokenUsage.unshift(usage);
    this.state.tokenUsage = this.state.tokenUsage.slice(0, 1000);
    this.save();
    return usage;
  }

  listTokenUsage() {
    return this.state.tokenUsage;
  }

  listModelConfigs() {
    return this.state.modelConfigs || [];
  }

  upsertModelConfig(config) {
    if (!Array.isArray(this.state.modelConfigs)) {
      this.state.modelConfigs = [];
    }
    const idx = this.state.modelConfigs.findIndex(c => c.id === config.id);
    if (idx >= 0) {
      this.state.modelConfigs[idx] = { ...this.state.modelConfigs[idx], ...config, updatedAt: now() };
    } else {
      this.state.modelConfigs.push({ id: randomUUID(), ...config, createdAt: now(), updatedAt: now() });
    }
    this.save();
    return this.state.modelConfigs;
  }

  removeModelConfig(id) {
    if (!Array.isArray(this.state.modelConfigs)) return null;
    const idx = this.state.modelConfigs.findIndex(c => c.id === id);
    if (idx < 0) return null;
    const [removed] = this.state.modelConfigs.splice(idx, 1);
    this.save();
    return removed;
  }

  search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      return { query: q, sessions: [], messages: [], memories: [], skills: [] };
    }
    const includes = (value) => String(value || '').toLowerCase().includes(q);
    const sessions = this.state.sessions.filter((session) => includes(session.title)).slice(0, 20);
    const messages = this.state.messages
      .filter((message) => includes(message.content))
      .slice(-50)
      .reverse()
      .map((message) => ({
        ...message,
        sessionTitle: this.getSession(message.sessionId)?.title || '未知会话'
      }));
    const memories = this.state.memories
      .filter((memory) => includes(memory.title) || includes(memory.content) || memory.tags.some(includes))
      .slice(0, 20);
    const skills = this.state.skills
      .filter((skill) => includes(skill.name) || includes(skill.description) || includes(skill.source))
      .slice(0, 20);
    return { query: q, sessions, messages, memories, skills };
  }
}
