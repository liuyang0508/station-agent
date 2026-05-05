# Station Agent 前端增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将Station Agent前端从基础暗色主题升级为Linear风格的玻璃拟态界面，包含视觉增强、交互增强和组件库补齐三大阶段。

**Architecture:** 修改现有 `public/styles.css` 和 `public/app.js`，在 `public/index.html` 中添加必要容器。新增CSS变量系统、重构动画引擎、新增Toast/Modal/命令面板系统、补齐UI组件库。

**Tech Stack:** 纯CSS + Vanilla JS（无框架依赖），highlight.js CDN（代码语法高亮）

---

## 文件变更总览

| 文件 | 变更内容 |
|------|----------|
| `public/styles.css` | CSS变量重组、玻璃拟态、阴影层次、新组件样式、动画 |
| `public/app.js` | Toast系统、Modal系统、命令面板增强、右键菜单、快捷键绑定、Tooltip组件逻辑 |
| `public/index.html` | Toast容器、Modal模板、右键菜单模板 |

---

## 阶段一：视觉增强

### 任务 1: CSS变量重组与阴影层次

**Files:**
- Modify: `public/styles.css:1-30` (变量定义区)

- [ ] **Step 1: 读取现有变量定义起始位置**

确认 `:root` 块从第几行开始，现有变量有哪些。

- [ ] **Step 2: 替换CSS变量块**

将现有 `--shadow-sm/md/glow` 替换为增强版本。

```css
:root {
  /* 阴影层次 - 新增 */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(168, 85, 247, 0.2);
  --shadow-glow-strong: 0 0 40px rgba(168, 85, 247, 0.3);
  --shadow-glow-blue: 0 0 20px rgba(59, 130, 246, 0.2);

  /* 毛玻璃背景 - 新增 */
  --glass-bg: rgba(17, 17, 24, 0.85);
  --glass-border: rgba(255, 255, 255, 0.06);

  /* 动画 - 新增 */
  --transition-fast: 100ms ease-out;
  --transition-base: 150ms ease-out;
  --transition-slow: 200ms ease-out;
}
```

- [ ] **Step 3: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): enhance CSS variable system with shadow layers and glass effects"
```

---

### 任务 2: 全局毛玻璃效果

**Files:**
- Modify: `public/styles.css` (sidebar, inspector, topbar相关样式)

- [ ] **Step 1: 为sidebar添加毛玻璃**

在 `.sidebar` 规则块中添加：

```css
.sidebar {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid var(--glass-border);
  /* 保留原有其他属性 */
}
```

- [ ] **Step 2: 为inspector添加毛玻璃**

```css
.inspector {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-left: 1px solid var(--glass-border);
}
```

- [ ] **Step 3: 为topbar添加微妙毛玻璃**

```css
.topbar {
  background: rgba(17, 17, 24, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
```

- [ ] **Step 4: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): add glassmorphism to sidebar, inspector and topbar"
```

---

### 任务 3: 卡片Hover动效增强

**Files:**
- Modify: `public/styles.css` (.item-card相关)

- [ ] **Step 1: 增强.item-card的hover效果**

替换现有的 `.item-card:hover`：

```css
.item-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 16px rgba(168, 85, 247, 0.15);
  transition: border-color var(--transition-base),
              transform var(--transition-base),
              box-shadow var(--transition-base);
}
```

- [ ] **Step 2: 添加.item-card的基础过渡**

确保未hover时也有平滑过渡：

```css
.item-card {
  transition: border-color var(--transition-base),
              transform var(--transition-base),
              box-shadow var(--transition-base);
}
```

- [ ] **Step 3: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): enhance card hover with glow shadow and smooth transition"
```

---

### 任务 4: 滚动条精致化

**Files:**
- Modify: `public/styles.css` (滚动条样式)

- [ ] **Step 1: 替换滚动条样式**

替换现有的 `::-webkit-scrollbar` 块：

```css
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
```

- [ ] **Step 2: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): refine scrollbar styling with thinner width and shadow"
```

---

### 任务 5: 品牌SVG动效增强

**Files:**
- Modify: `public/styles.css` (brand-mark相关动画)

- [ ] **Step 1: 增强pulse-glow动画**

替换现有的 `@keyframes pulse-glow`：

```css
.brand-mark {
  width: 36px;
  height: 36px;
  animation: brand-glow 3s ease-in-out infinite;
  filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.3));
}

@keyframes brand-glow {
  0%, 100% {
    filter: drop-shadow(0 0 4px rgba(168, 85, 247, 0.2))
            drop-shadow(0 0 8px rgba(168, 85, 247, 0.1));
  }
  50% {
    filter: drop-shadow(0 0 12px rgba(168, 85, 247, 0.4))
            drop-shadow(0 0 24px rgba(168, 85, 247, 0.2));
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): enhance brand mark with layered glow animation"
```

---

### 任务 6: 消息气泡样式优化

**Files:**
- Modify: `public/styles.css` (message相关)

- [ ] **Step 1: 为assistant消息添加左侧紫色指示条**

在 `.message.assistant` 中添加：

```css
.message.assistant {
  margin-right: auto;
  border-left: 2px solid var(--primary);
  border-top-left-radius: 4px;
}
```

- [ ] **Step 2: 优化消息入场动画**

替换 `@keyframes fade-in`：

```css
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): enhance message bubbles with accent border indicator"
```

---

### 任务 7: 代码块语法高亮

**Files:**
- Modify: `public/index.html` (添加highlight.js CDN)
- Modify: `public/app.js` (初始化highlight.js)
- Modify: `public/styles.css` (代码高亮样式)

- [ ] **Step 1: 在index.html中添加highlight.js CDN**

在 `</body>` 前添加：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css" />
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
```

- [ ] **Step 2: 在app.js中初始化highlight.js**

在文件开头或init函数中添加：

```js
// Initialize highlight.js
if (typeof hljs !== 'undefined') {
  hljs.highlightAll();
}
```

- [ ] **Step 3: 在app.js的renderMessage中添加代码高亮调用**

找到 `renderMessage` 函数，在设置 `innerHTML` 后调用：

```js
if (typeof hljs !== 'undefined') {
  contentEl.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });
}
```

- [ ] **Step 4: 添加代码复制按钮样式**

在styles.css中添加：

```css
.message-content pre {
  position: relative;
}

