# Station Agent 前端增强设计方案

**日期**: 2026/05/06
**状态**: 已确认
**参考风格**: Linear (玻璃拟态 + 紫色渐变)
**动效风格**: 克制优雅 (100-200ms ease-out)

---

## 1. 背景与目标

Station Agent 当前前端已具备完整的功能框架（18个视图），但视觉质感和交互体验距离 Linear/Raycast 这类现代工具仍有差距。本次增强旨在不破坏现有功能的前提下，系统性提升视觉冲击力、交互体验和组件丰富度。

**设计原则**:
- 保持现有紫色品牌色，通过增强光晕和层次感提升质感
- 动效克制优雅，100-200ms ease-out，强调效率感
- 新增组件和交互模式符合现代工具标准

---

## 2. 三阶段实施路线

### 阶段一：视觉增强（优先级最高）

#### 1.1 全局毛玻璃效果
- Sidebar、Inspector、Topbar 应用 `backdrop-filter: blur(12px)`
- 毛玻璃叠加半透明背景 (`rgba(17,17,24,0.8)`)
- 与 `color-scheme: dark` 协同

#### 1.2 阴影与光晕层次重组
```
现有问题: 单层 shadow，过平
优化方案:
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.2)
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.3)
  --shadow-md: 0 8px 24px rgba(0,0,0,0.4)
  --shadow-lg: 0 16px 48px rgba(0,0,0,0.5)
  --shadow-glow: 0 0 20px rgba(168,85,247,0.25)  /* 紫色光晕增强 */
  --shadow-glow-strong: 0 0 40px rgba(168,85,247,0.35)
```

#### 1.3 边框光效
- Hover状态: `border-color` 过渡到 `--accent`，带subtle glow
- Focus状态: `box-shadow: 0 0 0 3px var(--accent-glow)` 替代原有outline
- 卡片hover: 微妙的边框发光效果

#### 1.4 卡片Hover动效增强
```css
.item-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 16px var(--accent-glow);
}
```

#### 1.5 滚动条精致化
- 宽度从6px减至4px
- 圆角2px
- hover时变为accent色
- 添加subtle shadow

#### 1.6 品牌SVG动效增强
- 当前pulse-glow动画偏简单
- 改为多层glow叠加：内圈 + 外圈光晕，外圈缓慢呼吸

#### 1.7 代码块语法高亮
- 引入 `highlight.js` CDN
- 深色主题匹配当前界面
- 代码块左上角添加复制按钮

#### 1.8 消息气泡优化
- Assistant消息: 左侧紫色细条指示（类似Linear的bot消息样式）
- User消息: 右对齐 + 轻微背景色区分
- 增加消息时间戳显示

---

### 阶段二：交互增强

#### 2.1 命令面板 (Command Palette)
**现状**: 已有基础palette对话框

**优化内容**:
- 分组显示：最近使用 / 导航 / 操作 / 设置
- 每项带图标 (emoji或SVG) + 快捷键提示
- 键盘导航支持（↑↓ Enter Esc）
- 模糊搜索（fuzzy search）
- 新增命令示例：
  - `新会话` → Cmd+N
  - `切换到技能中心` → Cmd+2
  - `导出会话`
  - `清空当前会话`
  - `打开设置`

#### 2.2 Toast通知系统
**结构**:
```html
<div class="toast-container" id="toastContainer"></div>
```

**Toast类型**:
| 类型 | 颜色 | 图标 | 用途 |
|------|------|------|------|
| success | --success | ✓ | 操作成功 |
| error | --danger | ✕ | 错误提示 |
| warning | --warning | ⚠ | 警告信息 |
| info | --primary | ℹ | 一般信息 |

**行为**:
- 出现在右下角
- 入场: slide-in from right + fade, 150ms
- 停留: 4秒（可配置）
- 出场: fade-out, 200ms
- hover时暂停消失计时
- 最多同时显示3条

#### 2.3 Modal对话框
**场景**:
- 确认对话框（删除、清除等危险操作）
- 表单对话框（新建会话等）
- 提示/Tip对话框

