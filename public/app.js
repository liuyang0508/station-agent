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

// ── Command Palette Data ──
const PALETTE_COMMANDS = [
  {
    group: '会话',
    items: [
      { id: 'new-session', label: '新会话', icon: '✨', shortcut: '⌘N', action: () => newSession() },
      { id: 'export-session', label: '导出会话', icon: '📤', action: () => exportCurrentSession() },
      { id: 'clear-session', label: '清空当前会话', icon: '🗑', action: () => clearCurrentSession() },
    ]
  },
  {
    group: '导航',
    items: [
      { id: 'nav-chat', label: '切换到指挥台', icon: '💬', shortcut: '⌘1', action: () => switchView('chat') },
      { id: 'nav-skills', label: '切换到技能中心', icon: '🛠', shortcut: '⌘2', action: () => switchView('skills') },
      { id: 'nav-settings', label: '切换到设置', icon: '⚙️', shortcut: '⌘,', action: () => switchView('settings') },
      { id: 'nav-workspace', label: '切换到工作区', icon: '📁', action: () => switchView('workspace') },
    ]
  },
  {
    group: '操作',
    items: [
      { id: 'toggle-theme', label: '切换主题', icon: '🎨', action: () => document.getElementById('themeToggleButton')?.click() },
      { id: 'shortcuts-help', label: '快捷键帮助', icon: '⌨️', shortcut: '⌘/', action: () => showShortcutsHelp() },
    ]
  }
];

let selectedIndex = 0;
let flatItems = [];

function showPalette() {
  const overlay = document.getElementById('commandPaletteOverlay') || createPaletteOverlay();
  overlay.classList.add('visible');
  const input = document.getElementById('paletteInput');
  input.value = '';
  input.focus();
  renderPaletteResults('');
  selectedIndex = 0;
}

function hidePalette() {
  const overlay = document.getElementById('commandPaletteOverlay');
  if (overlay) overlay.classList.remove('visible');
}

function renderPaletteResults(query) {
  const results = document.getElementById('paletteResults');
  flatItems = [];
  PALETTE_COMMANDS.forEach(group => {
    const matched = group.items.filter(item =>
      item.label.toLowerCase().includes(query.toLowerCase())
    );
    matched.forEach(item => flatItems.push({ ...item, group: group.group }));
  });

  if (flatItems.length === 0) {
    results.innerHTML = '<div class="palette-empty">没有找到匹配的命令</div>';
    return;
  }

  results.innerHTML = flatItems.map((item, i) => `
    <div class="palette-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
      <div class="palette-item-icon">${item.icon}</div>
      <span class="palette-label">${item.label}</span>
      ${item.shortcut ? `<div class="palette-shortcut"><kbd>${item.shortcut}</kbd></div>` : ''}
    </div>
  `).join('');

  results.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      flatItems[idx].action();
      hidePalette();
    });
  });
}

function clearCurrentSession() {
  state.messages = [];
  renderMessages();
}

function showShortcutsHelp() {
  Modal.show({
    title: '快捷键',
    body: `
      <div style="display:grid;gap:8px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--text-secondary)">命令面板</span>
          <kbd style="background:var(--bg-elevated);padding:2px 8px;border-radius:4px;font-size:12px;">⌘K</kbd>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--text-secondary)">新会话</span>
          <kbd style="background:var(--bg-elevated);padding:2px 8px;border-radius:4px;font-size:12px;">⌘N</kbd>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--text-secondary)">快捷键帮助</span>
          <kbd style="background:var(--bg-elevated);padding:2px 8px;border-radius:4px;font-size:12px;">⌘/</kbd>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--text-secondary)">关闭弹窗</span>
          <kbd style="background:var(--bg-elevated);padding:2px 8px;border-radius:4px;font-size:12px;">Esc</kbd>
        </div>
      </div>
    `,
    footer: '<button class="modal-btn primary" id="modalCloseHelp">好的</button>'
  });
  document.getElementById('modalCloseHelp').addEventListener('click', () => Modal.hide());
}

