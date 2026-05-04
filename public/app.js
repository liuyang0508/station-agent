const state = {
  health: null,
  blueprint: null,
  sessions: [],
  messages: [],
  skills: [],
  connectors: [],
  mcpServers: [],
  tasks: [],
  approvals: [],
  memories: [],
  searchResults: null,
  searchStatus: 'Ready',
  commandOutput: '审批通过后可执行只读命令。',
  workspace: null,
  workspacePreview: '选择一个文本文件预览内容。',
  activeWorkspacePath: '.',
  modelTestStatus: '未测试',
  settings: null,
  activeSessionId: null,
  activeView: 'chat',
  trace: [],
  sending: false,
  tabs: [],
  activeTabIndex: 0,
  commandPaletteOpen: false,
  sidebarVisible: true,
  currentRunId: null
};

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error || response.statusText);
  }
  return response.json();
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeText(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function renderMarkdown(value) {
  if (typeof marked !== 'undefined' && value) {
    try {
      marked.setOptions({ breaks: true, gfm: true, tables: true });
      return marked.parse(value);
    } catch {
      return escapeText(value);
    }
  }
  return escapeText(value);
}

async function loadBaseData() {
  const [health, blueprint, sessions, skills, connectors, mcpServers, tasks, approvals, memories, settings] =
    await Promise.all([
      api('/api/health'),
      api('/api/blueprint'),
      api('/api/sessions'),
      api('/api/skills'),
      api('/api/connectors'),
      api('/api/mcp'),
      api('/api/tasks'),
      api('/api/approvals'),
      api('/api/memories'),
      api('/api/settings')
    ]);

  state.health = health;
  state.blueprint = blueprint;
  state.sessions = sessions;
  state.skills = skills;
  state.connectors = connectors;
  state.mcpServers = mcpServers;
  state.tasks = tasks;
  state.approvals = approvals;
  state.memories = memories;
  state.settings = settings;
  state.activeSessionId ||= sessions[0]?.id;

  if (state.activeSessionId) {
    state.messages = await api(`/api/sessions/${state.activeSessionId}/messages`);
  }
}

async function loadWorkspace(path = '.') {
  state.activeWorkspacePath = path || '.';
  state.workspace = await api(`/api/workspace/list?path=${encodeURIComponent(state.activeWorkspacePath)}`);
}

function renderHealth() {
  const healthDot = $('#healthDot');
  const healthText = $('#healthText');
  const runtimeEyebrow = $('#runtimeEyebrow');
  healthDot.classList.toggle('ok', Boolean(state.health?.ok));
  healthText.textContent = state.health?.ok ? '本地服务在线' : '服务异常';
  runtimeEyebrow.textContent = `${state.health?.runtime?.provider || 'runtime'} · ${
    state.health?.runtime?.model || 'model'
  }`;
}

function renderRuntimePanel() {
  const runtime = state.health?.runtime || {};
  const rows = [
    ['模式', runtime.mode],
    ['Provider', runtime.provider],
    ['Model', runtime.model],
    ['Base URL', runtime.baseUrlConfigured ? '已配置' : '未配置'],
    ['API Key', runtime.apiKeyDetected ? `${runtime.apiKeySource} ${runtime.apiKeyPreview}` : '未检测'],
    ['Server PID', state.health?.server?.pid],
    ['Node', state.health?.server?.node],
    ['Exec', state.health?.server?.execPath?.includes('.app/') ? '内置运行时' : '系统运行时'],
    ['工作区', state.health?.workspaceRoot || '']
  ];

  $('#runtimePanel').innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="runtime-row">
          <span>${escapeText(label)}</span>
          <span>${escapeText(value || '-')}</span>
        </div>
      `
    )
    .join('');
}

function renderReferences() {
  $('#referenceList').innerHTML = (state.blueprint?.references || [])
    .map(
      (item) => `
        <div class="reference-item">
          <div class="reference-title">${escapeText(item.repo)}</div>
          <div class="reference-detail">${escapeText(item.role)}</div>
        </div>
      `
    )
    .join('');
}

function renderSessions() {
  const active = state.sessions.find((session) => session.id === state.activeSessionId);
  $('#activeTitle').textContent = active?.title || 'AIAgent Client';
  $('#sessionList').innerHTML = state.sessions
    .map(
      (session) => `
        <button class="session-item ${session.id === state.activeSessionId ? 'active' : ''}" type="button" data-session-id="${session.id}">
          <div class="session-title">${escapeText(session.title)}</div>
          <div class="session-meta">${escapeText(session.status)} · ${formatTime(session.updatedAt)}</div>
        </button>
      `
    )
    .join('');

  document.querySelectorAll('[data-session-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.activeSessionId = button.dataset.sessionId;
      state.messages = await api(`/api/sessions/${state.activeSessionId}/messages`);
      state.trace = [];
      render();
    });
  });
}

function renderMessages() {
  const feed = $('#messageFeed');
  feed.innerHTML = state.messages
    .map(
      (message) => `
        <article class="message ${message.role}">
          <div class="message-role">${message.role === 'assistant' ? 'Agent' : 'You'}</div>
          <div class="message-content">${message.role === 'assistant' ? renderMarkdown(message.content) : escapeText(message.content)}</div>
        </article>
      `
    )
    .join('');
  feed.scrollTop = feed.scrollHeight;
}

function renderTrace() {
  if (!state.trace.length) {
    $('#traceList').innerHTML = `
      <div class="trace-item">
        <div class="trace-title">等待运行</div>
        <div class="trace-detail">新的 Agent 运行会显示在这里。</div>
      </div>
    `;
    return;
  }

  $('#traceList').innerHTML = state.trace
    .map(
      (item) => `
        <div class="trace-item">
          <div class="trace-title">${escapeText(item.title || item.tool || item.type)}</div>
          <div class="trace-detail">${escapeText(item.detail || item.status || '')}</div>
        </div>
      `
    )
    .join('');
}

function statusPill(status) {
  return `<span class="pill ${escapeText(status)}">${escapeText(status)}</span>`;
}

function renderSkills() {
  $('#skillCount').textContent = `${state.skills.filter((skill) => skill.enabled).length}/${state.skills.length}`;
  $('#skillGrid').innerHTML = state.skills
    .map(
      (skill) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(skill.name)}</div>
            <div class="item-detail">${escapeText(skill.description)}</div>
          </div>
          <div class="item-footer">
            ${statusPill(skill.enabled ? 'enabled' : 'paused')}
            <button class="skill-toggle" type="button" data-skill-run-id="${skill.id}">
              运行
            </button>
            <button class="skill-toggle" type="button" data-skill-id="${skill.id}">
              ${skill.enabled ? '停用' : '启用'}
            </button>
          </div>
        </article>
      `
    )
    .join('');

  document.querySelectorAll('[data-skill-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/skills/${button.dataset.skillId}/toggle`, { method: 'POST' });
      state.skills = await api('/api/skills');
      renderSkills();
      renderRuntimePanel();
    });
  });

  document.querySelectorAll('[data-skill-run-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await api(`/api/skills/${button.dataset.skillRunId}/run`, {
        method: 'POST',
        body: JSON.stringify({ input: { sessionId: state.activeSessionId } })
      });
      state.trace.unshift({
        title: `技能运行: ${result.skillName}`,
        detail: result.error || result.output || result.status,
        status: result.status
      });
      renderTrace();
    });
  });
}