.copy-code-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-base);
}

.message-content pre:hover .copy-code-btn {
  opacity: 1;
}

.copy-code-btn:hover {
  color: var(--text-primary);
  border-color: var(--primary);
}
```

- [ ] **Step 5: 在app.js中添加复制按钮功能**

在 `renderMessage` 函数中，渲染完 `pre` 后添加：

```js
const preEls = contentEl.querySelectorAll('pre');
preEls.forEach((pre) => {
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
```

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat(frontend): add syntax highlighting with highlight.js and copy button"
```

---

## 阶段二：交互增强

### 任务 8: Toast通知系统

**Files:**
- Modify: `public/index.html` (添加toast容器)
- Modify: `public/styles.css` (toast样式)
- Modify: `public/app.js` (toast逻辑)

- [ ] **Step 1: 在index.html中添加toast容器**

在 `<div class="app-shell">` 后添加：

```html
<div class="toast-container" id="toastContainer"></div>
```

- [ ] **Step 2: 在styles.css中添加toast样式**

```css
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 280px;
  max-width: 400px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  font-size: 13px;
  color: var(--text-primary);
  pointer-events: auto;
  animation: toast-in 150ms ease-out;
}

.toast.toast-out {
  animation: toast-out 200ms ease-out forwards;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(24px);
  }
}

.toast-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.toast.success .toast-icon { color: var(--success); }
.toast.error .toast-icon { color: var(--danger); }
.toast.warning .toast-icon { color: var(--warning); }
.toast.info .toast-icon { color: var(--primary); }

.toast-message {
  flex: 1;
  line-height: 1.4;
}

.toast-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
  flex-shrink: 0;
}

.toast-close:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}
```

- [ ] **Step 3: 在app.js中添加Toast类**

在文件顶部或工具函数区添加：

```js
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
```

- [ ] **Step 4: 初始化Toast**

在app.js的init函数中调用 `Toast.init()`

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat(frontend): add toast notification system"
```

---

### 任务 9: Modal对话框系统

**Files:**
- Modify: `public/index.html` (添加modal模板)
- Modify: `public/styles.css` (modal样式)
- Modify: `public/app.js` (modal逻辑)

- [ ] **Step 1: 在index.html中添加modal模板**

在toast容器后添加：

```html
<div class="modal-overlay" id="modalOverlay">
  <div class="modal-dialog">
    <div class="modal-header">
      <span class="modal-title" id="modalTitle"></span>
      <button class="modal-close" id="modalCloseBtn">×</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer" id="modalFooter"></div>
  </div>
</div>
```

- [ ] **Step 2: 在styles.css中添加modal样式**

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.modal-overlay.visible {
  display: flex;
  animation: modal-overlay-in 150ms ease-out;
}

@keyframes modal-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-dialog {
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  display: flex;
  flex-direction: column;
  animation: modal-dialog-in 200ms ease-out;
  overflow: hidden;
}

@keyframes modal-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.modal-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-base);
}

.modal-btn.secondary {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.modal-btn.secondary:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

.modal-btn.primary {
  border: 0;
  background: var(--primary);
  color: white;
}

.modal-btn.primary:hover {
  background: #9333EA;
  box-shadow: var(--shadow-glow);
}

.modal-btn.danger {
  border: 0;
  background: var(--danger);
  color: white;
}
```

- [ ] **Step 3: 在app.js中添加Modal类**

```js
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
```

- [ ] **Step 4: 在init中调用Modal.init()**

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat(frontend): add modal dialog system"
```

---

### 任务 10: 命令面板增强

**Files:**
- Modify: `public/styles.css` (palette增强样式)
- Modify: `public/app.js` (palette逻辑重构)

- [ ] **Step 1: 增强palette样式**

在styles.css中找到 `.command-palette-overlay` 相关样式，替换为：

```css
.command-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.command-palette-overlay.visible {
  display: flex;
  animation: palette-overlay-in 150ms ease-out;
}

@keyframes palette-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.palette-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.palette-dialog {
  position: relative;
  width: 580px;
  max-width: 90vw;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg), var(--shadow-glow-strong);
  overflow: hidden;
  animation: palette-dialog-in 200ms ease-out;
}

@keyframes palette-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.palette-input {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 16px 20px;
  font-size: 15px;
  outline: none;
  box-sizing: border-box;
}

.palette-input:focus {
  background: var(--bg-elevated);
}

.palette-results {
  max-height: 380px;
  overflow-y: auto;
  padding: 8px;
}

.palette-group-label {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.palette-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  font-size: 13.5px;
  transition: background var(--transition-fast);
}

.palette-item:hover,
.palette-item.selected {
  background: var(--bg-elevated);
}

.palette-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.palette-label {
  flex: 1;
  font-weight: 500;
}

.palette-shortcut {
  display: flex;
  gap: 4px;
}

.palette-item kbd {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: inherit;
}

.palette-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
```

- [ ] **Step 2: 重构app.js中的命令面板逻辑**

将现有的palette代码替换为增强版本。首先读取现有palette相关代码段。

- [ ] **Step 3: 定义命令列表**

```js
const PALETTE_COMMANDS = [
  {
    group: '会话',
    items: [
      { id: 'new-session', label: '新会话', icon: '✨', shortcut: '⌘N', action: () => startNewSession() },
      { id: 'export-session', label: '导出会话', icon: '📤', action: () => exportSession() },
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
      { id: 'toggle-theme', label: '切换主题', icon: '🎨', action: () => Toast.info('主题切换功能开发中') },
      { id: 'shortcuts-help', label: '快捷键帮助', icon: '⌨️', shortcut: '⌘/', action: () => showShortcutsHelp() },
    ]
  }
];
```

- [ ] **Step 4: 增强palette渲染函数**

```js
function showPalette() {
  const overlay = document.getElementById('commandPaletteOverlay') || createPaletteOverlay();
  overlay.classList.add('visible');
  const input = document.getElementById('paletteInput');
  input.value = '';
  input.focus();
  renderPaletteResults('');
  selectedIndex = 0;
}

function renderPaletteResults(query) {
  const results = document.getElementById('paletteResults');
  const flat = [];
  PALETTE_COMMANDS.forEach(group => {
    const matched = group.items.filter(item =>
      item.label.toLowerCase().includes(query.toLowerCase())
    );
    matched.forEach(item => flat.push({ ...item, group: group.group }));
  });

  if (flat.length === 0) {
    results.innerHTML = '<div class="palette-empty">没有找到匹配的命令</div>';
    return;
  }

  results.innerHTML = flat.map((item, i) => `
    <div class="palette-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
      <div class="palette-item-icon">${item.icon}</div>
      <span class="palette-label">${item.label}</span>
      ${item.shortcut ? `<div class="palette-shortcut"><kbd>${item.shortcut}</kbd></div>` : ''}
    </div>
  `).join('');

  results.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      flat[idx].action();
      hidePalette();
    });
  });
}

