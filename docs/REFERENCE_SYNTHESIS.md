# 架构参考吸收点

## 桌面客户端架构

吸收方向：

- 桌面客户端以工作区为中心。
- 会话、Trace、技能、MCP、远程控制都需要在同一个产品界面里闭环。
- 沙箱不是附加能力，而是执行层默认边界。

本项目对应落点：

- `public/index.html` 的三栏工作台。
- `src/lib/store.mjs` 的 Session、Skill、Connector、Task、Approval 对象。
- `src/lib/safety.mjs` 的路径和命令校验。

## 多通道网关架构

吸收方向：

- Gateway 应作为通道、设备、会话和状态的控制面。
- 连接器不应污染 Agent Runtime。
- 配对、健康检查和允许列表是远程控制的基础。

本项目对应落点：

- `connectors` 是独立产品对象。
- `docs/ARCHITECTURE.md` 把 Gateway 作为下一阶段适配器。
- UI 中保留连接器和安全策略两块一等入口。

## 工具注册与技能系统

吸收方向：

- 工具注册表比散落函数更适合长期扩展。
- 技能、记忆、任务和运行时应形成闭环。
- 运行时必须能替换模型、终端、远端环境和消息入口。

本项目对应落点：

- `src/runtime/agentRuntime.mjs` 是稳定运行时接口。
- `skills` 采用注册对象而不是硬编码按钮。
- Runtime 适配器可接入同一运行流。