function renderConnectors() {
  $('#connectorGrid').innerHTML = state.connectors
    .map(
      (connector) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(connector.name)}</div>
            <div class="item-detail">${escapeText(connector.source)} · ${escapeText(connector.channel)}</div>
          </div>
          <div class="item-footer">${statusPill(connector.status)}</div>
        </article>
      `
    )
    .join('');
}

function renderMcp() {
  $('#mcpGrid').innerHTML = state.mcpServers
    .map(
      (server) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(server.name)}</div>
            <div class="item-detail">${escapeText(server.command || '未配置命令')} ${escapeText((server.args || []).join(' '))}<br>${escapeText(server.cwd || '')}</div>
          </div>
          <div class="item-footer">
            ${statusPill(server.status || 'stopped')}
            <button class="skill-toggle" type="button" data-mcp-start="${server.id}">启动</button>
            <button class="skill-toggle" type="button" data-mcp-stop="${server.id}">停止</button>
          </div>
        </article>
      `
    )
    .join('');

  document.querySelectorAll('[data-mcp-start]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/mcp/${button.dataset.mcpStart}/start`, { method: 'POST' });
      state.mcpServers = await api('/api/mcp');
      renderMcp();
    });
  });
  document.querySelectorAll('[data-mcp-stop]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/mcp/${button.dataset.mcpStop}/stop`, { method: 'POST' });
      state.mcpServers = await api('/api/mcp');
      renderMcp();
    });
  });
}