function hidePalette() {
  const overlay = document.getElementById('commandPaletteOverlay');
  if (overlay) overlay.classList.remove('visible');
}
```

- [ ] **Step 5: 添加键盘导航**

在palette输入框的keydown事件中：

```js
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, flatItems.length - 1);
    updateSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, 0);
    updateSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (flatItems[selectedIndex]) flatItems[selectedIndex].action();
    hidePalette();
  } else if (e.key === 'Escape') {
    hidePalette();
  }
});
```

- [ ] **Step 6: 在index.html中创建palette DOM结构**

找到现有的 `.command-palette-overlay`，将其替换为完整结构：

```html
<div class="command-palette-overlay" id="commandPaletteOverlay">
  <div class="palette-backdrop"></div>
  <div class="palette-dialog">
    <input type="text" class="palette-input" id="paletteInput" placeholder="输入命令或搜索..." />
    <div class="palette-results" id="paletteResults"></div>
  </div>
</div>
```

- [ ] **Step 7: 提交**

```bash
git add public/styles.css public/app.js public/index.html
git commit -m "feat(frontend): enhance command palette with groups, icons and keyboard nav"
```

---

### 任务 11: 全局快捷键

**Files:**
- Modify: `public/app.js` (添加快捷键绑定)

- [ ] **Step 1: 添加全局快捷键监听**

在app.js的init函数中或独立函数中添加：

```js
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
      startNewSession();
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
```

- [ ] **Step 2: 添加showShortcutsHelp函数**

```js
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
```

- [ ] **Step 3: 在init中调用setupGlobalShortcuts()**

- [ ] **Step 4: 提交**

```bash
git add public/app.js
git commit -m "feat(frontend): add global keyboard shortcuts"
```

---

### 任务 12: 右键菜单

**Files:**
- Modify: `public/index.html` (添加context menu容器)
- Modify: `public/styles.css` (context menu样式)
- Modify: `public/app.js` (context menu逻辑)

- [ ] **Step 1: 在index.html中添加context menu容器**

在modal后添加：

```html
<div class="context-menu" id="contextMenu">
  <div class="context-menu-items" id="contextMenuItems"></div>