**结构**:
```html
<div class="modal-overlay" id="modalOverlay">
  <div class="modal-dialog">
    <div class="modal-header">
      <span class="modal-title">标题</span>
      <button class="modal-close">×</button>
    </div>
    <div class="modal-body"></div>
    <div class="modal-footer"></div>
  </div>
</div>
```

**动画**:
- Overlay: fade-in 150ms
- Dialog: scale(0.95) → scale(1) + fade, 200ms ease-out
- 关闭: 反向

#### 2.4 全局快捷键
| 快捷键 | 功能 |
|--------|------|
| Cmd/Ctrl+K | 打开命令面板 |
| Cmd/Ctrl+N | 新建会话 |
| Escape | 关闭当前面板/Modal |
| Cmd/Ctrl+/ | 打开快捷键帮助 |

#### 2.5 Inspector侧滑动效
- 展开/收起: 300ms spring ease
- 宽度: 280px → 360px (展开详情时)
- 背景blur增强

---

### 阶段三：组件库补齐

#### 3.1 Tooltip
```css
.tooltip {
  position: absolute;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  box-shadow: var(--shadow-sm);
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  transition: opacity 100ms;
}
.tooltip.visible { opacity: 1; }
```

**位置**: 支持 top / bottom / left / right 自动翻转

#### 3.2 DropdownMenu
- 触发: click / hover (可配置)
- 箭头指示器 (chevron)
- 分组分隔线
- 禁用状态
- 点击外部自动关闭

#### 3.3 Progress / Spinner
**Spinner**:
```css
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

**Progress Bar**: 沿用现有的 `.token-budget-fill` 样式，独立为通用 `.progress-bar`

**骨架屏 (Skeleton)**:
```css
.skeleton {
  background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

#### 3.4 Badge / Tag
```css
.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-elevated);
  color: var(--text-muted);
}
.badge.primary { background: var(--accent-glow); color: var(--primary); }
.badge.success { background: rgba(34,197,94,0.15); color: var(--success); }
```

#### 3.5 Avatar
```css
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
}
.avatar.user { background: rgba(59,130,246,0.15); color: #3B82F6; }
```

#### 3.6 右键菜单 (Context Menu)
- 触发: right-click / long-press
- 样式同DropdownMenu
- 支持图标 + 分隔线
- 键盘可聚焦

---

## 4. 文件变更清单

| 文件 | 变更类型 |
|------|----------|
| `public/styles.css` | 主要变更：新增CSS变量、动效、组件样式 |
| `public/app.js` | 新增：Toast系统、Modal、命令面板增强、右键菜单、快捷键绑定 |
| `public/index.html` | 少量变更：Toast容器、Modal模板、复制按钮模板 |
| `public/brand-mark.svg` | 可选：增强SVG动效 |

---

## 5. 风险与约束

- **毛玻璃性能**: `backdrop-filter` 在低端设备上可能有性能影响，需加 `will-change: transform` 优化
- **冲突避免**: 所有新增class带统一前缀或放在现有命名空间下
- **兼容性**: CSS变量、grid、flexbox均为现代浏览器支持，无需额外polyfill
- **CDN依赖**: highlight.js语法高亮引入外部CDN，需考虑离线场景

---

## 6. 实施优先级

1. **styles.css** — CSS变量重组 + 视觉增强
2. **app.js** — Toast系统 + 快捷键绑定
3. **app.js** — Modal系统
4. **app.js** — 命令面板增强
5. **styles.css + app.js** — 新增组件 (Tooltip, Dropdown, Badge等)
6. **index.html** — 模板补充

---

## 7. 成功标准

- [ ] 视觉: 界面质感接近Linear水平，有"高级感"
- [ ] 动效: 所有过渡100-200ms，无掉帧
- [ ] 交互: 命令面板可用，Toast正常弹出和消失
- [ ] 组件: Tooltip/Badge等可在任意场景使用
- [ ] 无regression: 现有18个视图功能正常