function renderTasks() {
  $('#taskGrid').innerHTML = state.tasks
    .map(
      (task) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(task.title)}</div>
            <div class="item-detail">${escapeText(task.cadence)} · ${escapeText(task.target)}</div>
          </div>
          <div class="item-footer">${statusPill(task.status)}</div>
        </article>
      `
    )
    .join('');
}

function renderWorkspace() {
  $('#workspacePathLabel').textContent = state.workspace?.path || state.activeWorkspacePath || '.';
  if (!state.workspace) {
    $('#workspaceList').innerHTML =
      '<button class="file-row" type="button"><span class="file-name">未加载</span><span class="file-kind">idle</span></button>';
    $('#workspacePreview').textContent = state.workspacePreview;
    return;
  }

  const parentRow = state.workspace.parent
    ? `
      <button class="file-row" type="button" data-workspace-path="${escapeText(state.workspace.parent)}">
        <span class="file-name">..</span>
        <span class="file-kind">parent</span>
      </button>
    `
    : '';

  $('#workspaceList').innerHTML =
    parentRow +
    state.workspace.entries
      .map(
        (entry) => `
          <button class="file-row" type="button" data-workspace-path="${escapeText(entry.path)}" data-workspace-kind="${escapeText(entry.kind)}">
            <span class="file-name">${escapeText(entry.name)}</span>
            <span class="file-kind">${escapeText(entry.kind)}</span>
          </button>
        `
      )
      .join('');
  $('#workspacePreview').textContent = state.workspacePreview;

  document.querySelectorAll('[data-workspace-path]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextPath = button.dataset.workspacePath || '.';
      if (button.dataset.workspaceKind === 'file') {
        try {
          const file = await api(`/api/workspace/read?path=${encodeURIComponent(nextPath)}`);
          state.workspacePreview = `# ${file.path}\n\n${file.content}`;
        } catch (error) {
          state.workspacePreview = error.message;
        }
      } else {
        state.workspacePreview = '选择一个文本文件预览内容。';
        await loadWorkspace(nextPath);
      }
      renderWorkspace();
    });
  });
}

function renderApprovals() {
  $('#approvalModeLabel').textContent = state.settings?.approvalMode || 'ask';
  $('#commandOutput').textContent = state.commandOutput;
  $('#approvalGrid').innerHTML = state.approvals
    .map(
      (approval) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(approval.title)}</div>
            <div class="item-detail">${escapeText(approval.detail)}</div>
          </div>
          <div class="item-footer">
            ${statusPill(approval.status)}
            ${
              approval.status === 'pending'
                ? `<button class="skill-toggle" type="button" data-approval-approve="${approval.id}">批准</button>
                   <button class="skill-toggle" type="button" data-approval-reject="${approval.id}">拒绝</button>`
                : ''
            }
            ${
              approval.status === 'approved' && approval.kind === 'command'
                ? `<button class="skill-toggle" type="button" data-command-run="${approval.id}">执行</button>`
                : ''
            }
          </div>
        </article>
      `
    )
    .join('');

  document.querySelectorAll('[data-approval-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/approvals/${button.dataset.approvalApprove}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved' })
      });
      state.approvals = await api('/api/approvals');
      renderApprovals();
    });
  });
  document.querySelectorAll('[data-approval-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/approvals/${button.dataset.approvalReject}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'rejected' })
      });
      state.approvals = await api('/api/approvals');
      renderApprovals();
    });
  });
  document.querySelectorAll('[data-command-run]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await api('/api/tools/system/run', {
        method: 'POST',
        body: JSON.stringify({ approvalId: button.dataset.commandRun })
      });
      state.commandOutput = [
        `$ ${result.command}`,
        `cwd: ${result.cwd}`,
        `exit: ${result.exitCode} · ${result.durationMs}ms`,
        result.stdout,
        result.stderr ? `stderr:\n${result.stderr}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      state.approvals = await api('/api/approvals');
      renderApprovals();
    });
  });
}

function renderSearch() {
  $('#searchStatus').textContent = state.searchStatus;
  if (!state.searchResults) {
    $('#searchResults').innerHTML = '<div class="item-detail">输入关键词搜索会话、消息、长期记忆和技能。</div>';
    return;
  }
  const sections = [
    ['会话', state.searchResults.sessions, (item) => item.title],
    ['消息', state.searchResults.messages, (item) => `${item.sessionTitle}: ${item.content}`],
    ['记忆', state.searchResults.memories, (item) => `${item.title}: ${item.content}`],
    ['技能', state.searchResults.skills, (item) => `${item.name}: ${item.description}`]
  ];
  $('#searchResults').innerHTML = sections
    .map(
      ([title, items, formatter]) => `
        <section class="search-block">
          <div class="search-heading">${title} · ${items.length}</div>
          ${items
            .slice(0, 10)
            .map((item) => `<div class="search-hit">${escapeText(formatter(item)).slice(0, 500)}</div>`)
            .join('') || '<div class="item-detail">无结果</div>'}
        </section>
      `
    )
    .join('');
}

function renderMemory() {
  $('#memoryCount').textContent = `${state.memories.length}`;
  $('#memoryGrid').innerHTML = state.memories
    .map(
      (memory) => `
        <article class="item-card">
          <div>
            <div class="item-title">${escapeText(memory.title)}</div>
            <div class="item-detail">${escapeText(memory.content)}</div>
          </div>
          <div class="item-footer">
            ${statusPill((memory.tags || [memory.source || 'memory'])[0] || 'memory')}
            <button class="skill-toggle" type="button" data-memory-delete="${memory.id}">删除</button>
          </div>
        </article>
      `
    )
    .join('');

  document.querySelectorAll('[data-memory-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/memories/${button.dataset.memoryDelete}`, { method: 'DELETE' });
      state.memories = await api('/api/memories');
      renderMemory();
    });
  });
}