function setupThemeToggle() {
  const btn = document.getElementById('themeToggleButton');
  if (!btn) return;

  // Default to dark theme, only load saved light theme if explicitly set
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    btn.textContent = '☀️';
  } else {
    // Force dark theme as default
    document.documentElement.removeAttribute('data-theme');
    btn.textContent = '🌙';
    localStorage.removeItem('theme');
  }

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light') {
      document.documentElement.removeAttribute('data-theme');
      btn.textContent = '🌙';
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      btn.textContent = '☀️';
      localStorage.setItem('theme', 'light');
    }
  });
}

function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const mod = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl+K - 命令面板
    if (mod && e.key === 'k') {
      e.preventDefault();
      showPalette();
      return;
    }

    // Cmd/Ctrl+N - 新会话
    if (mod && e.key === 'n') {
      e.preventDefault();
      newSession();
      return;
    }

    // Cmd/Ctrl+/ 或 Ctrl+? - 快捷键帮助
    if (mod && (e.key === '/' || e.key === '?')) {
      e.preventDefault();
      showShortcutsHelp();
      return;
    }

    // Escape - 关闭面板
    if (e.key === 'Escape') {
      const palette = document.getElementById('commandPaletteOverlay');
      if (palette?.classList.contains('visible')) {
        hidePalette();
        return;
      }
      if (document.getElementById('modalOverlay')?.classList.contains('visible')) {
        Modal.hide();
        return;
      }
    }
  });
}

function switchView(view) {
  state.activeView = view;
  renderViews();
}

const $ = (selector) => document.querySelector(selector);

// ── Toast Notification System ──
class Toast {
  static container = null;
  static queue = [];

  static init() {
    this.container = document.getElementById('toastContainer');
  }