</div>
```

- [ ] **Step 2: 在styles.css中添加context menu样式**

```css
.context-menu {
  position: fixed;
  z-index: 10001;
  min-width: 180px;
  max-width: 280px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  display: none;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.context-menu.visible {
  display: block;
  animation: context-menu-in 100ms ease-out;
}

@keyframes context-menu-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast);
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
}

.context-menu-item:hover {
  background: var(--bg-elevated);
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.context-menu-separator {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 0;
}

.context-menu-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}
```

- [ ] **Step 3: 在app.js中添加ContextMenu类**

```js
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
    const rect = this.menu.getBoundingClientRect();
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
```

- [ ] **Step 4: 在init中调用ContextMenu.init()**

- [ ] **Step 5: 为会话卡片添加右键菜单**

在渲染session卡片的代码中，添加：

```js
sessionCard.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ContextMenu.show(e.clientX, e.clientY, [
    { label: '打开', icon: '📂', action: () => loadSession(id) },
    { label: '重命名', icon: '✏️', action: () => renameSession(id) },
    { separator: true },
    { label: '删除', icon: '🗑', danger: true, action: () => deleteSession(id) },
  ]);
});
```

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat(frontend): add context menu with positioning and keyboard support"
```

---

## 阶段三：组件库补齐

### 任务 13: Tooltip组件

**Files:**
- Modify: `public/styles.css` (tooltip样式)
- Modify: `public/app.js` (tooltip逻辑)

- [ ] **Step 1: 在styles.css中添加tooltip样式**

```css
[data-tooltip] {
  position: relative;
}

.tooltip {
  position: absolute;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-fast);
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: var(--border);
}

.tooltip.visible {
  opacity: 1;
}

.tooltip.bottom {
  bottom: auto;
  top: calc(100% + 6px);
}

.tooltip.bottom::before {
  top: auto;
  bottom: 100%;
  border-top-color: transparent;
  border-bottom-color: var(--border);
}
```