function renderSettings() {
  $('#workspaceRootInput').value = state.settings?.workspaceRoot || '';
  $('#runtimeModeInput').value = state.settings?.runtimeMode || 'demo';
  $('#baseUrlInput').value = state.settings?.baseUrl || '';
  $('#modelInput').value = state.settings?.model || '';
  $('#apiKeyEnvInput').value = state.settings?.apiKeyEnv || 'AIAGENT_API_KEY';
  $('#apiKeyInput').value = '';
  $('#modelTestStatus').textContent = state.modelTestStatus;
  $('#autonomousModeInput').checked = state.settings?.autonomousMode || false;
  renderTokenBudget();
}

async function renderTokenBudget() {
  try {
    const data = await api('/api/token-usage');
    const fill = $('#tokenBudgetFill');
    const stats = $('#tokenBudgetStats');
    if (!fill || !stats) return;
    const pct = data.windowPercent || 0;
    fill.style.width = `${Math.min(pct, 100)}%`;
    fill.classList.remove('warning', 'danger');
    if (pct > 80) fill.classList.add('danger');
    else if (pct > 50) fill.classList.add('warning');
    const used = data.windowTokens?.total || 0;
    const limit = data.dailyLimit || 100000;
    stats.textContent = `已用 ${used.toLocaleString()} / ${limit.toLocaleString()} (${pct}%) · 剩余 ${data.remaining?.toLocaleString() || 0}`;
  } catch {
    const stats = $('#tokenBudgetStats');
    if (stats) stats.textContent = '无法加载用量数据';
  }
}

function renderViews() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.activeView);
  });

  const views = [
    'chat',
    'skills',
    'connectors',
    'mcp',
    'workspace',
    'search',
    'tasks',
    'security',
    'memory',
    'diff',
    'subagents',
    'settings'
  ];
  for (const view of views) {
    $(`#view${view[0].toUpperCase()}${view.slice(1)}`).classList.toggle(
      'hidden',
      view !== state.activeView
    );
  }
}

function render() {
  renderHealth();
  renderRuntimePanel();
  renderSessions();
  renderMessages();
  renderTrace();
  renderSkills();
  renderConnectors();
  renderMcp();
  renderWorkspace();
  renderSearch();
  renderTasks();
  renderApprovals();
  renderMemory();
  renderSettings();
  renderViews();
  $('#sendButton').disabled = state.sending;
}

function appendAssistantDelta(delta) {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.id !== 'streaming') {
    state.messages.push({
      id: 'streaming',
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    });
  }
  state.messages[state.messages.length - 1].content += delta;
  renderMessages();
}

let thinkingContent = '';

async function sendPrompt(prompt) {
  state.sending = true;
  state.trace = [];
  thinkingContent = '';

  // Show thinking panel with pending indicator
  const thinkEl = $('#thinkingContent');
  if (thinkEl) {
    thinkingContent = '正在分析任务...\n';
    thinkEl.textContent = thinkingContent;
    thinkEl.classList.add('visible');
  }

  // Add pending trace to show activity
  state.trace.push({ title: '等待响应', detail: '正在连接 Agent 运行时...', status: 'running' });
  renderTrace();

  state.messages.push({
    id: `local-${Date.now()}`,
    role: 'user',
    content: prompt,
    createdAt: new Date().toISOString()
  });
  render();

  const { runId } = await api('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ sessionId: state.activeSessionId, prompt })
  });

  state.currentRunId = runId;
  const events = new EventSource(`/api/runs/${runId}/events`);
  events.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    if (event.type === 'assistant.delta') {
      appendAssistantDelta(event.delta);
    } else if (event.type === 'thinking') {
      thinkingContent += event.detail;
      const thinkEl = $('#thinkingContent');
      if (thinkEl) {
        // Keep initial message if present
        const initialMsg = thinkingContent.startsWith('正在分析任务') ? '' : '正在分析任务...\n';
        thinkEl.textContent = initialMsg + thinkingContent;
        thinkEl.classList.toggle('visible', thinkingContent.length > 0);
      }
    } else if (event.type === 'trace' || event.type === 'tool') {
      state.trace.push(event);
      renderTrace();
    } else if (event.type === 'stored') {
      events.close();
      state.currentRunId = null;
      thinkingContent = '';
      const thinkEl = $('#thinkingContent');
      if (thinkEl) thinkEl.classList.remove('visible');
      state.messages = await api(`/api/sessions/${state.activeSessionId}/messages`);
      state.sessions = await api('/api/sessions');
      state.health = await api('/api/health');
      state.sending = false;
      render();
    } else if (event.type === 'error') {
      events.close();
      state.sending = false;
      state.trace.push({ title: '运行失败', detail: event.message, status: 'error' });
      render();
    } else if (event.type === 'terminal') {
      state.commandOutput = (state.commandOutput || '') + event.delta;
      $('#terminalOutput').textContent = state.commandOutput;
      $('#terminalOutput').classList.add('active');
    } else if (event.type === 'done') {
      // Safety net: close SSE and reset state if runtime signals done
      events.close();
      state.currentRunId = null;
      thinkingContent = '';
      const thinkEl = $('#thinkingContent');
      if (thinkEl) thinkEl.classList.remove('visible');
      state.messages = await api(`/api/sessions/${state.activeSessionId}/messages`);
      state.sessions = await api('/api/sessions');
      state.health = await api('/api/health');
      state.sending = false;
      render();
    }
  };

  events.onerror = () => {
    events.close();
    state.sending = false;
    state.trace.push({ title: '连接中断', detail: 'SSE 连接已关闭', status: 'error' });
    render();
  };
}

function bindEvents() {
  $('#composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#promptInput');
    const prompt = input.value.trim();
    if (!prompt || state.sending) return;
    input.value = '';
    await sendPrompt(prompt);
  });

  $('#promptInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      $('#composer').dispatchEvent(new Event('submit'));
    }
  });

  $('#newSessionButton').addEventListener('click', async () => {
    const session = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '新的 Agent 会话' })
    });
    state.activeSessionId = session.id;
    state.sessions = await api('/api/sessions');
    state.messages = await api(`/api/sessions/${session.id}/messages`);
    state.trace = [];
    render();
  });

  $('#exportSessionButton').addEventListener('click', () => {
    if (!state.activeSessionId) return;
    const link = document.createElement('a');
    link.href = `/api/sessions/${state.activeSessionId}/export?format=markdown`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', async () => {
      state.activeView = button.dataset.view;
      if (state.activeView === 'workspace' && !state.workspace) {
        await loadWorkspace('.');
        renderWorkspace();
      }
      renderViews();
    });
  });

  // Skill file upload zone
  const uploadZone = $('#skillUploadZone');
  const fileInput = $('#skillFileInput');
  const fileSelectBtn = $('#skillFileSelectBtn');
  const fileNameDisplay = $('#skillFileName');
  let selectedFile = null;

  if (fileSelectBtn && fileInput) {
    fileSelectBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        selectedFile = fileInput.files[0];
        fileNameDisplay.textContent = selectedFile.name;
        fileNameDisplay.classList.add('has-file');
      }
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        fileNameDisplay.textContent = selectedFile.name;
        fileNameDisplay.classList.add('has-file');
      }
    });
  }

  $('#skillInstallForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData();
    const form = event.currentTarget;
    const pathValue = form.querySelector('[name="path"]').value.trim();
    const nameValue = form.querySelector('[name="name"]').value.trim();

    if (selectedFile) {
      formData.append('file', selectedFile);
    } else if (pathValue) {
      formData.append('path', pathValue);
    } else {
      alert('请上传文件或填入工作区路径');
      return;
    }

    if (nameValue) {
      formData.append('name', nameValue);
    }

    try {
      const endpoint = selectedFile ? '/api/skills/upload' : '/api/skills/install';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '安装失败');

      selectedFile = null;
      fileNameDisplay.textContent = '';
      fileNameDisplay.classList.remove('has-file');
      fileInput.value = '';
      form.reset();
      state.skills = await api('/api/skills');
      renderSkills();
    } catch (error) {
      alert('安装失败: ' + error.message);
    }
  });

  $('#mcpForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    await api('/api/mcp', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        args: String(payload.args || '')
          .split(/\s+/)
          .filter(Boolean)
      })
    });
    event.currentTarget.reset();
    state.mcpServers = await api('/api/mcp');
    renderMcp();
  });

  $('#searchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get('q') || '').trim();
    if (!query) return;
    state.searchStatus = '搜索中...';
    renderSearch();
    state.searchResults = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.searchStatus = `完成 · ${query}`;
    renderSearch();
  });

  $('#commandApprovalForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const command = String(payload.command || '').trim();
    if (!command) return;
    const approval = await api('/api/approvals/request', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'command',
        command,
        cwd: payload.cwd || '.'
      })
    });
    state.commandOutput = `已创建审批: ${approval.title}`;
    event.currentTarget.reset();
    state.approvals = await api('/api/approvals');
    renderApprovals();
  });

  $('#memoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    await api('/api/memories', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    state.memories = await api('/api/memories');
    state.health = await api('/api/health');
    render();
  });

  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const apiKey = String(payload.apiKey || '').trim();
    delete payload.apiKey;
    state.settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    if (apiKey) {
      await api('/api/secrets/model-key', {
        method: 'PATCH',
        body: JSON.stringify({ apiKey })
      });
    }
    state.health = await api('/api/health');
    render();
  });

  $('#testModelButton').addEventListener('click', async () => {
    state.modelTestStatus = '测试中...';
    renderSettings();
    try {
      const result = await api('/api/runtime/test-model', { method: 'POST' });
      state.modelTestStatus = result.ok
        ? `可用 · ${result.latencyMs}ms · ${result.model || ''}`
        : `不可用 · ${result.message}`;
      state.health = await api('/api/health');
    } catch (error) {
      state.modelTestStatus = `失败 · ${error.message}`;
    }
    render();
  });

  // Settings backup handlers
  $('#exportSettingsBtn')?.addEventListener('click', async () => {
    const response = await fetch('/api/settings/sync');
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'station-agent-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#importSettingsBtn')?.addEventListener('click', () => {
    $('#settingsImportInput').click();
  });

  $('#settingsImportInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const response = await api('/api/settings/sync', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      alert(response.message || '导入成功');
      state.health = await api('/api/health');
      render();
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
    e.target.value = '';
  });

  $('#cloudBackupBtn')?.addEventListener('click', () => {
    const form = $('#cloudBackupForm');
    if (form) form.classList.toggle('hidden');
  });

  $('#cloudBackupConfirmBtn')?.addEventListener('click', async () => {
    const endpoint = $('#cloudEndpointInput')?.value?.trim();
    if (!endpoint) { alert('请输入云端备份地址'); return; }
    const apiKey = $('#cloudApiKeyInput')?.value?.trim();
    try {
      const result = await api('/api/settings/cloud-backup', {
        method: 'POST',
        body: JSON.stringify({ endpoint, apiKey })
      });
      alert(result.message || '备份成功');
      $('#cloudBackupForm')?.classList.add('hidden');
    } catch (err) {
      alert('备份失败: ' + err.message);
    }
  });

  // ── Keyboard Shortcuts ──
  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;

    if (event.key === 'k' || event.key === 'K') {
      // Cmd+K: toggle command palette
      event.preventDefault();
      toggleCommandPalette();
    } else if (event.key === 't' || event.key === 'T') {
      // Cmd+T: new session
      event.preventDefault();
      newSession();
    } else if (event.key === 'w' || event.key === 'W') {
      // Cmd+W: close current tab
      event.preventDefault();
      closeActiveTab();
    } else if (event.key === '1' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(0);
    } else if (event.key === '2' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(1);
    } else if (event.key === '3' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(2);
    } else if (event.key === '4' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(3);
    } else if (event.key === '5' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(4);
    } else if (event.key === '6' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(5);
    } else if (event.key === '7' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(6);
    } else if (event.key === '8' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(7);
    } else if (event.key === '9' && !event.shiftKey) {
      event.preventDefault();
      switchToTab(8);
    } else if (event.key === '/') {
      // Cmd+/: toggle sidebar
      event.preventDefault();
      toggleSidebar();
    } else if (event.key === 'l' || event.key === 'L') {
      // Cmd+L: focus search
      event.preventDefault();
      state.activeView = 'search';
      renderViews();
    } else if (event.key === 'n' || event.key === 'N') {
      // Cmd+N: new session (alternative)
      event.preventDefault();
      newSession();
    } else if (event.key === 's' || event.key === 'S') {
      // Cmd+S: export current session
      event.preventDefault();
      exportCurrentSession();
    } else if (event.key === ',') {
      // Cmd+,: open settings
      event.preventDefault();
      state.activeView = 'settings';
      renderViews();
    }
  });

  // Palette input handler
  $('#paletteInput')?.addEventListener('input', (e) => {
    renderPaletteResults(e.target.value);
  });

  // Palette backdrop closes it
  $('.palette-backdrop')?.addEventListener('click', () => {
    toggleCommandPalette();
  });

  // Escape: cancel current run
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.sending && state.currentRunId) {
        api(`/api/runs/${state.currentRunId}/cancel`, { method: 'POST' }).catch(() => {});
        state.trace.push({ title: '已取消', detail: '运行被用户中断', status: 'error' });
        renderTrace();
      }
    }
  });

  // Voice input
  const voiceBtn = $('#voiceInputBtn');
  let recognition = null;
  if (voiceBtn && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceBtn.addEventListener('click', () => {
      if (recognition && recognition.recording) {
        recognition.stop();
        voiceBtn.classList.remove('recording');
        recognition.recording = false;
        return;
      }
      recognition = new SR();
      recognition.recording = true;
      recognition.lang = state.settings?.language === 'zh-CN' ? 'zh-CN' : 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      voiceBtn.classList.add('recording');
      recognition.start();
      recognition.onresult = (e) => {
        const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
        const input = $('#promptInput');
        if (input) input.value = (input.value + ' ' + transcript).trim();
      };
      recognition.onerror = () => {
        voiceBtn.classList.remove('recording');
        recognition.recording = false;
      };
      recognition.onend = () => {
        voiceBtn.classList.remove('recording');
        if (recognition) recognition.recording = false;
      };
    });
  }

  // Diff viewer
  $('#diffRunBtn')?.addEventListener('click', async () => {
    const oldPath = $('#diffOldPath')?.value?.trim();
    const newPath = $('#diffNewPath')?.value?.trim();
    if (!oldPath || !newPath) return;
    try {
      const result = await api('/api/diff', {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath })
      });
      const output = $('#diffOutput');
      if (!result.identical && result.lines) {
        output.innerHTML = result.lines.map(line => {
          const cls = line.startsWith('+') ? 'diff-line-added' : line.startsWith('-') ? 'diff-line-removed' : '';
          return `<div class="${cls}">${escapeText(line)}</div>`;
        }).join('');
      } else {
        output.innerHTML = '<div class="item-detail">文件相同，无差异。</div>';
      }
    } catch (err) {
      $('#diffOutput').innerHTML = `<div class="item-detail" style="color:var(--danger)">${escapeText(err.message)}</div>`;
    }
  });

  // Subagent refresh
  async function refreshSubagents() {
    try {
      const subagents = await api('/api/subagents');
      $('#subagentCount').textContent = subagents.length;
      if (subagents.length === 0) {
        $('#subagentList').innerHTML = '<div class="item-detail">暂无活跃的子代理。</div>';
        return;
      }
      $('#subagentList').innerHTML = subagents.map(s => `
        <div class="subagent-item">
          <div class="subagent-title">${escapeText(s.task || '子任务')}</div>
          <div class="subagent-meta">${s.status} · ${s.priority} · ${s.createdAt ? formatTime(s.createdAt) : ''}</div>
        </div>
      `).join('');
    } catch {
      // ignore
    }
  }

  // Poll subagents when on subagents view
  const originalRenderViews = renderViews;
  const subagentPollInterval = setInterval(refreshSubagents, 5000);

  // Cleanup on unload
  window.addEventListener('unload', () => clearInterval(subagentPollInterval));
}