  static show(message, type = 'info', duration = 4000) {
    if (!this.container) this.init();
    if (this.queue.length >= 3) {
      this.dismiss(this.queue.shift());
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close">×</button>
    `;
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    this.container.appendChild(toast);
    this.queue.push(toast);
    if (duration > 0) {
      toast.timer = setTimeout(() => this.dismiss(toast), duration);
    }
    toast.addEventListener('mouseenter', () => {
      if (toast.timer) clearTimeout(toast.timer);
    });
    toast.addEventListener('mouseleave', () => {
      toast.timer = setTimeout(() => this.dismiss(toast), duration);
    });
  }

  static dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 200);
    this.queue = this.queue.filter(t => t !== toast);
  }

  static success(msg, duration) { this.show(msg, 'success', duration); }
  static error(msg, duration) { this.show(msg, 'error', duration); }
  static warn(msg, duration) { this.show(msg, 'warning', duration); }
  static info(msg, duration) { this.show(msg, 'info', duration); }
}

// ── Modal Dialog System ──
class Modal {
  static overlay = null;

  static init() {
    this.overlay = document.getElementById('modalOverlay');
    document.getElementById('modalCloseBtn').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  static show({ title, body, footer, onClose } = {}) {
    if (!this.overlay) this.init();
    document.getElementById('modalTitle').textContent = title || '';
    document.getElementById('modalBody').innerHTML = body || '';
    document.getElementById('modalFooter').innerHTML = footer || '';
    this.overlay.classList.add('visible');
    this._onClose = onClose;
    document.body.style.overflow = 'hidden';
  }

  static hide() {
    if (!this.overlay) return;
    this.overlay.classList.remove('visible');
    document.body.style.overflow = '';
    if (this._onClose) { this._onClose(); this._onClose = null; }
  }

  static confirm(message, onConfirm, onCancel) {
    this.show({
      title: '确认操作',
      body: `<p>${message}</p>`,
      footer: `
        <button class="modal-btn secondary" id="modalCancel">取消</button>
        <button class="modal-btn primary" id="modalConfirm">确认</button>
      `
    });
    document.getElementById('modalCancel').addEventListener('click', () => {
      this.hide();
      if (onCancel) onCancel();
    });
    document.getElementById('modalConfirm').addEventListener('click', () => {
      this.hide();
      if (onConfirm) onConfirm();
    });
  }
}

// ── MCP Inspector Functions ──
function showMcpLogViewer(serverId, logs) {
  Modal.show({
    title: `MCP 日志 - ${serverId.slice(0, 8)}`,
    body: `
      <div class="mcp-log-viewer">
        <div class="log-header">
          <span class="log-pid">PID: ${logs.pid || 'N/A'}</span>
          <span class="log-started">启动时间: ${logs.startedAt ? formatTime(logs.startedAt) : 'N/A'}</span>
        </div>
        <div class="log-tabs">
          <button class="log-tab active" data-tab="stdout">stdout</button>
          <button class="log-tab" data-tab="stderr">stderr</button>
        </div>
        <pre class="log-content" id="logContent">${escapeText(logs.stdout || '(empty)')}</pre>
      </div>
    `,
    footer: `<button class="modal-btn secondary" id="mcpLogRefresh">刷新</button><button class="modal-btn primary" id="mcpLogClose">关闭</button>`
  });

  document.getElementById('mcpLogClose').addEventListener('click', () => Modal.hide());
  document.getElementById('mcpLogRefresh').addEventListener('click', async () => {
    try {
      const newLogs = await api(`/api/mcp/${serverId}/logs`);
      document.getElementById('logContent').textContent = newLogs.stdout || '(empty)';
    } catch (error) {
      Toast.error('刷新失败: ' + error.message);
    }
  });

  document.querySelectorAll('.log-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById('logContent');
      if (tab.dataset.tab === 'stdout') {
        content.textContent = logs.stdout || '(empty)';
      } else {
        content.textContent = logs.stderr || '(empty)';
      }
    });
  });
}

function showMcpInspector(serverId, server, toolsResult) {
  const tools = toolsResult.tools || [];
  Modal.show({
    title: `MCP 检查器 - ${escapeText(server.name)}`,
    body: `
      <div class="mcp-inspector">
        <div class="inspector-section">
          <h3>服务信息</h3>
          <div class="info-grid">
            <div class="info-item"><label>状态:</label><span class="pill ${server.status}">${server.status || 'stopped'}</span></div>
            <div class="info-item"><label>PID:</label><span>${server.runtime?.pid || 'N/A'}</span></div>
            <div class="info-item"><label>命令:</label><span>${escapeText(server.command)}</span></div>
            <div class="info-item"><label>工具数:</label><span>${tools.length}</span></div>
          </div>
        </div>
        <div class="inspector-section">
          <h3>发现工具 (${tools.length})</h3>
          <div class="tools-list">
            ${tools.length === 0 ? '<div class="item-detail">暂无工具</div>' :
              tools.map(tool => `
                <div class="tool-item">
                  <div class="tool-name">${escapeText(tool.name)}</div>
                  <div class="tool-desc">${escapeText(tool.description || '无描述')}</div>
                  <button class="skill-toggle tool-call-btn" data-tool-name="${escapeText(tool.name)}" data-tool-schema='${JSON.stringify(tool.inputSchema || {})}')">调用</button>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    `,
    footer: `<button class="modal-btn secondary" id="mcpInspectorClose">关闭</button>`
  });

  document.getElementById('mcpInspectorClose').addEventListener('click', () => Modal.hide());

  document.querySelectorAll('.tool-call-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const toolName = btn.dataset.toolName;
      const schema = JSON.parse(btn.dataset.toolSchema || '{}');
      showToolCallDialog(serverId, toolName, schema);
    });
  });
}

function showToolCallDialog(serverId, toolName, schema) {
  const properties = schema.properties || {};
  const required = schema.required || [];

  let inputFields = '';
  for (const [name, prop] of Object.entries(properties)) {
    const isRequired = required.includes(name);
    inputFields += `
      <label class="${isRequired ? 'required' : ''}">
        <span>${escapeText(name)}${isRequired ? ' *' : ''}</span>
        <input type="text" name="${escapeText(name)}" placeholder="${escapeText(prop.description || name)}" />
      </label>
    `;
  }

  if (Object.keys(properties).length === 0) {
    inputFields = '<div class="item-detail">此工具不需要参数</div>';
  }

  Modal.show({
    title: `调用工具: ${escapeText(toolName)}`,
    body: `<form id="toolCallForm">${inputFields}</form>`,
    footer: `<button class="modal-btn secondary" id="toolCallCancel">取消</button><button class="modal-btn primary" id="toolCallSubmit">调用</button>`
  });

  document.getElementById('toolCallCancel').addEventListener('click', () => Modal.hide());
  document.getElementById('toolCallSubmit').addEventListener('click', async () => {
    const form = document.getElementById('toolCallForm');
    const formData = new FormData(form);
    const args = {};
    for (const [key, value] of formData.entries()) {
      if (value) args[key] = value;
    }

    try {
      Toast.info('调用中...');
      const result = await api(`/api/mcp/${serverId}/call`, {
        method: 'POST',
        body: JSON.stringify({ name: toolName, args })
      });
      Modal.hide();
      Modal.show({
        title: `工具结果: ${escapeText(toolName)}`,
        body: `<pre class="tool-result">${escapeText(JSON.stringify(result, null, 2))}</pre>`,
        footer: `<button class="modal-btn primary" id="toolResultClose">关闭</button>`
      });
      document.getElementById('toolResultClose').addEventListener('click', () => Modal.hide());
    } catch (error) {
      Toast.error('调用失败: ' + error.message);
    }
  });
}

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
    const id = button.dataset.sessionId;
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ContextMenu.show(e.clientX, e.clientY, [
        { label: '打开', icon: '📂', action: () => loadSession(id) },
        { label: '重命名', icon: '✏️', action: () => Toast.info('重命名功能开发中') },
        { separator: true },
        { label: '删除', icon: '🗑', danger: true, action: () => deleteSession(id) },
      ]);
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

  // Apply syntax highlighting to code blocks
  if (typeof hljs !== 'undefined') {
    feed.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }

  // Add copy button to each code block
  feed.querySelectorAll('pre').forEach((pre) => {
    const btn = document.createElement('button');
    btn.className = 'copy-code-btn';
    btn.textContent = '复制';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent || '';
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 2000);
      });
    });
    pre.appendChild(btn);
  });

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
            <button class="skill-toggle" type="button" data-skill-preview="${skill.id}">详情</button>
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

  document.querySelectorAll('[data-skill-preview]').forEach((button) => {
    button.addEventListener('click', () => {
      const skill = state.skills.find(s => s.id === button.dataset.skillPreview);
      showSkillPreviewModal(skill);
    });
  });

  document.querySelectorAll('[data-skill-run-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const skillId = button.dataset.skillRunId;
      const skill = state.skills.find(s => s.id === skillId);
      showSkillRunModal(skillId, skill);
    });
  });
}

function showSkillRunModal(skillId, skill) {
  Modal.show({
    title: `运行技能: ${escapeText(skill?.name || 'Unknown')}`,
    body: `
      <form id="skillRunForm">
        <label class="wide-field">
          <span>输入参数 (JSON)</span>
          <textarea name="input" rows="4" placeholder='{"key": "value"}'>${skill?.inputSchema ? JSON.stringify(skill.inputSchema, null, 2) : '{"sessionId": "' + state.activeSessionId + '"}'}</textarea>
        </label>
      </form>
    `,
    footer: `<button class="modal-btn secondary" id="skillRunCancel">取消</button><button class="modal-btn primary" id="skillRunSubmit">运行</button>`
  });

  document.getElementById('skillRunCancel').addEventListener('click', () => Modal.hide());
  document.getElementById('skillRunSubmit').addEventListener('click', async () => {
    const form = document.getElementById('skillRunForm');
    const formData = new FormData(form);
    let input;
    try {
      input = JSON.parse(formData.get('input') || '{}');
    } catch (e) {
      Toast.error('输入必须是有效的 JSON 格式');
      return;
    }

    Modal.hide();
    Toast.info('技能运行中...');

    try {
      const result = await api(`/api/skills/${skillId}/run`, {
        method: 'POST',
        body: JSON.stringify({ input })
      });
      state.trace.unshift({
        title: `技能运行: ${result.skillName}`,
        detail: result.error || result.output || result.status,
        status: result.status
      });
      renderTrace();
      Toast.success('技能执行完成');
    } catch (error) {
      Toast.error('技能执行失败: ' + error.message);
    }
  });
}

