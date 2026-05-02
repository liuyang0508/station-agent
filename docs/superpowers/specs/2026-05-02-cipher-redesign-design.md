# Station Agent — UI Redesign & Configuration

**Date:** 2026-05-02
**Status:** Approved for Implementation

---

## 1. Concept & Vision

**Station** — AI Agent 客户端，重新定义极简科技美学。

视觉语言：深空黑底 + 电紫色光晕，克制、精准、富有未来感。界面如同一艘星际飞船的控制台——每个元素都有存在的理由，信息密度高但不拥挤。

目标：让用户感受到"工具即武器"的专业感，同时拥有精致舒适的交互体验。

---

## 2. Design Language

### 2.1 Aesthetic Direction
- **Style:** 极简科技风 (Minimal Tech)
- **Reference:** Linear / Vercel / Arc Browser
- **Mood:** 清冽、理性、未来感、高端克制

### 2.2 Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-deep` | `#0A0A0F` | 主背景 |
| `--bg-surface` | `#111118` | 卡片/面板 |
| `--bg-elevated` | `#18181F` | 悬浮元素 |
| `--border` | `#1E1E2E` | 边界线 |
| `--border-subtle` | `#13131A` | 次级边界 |
| `--primary` | `#A855F7` | 主紫 |
| `--accent` | `#8B5CF6` | 强调紫 |
| `--accent-glow` | `rgba(168,85,247,0.15)` | 紫色光晕 |
| `--text-primary` | `#F8FAFC` | 主文字 |
| `--text-secondary` | `#94A3B8` | 次级文字 |
| `--text-muted` | `#64748B` | 弱化文字 |
| `--success` | `#22C55E` | 成功 |
| `--warning` | `#F59E0B` | 警告 |
| `--danger` | `#EF4444` | 危险 |

### 2.3 Typography

- **Font Family:** Inter (Google Fonts)
- **Weights:** 400 (body), 500 (labels), 600 (semibold), 700 (bold)
- **Scale:**
  - Display: 28px / 700
  - H1: 24px / 700
  - H2: 20px / 600
  - H3: 16px / 600
  - Body: 14px / 400
  - Caption: 12px / 500
  - Micro: 11px / 500

### 2.4 Logo — Station Mark

**形态：** 工作站造型 — 底座+立柱+屋顶+信号波，呼应"站点"意象

**SVG 规范：**
- viewBox: `0 0 48 48`
- Platform base: 圆角矩形
- Pillars: 两根立柱
- Roof/Canopy: 三角形屋顶
- Center dot: 发光核心
- Signal waves: 弧形信号线
- 渐变：#A855F7 → #8B5CF6
- 带 glow filter

### 2.5 Logo — Pulse Ripple Mark (备选)

**形态：** 多层脉冲涟漪同心弧线，向外扩散

**SVG 规范：**
- viewBox: `0 0 48 48`
- 4 层弧线，从内到外透明度递减
- 中心点：实心圆 4px
- 弧线 stroke-linecap: round
- 渐变：#A855F7 → #8B5CF6
- 整体带紫色 glow filter

### 2.5 Spacing System

基于 4px 网格：
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 48px

### 2.6 Motion

| Interaction | Duration | Easing | Effect |
|-------------|----------|---------|--------|
| Hover | 150ms | ease-out | scale(1.02), border-color shift |
| Press | 80ms | ease-in | scale(0.98) |
| Fade in | 200ms | ease-out | opacity 0→1 |
| Glow pulse | 2s | ease-in-out | opacity 0.6↔1 (logo) |

- 禁止超过 400ms 的装饰性动画
- prefers-reduced-motion 支持

### 2.7 Shadows & Elevation

```css
--shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
--shadow-md: 0 8px 24px rgba(0,0,0,0.4);
--shadow-glow: 0 0 20px var(--accent-glow);
```

---

## 3. Layout & Structure

### 3.1 Three-Column Grid

```
Sidebar (240px) | Main (flex 1, min 520px) | Inspector (280px)
```

- 三栏等高，overflow hidden
- Sidebar/Inspector 可隐藏（响应式）
- 最小宽度 1040px

### 3.2 Visual Pacing

- Sidebar: 紧凑导航，信息密度高
- Main: 呼吸感强，内容聚焦
- Inspector: 辅助信息，轻量化