async function init() {
  bindEvents();
  try {
    await loadBaseData();
    // Initialize tabs from sessions
    state.tabs = state.sessions.slice(0, 5).map(s => ({
      id: s.id,
      sessionId: s.id,
      title: s.title
    }));
    state.activeTabIndex = 0;
    state.activeSessionId = state.tabs[0]?.sessionId || state.sessions[0]?.id;
    state.messages = state.activeSessionId
      ? await api(`/api/sessions/${state.activeSessionId}/messages`)
      : [];
    render();
  } catch (error) {
    $('#healthText').textContent = error.message;
    $('#healthDot').classList.remove('ok');
  }
}

// ── Tab Management ──
async function newSession() {
  const session = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: '新的 Agent 会话' })
  });
  const tab = { id: session.id, sessionId: session.id, title: session.title };
  state.tabs.push(tab);
  state.activeTabIndex = state.tabs.length - 1;
  state.activeSessionId = session.id;
  state.messages = [];
  state.trace = [];
  state.sessions = await api('/api/sessions');
  render();
  renderTabs();
}

function closeActiveTab() {
  if (state.tabs.length <= 1) return;
  state.tabs.splice(state.activeTabIndex, 1);
  if (state.activeTabIndex >= state.tabs.length) {
    state.activeTabIndex = state.tabs.length - 1;
  }
  state.activeSessionId = state.tabs[state.activeTabIndex].sessionId;
  loadSessionMessages(state.activeSessionId);
  renderTabs();
}