function showSkillPreviewModal(skill) {
  if (!skill) return;

  const metadata = [];
  if (skill.version) metadata.push(`版本: ${skill.version}`);
  if (skill.author) metadata.push(`作者: ${escapeText(skill.author)}`);
  if (skill.source) metadata.push(`来源: ${escapeText(skill.source)}`);
  if (skill.createdAt) metadata.push(`创建: ${formatTime(skill.createdAt)}`);
  if (skill.updatedAt) metadata.push(`更新: ${formatTime(skill.updatedAt)}`);
  if (skill.runCount !== undefined) metadata.push(`运行次数: ${skill.runCount}`);

  Modal.show({
    title: escapeText(skill.name),
    body: `
      <div class="skill-preview">
        <div class="skill-meta">
          ${metadata.length > 0 ? `<div class="meta-items">${metadata.join(' · ')}</div>` : ''}
        </div>
        <div class="skill-description">
          <h4>描述</h4>
          <p>${escapeText(skill.description || '无描述')}</p>
        </div>
        ${skill.content ? `
          <div class="skill-content">
            <h4>内容</h4>
            <pre>${escapeText(skill.content.slice(0, 1000))}${skill.content.length > 1000 ? '...' : ''}</pre>
          </div>
        ` : ''}
        ${skill.inputSchema ? `
          <div class="skill-schema">
            <h4>输入参数</h4>
            <pre>${escapeText(JSON.stringify(skill.inputSchema, null, 2))}</pre>
          </div>
        ` : ''}
      </div>
    `,
    footer: `<button class="modal-btn primary" id="skillPreviewClose">关闭</button>`
  });

  document.getElementById('skillPreviewClose').addEventListener('click', () => Modal.hide());
}