### 3.3 Responsive

| Breakpoint | Behavior |
|------------|---------|
| ≤1180px | Inspector 隐藏 |
| ≤760px | 单栏，Sidebar 变为底部 Tab Nav |

---

## 4. Component Inventory

### 4.1 Brand Header

- Logo mark (32px) + "CIPHER" 文字
- 背景透明，左侧留白充足
- Hover: logo glow 增强

### 4.2 Navigation Item

| State | Style |
|-------|-------|
| Default | 文字 #64748B，无背景 |
| Hover | 文字 #94A3B8，bg #18181F |
| Active | 文字 #A855F7，左侧 2px 紫色竖条 |

- Height: 36px
- Border-radius: 6px
- Padding: 0 12px

### 4.3 Button — Primary

| State | Style |
|-------|-------|
| Default | bg #A855F7, text white |
| Hover | bg #9333EA, shadow-glow |
| Press | scale(0.98) |
| Disabled | opacity 0.5 |

### 4.4 Button — Secondary

| State | Style |
|-------|-------|
| Default | bg transparent, border #1E1E2E, text #94A3B8 |
| Hover | border #A855F7, text #F8FAFC |

### 4.5 Input / Textarea

| State | Style |
|-------|-------|
| Default | bg #111118, border #1E1E2E, text #F8FAFC |
| Focus | border #A855F7, glow ring |
| Error | border #EF4444 |

- Border-radius: 8px
- Placeholder: #64748B

### 4.6 Card / Panel

- bg: #111118
- border: 1px solid #1E1E2E
- border-radius: 12px
- hover: border-color → #8B5CF6

### 4.7 Status Pill

| Status | Style |
|--------|-------|
| ready/enabled | bg rgba(34,197,94,0.15), text #22C55E |
| pending/warn | bg rgba(245,158,11,0.15), text #F59E0B |
| error/danger | bg rgba(239,68,68,0.15), text #EF4444 |
| neutral | bg #18181F, text #64748B |

### 4.8 Message Bubble

- User: bg #1a1a2e, border subtle
- Assistant: bg #111118, border subtle
- 最大宽度 680px
- border-radius: 12px

---

## 5. Icon System

**规则：**
- 只使用 SVG icons (Heroicons / Lucide)
- Stroke width: 1.5px 或 2px
- Size: 16px (inline) / 20px (nav) / 24px (feature)
- 禁止 emoji 作为图标

---

## 6. Anti-Patterns

- ❌ 渐变背景
- ❌ 圆角过大 (>16px)
- ❌ 高饱和彩色区块
- ❌ 纯黑字在深色背景（对比度不足）
- ❌ 装饰性动画超过 400ms
- ❌ Emoji 作为结构图标

---

## 7. Implementation Files

| File | Change |
|-------|--------|
| `public/brand-mark.svg` | 新设计：Pulse Ripple Mark |
| `public/styles.css` | 全量重写：颜色、字体、组件 |
| `public/index.html` | 可选：品牌名 Astra → Cipher |
| `macos/Info.plist` | 同步 App 名称 |

---

## 8. LLM Configuration

### 8.1 MiniMax (Anthropic-compatible)

**Environment Variable (no key in files):**
```bash
export AIAGENT_API_KEY="your-key-here"
```

**Client Settings:**
| Field | Value |
|-------|-------|
| 运行模式 | `remote` |
| Base URL | `https://api.minimax.io/anthropic` |
| Model | `MiniMax-M2.7` |
| API Key Env | `AIAGENT_API_KEY` |
| API Key | 留空（环境变量注入） |

**Provider:** `anthropic` (in store.json)

### 8.2 Other Supported Providers

- OpenAI-compatible (default)
- Anthropic
- Custom OpenAI-compatible endpoints

---

## 9. Success Criteria

- [ ] Logo 脉冲涟漪效果清晰，紫色渐变正确
- [ ] 深色背景无眩光，眼睛舒适
- [ ] 主文字 #F8FAFC 对比度 ≥ 4.5:1
- [ ] 紫色光晕在 hover/focus 时正确触发
- [ ] 动画流畅，无 jank (150-300ms)
- [ ] 响应式断点正常
- [ ] 无 emoji icons
- [ ] prefers-reduced-motion 支持