function switchToTab(index) {
  if (index < 0 || index >= state.tabs.length) return;
  state.activeTabIndex = index;
  state.activeSessionId = state.tabs[index].sessionId;
  loadSessionMessages(state.activeSessionId);
  renderTabs();
}

async function loadSessionMessages(sessionId) {
  state.messages = await api(`/api/sessions/${sessionId}/messages`);
  state.trace = [];
  render();
  renderTabs();
}

function renderTabs() {
  const tabBar = $('#tabBar');
  if (!tabBar) return;
  tabBar.innerHTML = state.tabs.map((tab, i) => `
    <button class="tab-item ${i === state.activeTabIndex ? 'active' : ''}"
            data-tab-index="${i}" type="button" title="${escapeText(tab.title)}">
      <span class="tab-title">${escapeText(tab.title || '未命名')}</span>
      ${state.tabs.length > 1 ? `<button class="tab-close" data-tab-close="${i}" type="button">×</button>` : ''}
    </button>
  `).join('');

  document.querySelectorAll('[data-tab-index]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      switchToTab(parseInt(btn.dataset.tabIndex));
    });
  });

  document.querySelectorAll('[data-tab-close]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.tabClose);
      if (state.tabs[idx].sessionId === state.activeSessionId) {
        closeActiveTab();
      } else {
        state.tabs.splice(idx, 1);
        if (state.activeTabIndex >= state.tabs.length) {
          state.activeTabIndex = state.tabs.length - 1;
        }
        renderTabs();
      }
    });
  });
}