function showSkillHistoryModal(runs) {
  if (!runs || runs.length === 0) {
    Modal.show({
      title: '技能运行历史',
      body: '<div class="item-detail">暂无运行历史</div>',
      footer: `<button class="modal-btn primary" id="skillHistoryClose">关闭</button>`
    });
  } else {
    Modal.show({
      title: `技能运行历史 (${runs.length})`,
      body: `
        <div class="skill-history-grid">
          ${runs.slice(0, 50).map(run => `
            <div class="history-item">
              <div class="history-item-header">
                <span class="history-item-name">${escapeText(run.skillName || run.skillId || 'Unknown')}</span>
                <span class="history-item-status ${run.status === 'success' ? 'success' : 'error'}">${run.status || 'unknown'}</span>
              </div>
              <div class="history-item-time">${run.executedAt ? formatTime(run.executedAt) : ''}</div>
              ${run.result ? `<div class="history-item-result">${escapeText(typeof run.result === 'string' ? run.result : JSON.stringify(run.result).slice(0, 200))}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `,
      footer: `<button class="modal-btn primary" id="skillHistoryClose">关闭</button>`
    });
  }

  document.getElementById('skillHistoryClose').addEventListener('click', () => Modal.hide());
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
            <button class="skill-toggle" type="button" data-mcp-logs="${server.id}">日志</button>
            <button class="skill-toggle" type="button" data-mcp-inspect="${server.id}">检查</button>
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
  document.querySelectorAll('[data-mcp-logs]').forEach((button) => {
    button.addEventListener('click', async () => {
      const serverId = button.dataset.mcpLogs;
      try {
        const logs = await api(`/api/mcp/${serverId}/logs`);
        showMcpLogViewer(serverId, logs);
      } catch (error) {
        Toast.error('无法获取日志: ' + error.message);
      }
    });
  });
  document.querySelectorAll('[data-mcp-inspect]').forEach((button) => {
    button.addEventListener('click', async () => {
      const serverId = button.dataset.mcpInspect;
      try {
        const [server, tools] = await Promise.all([
          api(`/api/mcp/${serverId}`),
          api(`/api/mcp/${serverId}/tools`)
        ]);
        showMcpInspector(serverId, server, tools);
      } catch (error) {
        Toast.error('无法检查 MCP: ' + error.message);
      }
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

  // Skill picker in composer
  const skillPickerBtn = $('#skillPickerBtn');
  const skillPickerSelect = $('#skillPickerSelect');

  if (skillPickerBtn && skillPickerSelect) {
    skillPickerBtn.addEventListener('click', () => {
      skillPickerSelect.classList.toggle('hidden');
      if (!skillPickerSelect.classList.contains('hidden')) {
        // Populate skills
        skillPickerSelect.innerHTML = '<option value="">使用技能...</option>' +
          state.skills.filter(s => s.enabled).map(s =>
            `<option value="${s.id}">${escapeText(s.name)}</option>`
          ).join('');
        skillPickerSelect.focus();
      }
    });

    skillPickerSelect.addEventListener('change', () => {
      const skillId = skillPickerSelect.value;
      if (skillId) {
        const skill = state.skills.find(s => s.id === skillId);
        if (skill) {
          // Insert skill invocation into prompt
          const input = $('#promptInput');
          input.value = `/skill ${skill.name} ${input.value}`.trim();
          input.focus();
        }
      }
      skillPickerSelect.classList.add('hidden');
    });

    // Hide select when clicking outside
    document.addEventListener('click', (e) => {
      if (!skillPickerBtn.contains(e.target) && !skillPickerSelect.contains(e.target)) {
        skillPickerSelect.classList.add('hidden');
      }
    });
  }

  $('#exportSessionButton').addEventListener('click', () => {
    if (!state.activeSessionId) return;
    const link = document.createElement('a');
    link.href = `/api/sessions/${state.activeSessionId}/export?format=markdown`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Skill history button
  $('#skillHistoryBtn')?.addEventListener('click', async () => {
    try {
      const runs = await api('/api/skills/runs');
      showSkillHistoryModal(runs);
    } catch (error) {
      Toast.error('无法加载技能历史: ' + error.message);
    }
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
  const paletteInput = $('#paletteInput');
  if (paletteInput) {
    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, flatItems.length - 1);
        renderPaletteResults(paletteInput.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderPaletteResults(paletteInput.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatItems[selectedIndex]) flatItems[selectedIndex].action();
        hidePalette();
      } else if (e.key === 'Escape') {
        hidePalette();
      } else {
        // Search
        selectedIndex = 0;
        renderPaletteResults(paletteInput.value);
      }
    });

    paletteInput.addEventListener('input', (e) => {
      selectedIndex = 0;
      renderPaletteResults(e.target.value);
    });
  }

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

// ── Context Menu ──
class ContextMenu {
  static menu = null;
  static items = [];

  static init() {
    this.menu = document.getElementById('contextMenu');
    document.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  static show(x, y, items) {
    if (!this.menu) this.init();
    this.items = items;
    const container = document.getElementById('contextMenuItems');
    container.innerHTML = items.map((item, i) => {
      if (item.separator) return '<div class="context-menu-separator"></div>';
      return `
        <button class="context-menu-item ${item.danger ? 'danger' : ''}" data-index="${i}">
          ${item.icon ? `<span class="context-menu-icon">${item.icon}</span>` : ''}
          <span>${item.label}</span>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.context-menu-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        this.items[idx].action?.();
        this.hide();
      });
    });

    // 定位
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (x + 200 > vw) left = vw - 210;
    if (y + 200 > vh) top = vh - 210;

    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
    this.menu.classList.add('visible');
  }

  static hide() {
    if (this.menu) this.menu.classList.remove('visible');
  }
}

// ── Dropdown Menu ──
class Dropdown {
  static initAll() {
    document.querySelectorAll('.dropdown').forEach(el => this.init(el));
  }

  static init(el) {
    const trigger = el.querySelector('.dropdown-trigger');
    const menu = el.querySelector('.dropdown-menu');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = menu.classList.contains('visible');
      this.closeAll();
      if (!isVisible) menu.classList.add('visible');
    });
  }

  static closeAll() {
    document.querySelectorAll('.dropdown-menu.visible').forEach(m => m.classList.remove('visible'));
  }
}

async function init() {
  bindEvents();
  Toast.init();
  Modal.init();
  ContextMenu.init();
  Dropdown.initAll();
  setupGlobalShortcuts();
  setupThemeToggle();
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
  const overlay = $('#commandPaletteOverlay');
  if (!overlay) return;

  const isVisible = overlay.classList.contains('visible');
  if (isVisible) {
    overlay.classList.remove('visible');
  } else {
    overlay.classList.add('visible');
    const input = $('#paletteInput');
    if (input) {
      input.value = '';
      input.focus();
      renderPaletteResults('');
      selectedIndex = 0;
    }
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

// ── Tooltip ──
function showTooltip(el, message) {
  let tip = el._tooltipEl;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    el._tooltipEl = tip;
    el.appendChild(tip);
    el.addEventListener('mouseenter', () => tip.classList.add('visible'));
    el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
  }
  tip.textContent = message;
  tip.classList.add('visible');
}

function hideTooltip(el) {
  if (el._tooltipEl) el._tooltipEl.classList.remove('visible');
}

init();

// Initialize highlight.js
if (typeof hljs !== 'undefined') {
  hljs.highlightAll();
}