- [ ] **Step 2: 在app.js中添加Tooltip函数**

```js
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
```

- [ ] **Step 3: 提交**

```bash
git add public/styles.css public/app.js
git commit -m "feat(frontend): add tooltip component with positioning"
```

---

### 任务 14: Badge/Tag组件

**Files:**
- Modify: `public/styles.css` (badge样式)

- [ ] **Step 1: 在styles.css中添加badge组件样式**

在现有pill样式后添加：

```css
/* ─── Badge ─── */
.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.badge.neutral {
  background: var(--bg-elevated);
  color: var(--text-muted);
}

.badge.primary {
  background: var(--accent-glow);
  color: var(--primary);
}

.badge.success {
  background: rgba(34, 197, 94, 0.12);
  color: var(--success);
}

.badge.warning {
  background: rgba(245, 158, 11, 0.12);
  color: var(--warning);
}

.badge.danger {
  background: rgba(239, 68, 68, 0.12);
  color: var(--danger);
}

/* ─── Avatar ─── */
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-glow);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.avatar.user {
  background: rgba(59, 130, 246, 0.15);
  color: #3B82F6;
}
```

- [ ] **Step 2: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): add badge and avatar component styles"
```

---

### 任务 15: Spinner/Progress组件

**Files:**
- Modify: `public/styles.css` (spinner/progress样式)

- [ ] **Step 1: 在styles.css中添加spinner样式**

```css
/* ─── Spinner ─── */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ─── Skeleton ─── */
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-elevated) 50%,
    var(--bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 6px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-text {
  height: 14px;
  margin: 6px 0;
}

.skeleton-title {
  height: 18px;
  width: 60%;
  margin-bottom: 8px;
}
```

- [ ] **Step 2: 提交**

```bash
git add public/styles.css
git commit -m "feat(frontend): add spinner, progress bar and skeleton loading styles"
```

---

### 任务 16: DropdownMenu组件

**Files:**
- Modify: `public/styles.css` (dropdown样式)
- Modify: `public/app.js` (dropdown逻辑)

- [ ] **Step 1: 在styles.css中添加dropdown样式**

```css
/* ─── Dropdown Menu ─── */
.dropdown {
  position: relative;
  display: inline-block;
}

.dropdown-trigger {
  cursor: pointer;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 160px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
  padding: 6px;
  z-index: 1000;
  display: none;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.dropdown-menu.visible {
  display: block;
  animation: dropdown-in 150ms ease-out;
}

@keyframes dropdown-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast);
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
}

.dropdown-item:hover {
  background: var(--bg-elevated);
}

.dropdown-item.disabled {
  opacity: 0.4;
  cursor: default;
}

.dropdown-item.disabled:hover {
  background: transparent;
}

.dropdown-separator {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 0;
}

.dropdown-icon {
  width: 16px;
  text-align: center;
  font-size: 14px;
}
```

- [ ] **Step 2: 在app.js中添加Dropdown类**

```js
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
```

- [ ] **Step 3: 在init中调用Dropdown.initAll()**

- [ ] **Step 4: 提交**

```bash
git add public/styles.css public/app.js
git commit -m "feat(frontend): add dropdown menu component"
```

---

## 最终提交

- [ ] **Step: 合并所有未提交更改**

```bash
git add -A
git status
```

检查是否有遗漏的阶段性提交，确保所有变更已提交。

---

## 实施检查清单

| 任务 | 描述 | 状态 |
|------|------|------|
| 1 | CSS变量重组与阴影层次 | ⬜ |
| 2 | 全局毛玻璃效果 | ⬜ |
| 3 | 卡片Hover动效增强 | ⬜ |
| 4 | 滚动条精致化 | ⬜ |
| 5 | 品牌SVG动效增强 | ⬜ |
| 6 | 消息气泡样式优化 | ⬜ |
| 7 | 代码块语法高亮 | ⬜ |
| 8 | Toast通知系统 | ⬜ |
| 9 | Modal对话框系统 | ⬜ |
| 10 | 命令面板增强 | ⬜ |
| 11 | 全局快捷键 | ⬜ |
| 12 | 右键菜单 | ⬜ |
| 13 | Tooltip组件 | ⬜ |
| 14 | Badge/Tag组件 | ⬜ |
| 15 | Spinner/Progress组件 | ⬜ |
| 16 | DropdownMenu组件 | ⬜ |