// ── Command Palette ──
function toggleCommandPalette() {
  state.commandPaletteOpen = !state.commandPaletteOpen;
  const palette = $('#commandPalette');
  if (palette) {
    palette.classList.toggle('visible', state.commandPaletteOpen);
    if (state.commandPaletteOpen) {
      $('#paletteInput').focus();
      $('#paletteInput').value = '';
      $('#paletteResults').innerHTML = '';
    }
  }
}

function renderPaletteResults(query) {
  const commands = [
    { id: 'new-session', label: '新会话', detail: 'Cmd+T', shortcut: '⌘T' },
    { id: 'close-tab', label: '关闭当前标签页', detail: 'Cmd+W', shortcut: '⌘W' },
    { id: 'export', label: '导出会话', detail: '导出为 Markdown', shortcut: '⌘S' },
    { id: 'settings', label: '打开设置', detail: '打开运行设置面板', shortcut: '⌘,' },
    { id: 'search', label: '搜索', detail: '搜索会话和记忆', shortcut: '⌘L' },
    { id: 'toggle-sidebar', label: '切换侧边栏', detail: '显示/隐藏侧边栏', shortcut: '⌘/' },
    { id: 'toggle-thinking', label: '切换思考过程面板', detail: '显示/隐藏思考过程', shortcut: '' },
    { id: 'clear-session', label: '清空当前会话', detail: '清除消息历史', shortcut: '' },
    { id: 'token-budget', label: '查看 Token 预算', detail: '查看 24h 用量统计', shortcut: '' },
    { id: 'mcp-start', label: '启动 MCP 服务', detail: '启动本地 MCP 服务', shortcut: '' },
    { id: 'skills-center', label: '技能中心', detail: '管理已安装技能', shortcut: '' },
    { id: 'memory-manager', label: '记忆管理', detail: '管理长期记忆', shortcut: '' },
    { id: 'workspace', label: '工作区', detail: '浏览工作区文件', shortcut: '' },
    { id: 'approval-queue', label: '审批队列', detail: '查看待处理审批', shortcut: '' },
  ];

  const q = query.toLowerCase().trim();
  const filtered = q
    ? commands.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.detail.toLowerCase().includes(q))
    : commands.slice(0, 8);

  $('#paletteResults').innerHTML = filtered.map(cmd => `
    <button class="palette-item" data-cmd="${cmd.id}" type="button">
      <span class="palette-label">${escapeText(cmd.label)}</span>
      <span class="palette-detail">${escapeText(cmd.detail)}</span>
      ${cmd.shortcut ? `<kbd>${cmd.shortcut}</kbd>` : ''}
    </button>
  `).join('');

  document.querySelectorAll('.palette-item').forEach(btn => {
    btn.addEventListener('click', () => {
      executePaletteCommand(btn.dataset.cmd);
    });
  });
}

async function executePaletteCommand(cmdId) {
  state.commandPaletteOpen = false;
  const palette = $('#commandPalette');
  if (palette) palette.classList.remove('visible');

  switch (cmdId) {
    case 'new-session':
      await newSession();
      break;
    case 'close-tab':
      closeActiveTab();
      break;
    case 'export':
      exportCurrentSession();
      break;
    case 'settings':
      state.activeView = 'settings';
      renderViews();
      break;
    case 'search':
      state.activeView = 'search';
      renderViews();
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'toggle-thinking':
      const tp = $('#thinkingContent');
      if (tp) tp.classList.toggle('visible');
      break;
    case 'clear-session':
      // Clear local messages only
      state.messages = [];
      renderMessages();
      break;
    case 'token-budget':
      state.activeView = 'settings';
      renderViews();
      setTimeout(renderTokenBudget, 100);
      break;
    case 'mcp-start':
      state.activeView = 'mcp';
      renderViews();
      break;
    case 'skills-center':
      state.activeView = 'skills';
      renderViews();
      break;
    case 'memory-manager':
      state.activeView = 'memory';
      renderViews();
      break;
    case 'workspace':
      state.activeView = 'workspace';
      renderViews();
      break;
    case 'approval-queue':
      state.activeView = 'security';
      renderViews();
      break;
  }
}

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  document.querySelector('.sidebar')?.classList.toggle('hidden', !state.sidebarVisible);
}

function exportCurrentSession() {
  if (!state.activeSessionId) return;
  const link = document.createElement('a');
  link.href = `/api/sessions/${state.activeSessionId}/export?format=markdown`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

init();
