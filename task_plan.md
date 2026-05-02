# Task Plan: 增强 AIAgent Client 下一阶段功能

## Goal
将 AIAgent Client 从 v0.1 骨架增强为功能完整的生产级 Agent 客户端，实现 README 中"下一阶段"的所有特性。

## Current Phase
Phase 2

## Phases

### Phase 1: Requirements & Discovery
- [x] 理解用户意图：增强下一阶段功能
- [x] 分析当前架构和已实现功能
- [x] 确定增强优先级和技术方案
- [x] 文档化发现到 findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 设计 MCP stdio 协议集成方案 (JSON-RPC 2.0)
- [x] 设计 Hermes/OpenClaw/OpenCowork 适配器架构
- [x] 设计 SQLite + 向量检索存储方案
- [x] 设计可写命令审批与回滚机制
- [x] 设计跨平台执行器方案
- [x] 更新 ARCHITECTURE.md
- [x] 文档化技术决策到 findings.md
- **Status:** complete

### Phase 3: Implementation - MCP 协议层
- [x] 实现 MCP stdio 协议握手
- [x] 实现工具发现机制
- [x] 实现工具调用回放
- [x] 扩展 mcpManager.mjs
- **Status:** complete

### Phase 4: Implementation - 深度适配器
- [x] 实现 Hermes CLI 适配器
- [x] 实现 OpenClaw Gateway 适配器
- [x] 实现 OpenCowork Sandbox 适配器
- [x] 更新 agentRuntime.mjs 支持多运行时
- **Status:** complete

### Phase 5: Implementation - SQLite 存储
- [x] 替换 JSON store 为 SQLite
- [x] 实现文件索引
- [x] 实现向量检索（ml-distance 余弦相似度）
- [x] 迁移现有数据
- **Status:** complete

### Phase 6: Implementation - 审批与回滚
- [x] 实现细粒度可写命令审批
- [x] 实现文件变更回滚记录
- [x] 实现审批队列管理
- [x] 扩展 commandRunner.mjs
- **Status:** complete

### Phase 7: Implementation - 跨平台执行器
- [x] 实现 Windows WSL2 执行器
- [x] 实现 macOS Lima 执行器
- [x] 实现 Linux Docker 执行器
- [x] 实现执行器生命周期管理
- **Status:** complete

### Phase 8: Testing & Verification
- [x] 单元测试所有新模块
- [x] 集成测试 MCP 协议
- [x] 集成测试跨平台执行器
- [x] 验证 SQLite 数据迁移
- [x] 验证审批回滚机制
- **Status:** complete

### Phase 9: Delivery
- [x] 更新 ARCHITECTURE.md
- [x] 更新 README.md
- [x] 生成最终构建产物
- [x] 交付用户
- **Status:** complete

## Key Questions
1. MCP stdio 协议是否需要完整实现还是部分实现优先？
2. SQLite 是否需要支持向量检索，还是先实现基础存储？
3. 跨平台执行器是否需要同时支持还是分批实现？
4. 回滚机制是基于文件系统快照还是操作日志？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| MCP stdio 优先实现握手和工具发现 | 工具调用回放依赖前置协议 |
| SQLite 基础存储优先，向量检索可选 | 减少初期复杂度 |
| 跨平台执行器分期实现 | WSL2/Lima/容器化各自独立 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |
