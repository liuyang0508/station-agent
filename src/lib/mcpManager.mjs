import { spawn } from 'node:child_process';
import path from 'node:path';
import { validateCommand, validateWorkspacePath } from './safety.mjs';
import { McpProtocol } from './mcpProtocol.mjs';
import { McpTransport, createTransportFromProcess } from './mcpTransport.mjs';

const ALLOWED_MCP_EXECUTABLES = new Set(['node', 'npx', 'uvx', 'python', 'python3']);
const MAX_LOG_BYTES = 48 * 1024;

// Dangerous flags that allow code execution - blocked in MCP args
const DANGEROUS_FLAGS = {
  node: ['--eval', '-e', '--check', '-c', '--print', '-p'],
  npx: ['--eval', '-e'],
  python: ['-c', '--command', '-m' /* restrict dangerous modules */],
  python3: ['-c', '--command', '-m'],
  uvx: []
};

function appendLog(existing, chunk) {
  const next = `${existing || ''}${chunk.toString('utf8')}`;
  return next.length > MAX_LOG_BYTES ? next.slice(-MAX_LOG_BYTES) : next;
}

function validateArgs(args, executable) {
  if (!Array.isArray(args)) {
    return { allowed: false, reason: 'MCP args must be an array' };
  }
  const dangerous = DANGEROUS_FLAGS[executable] || [];
  for (const arg of args) {
    const argStr = String(arg);
    // Block dangerous flags
    if (dangerous.some(d => argStr === d || argStr.startsWith(d + '='))) {
      return { allowed: false, reason: `MCP args contains dangerous flag: ${argStr}` };
    }
    // Block path traversal
    if (argStr.includes('..') || argStr.includes(';;') || /[;&|`$]/.test(argStr)) {
      return { allowed: false, reason: `MCP args contains suspicious characters: ${argStr}` };
    }
    // Block inline code execution patterns
    if (argStr.includes('eval(') || argStr.includes('exec(') || argStr.includes('__import__')) {
      return { allowed: false, reason: `MCP args contains code execution pattern` };
    }
  }
  return { allowed: true };
}

export function validateMcpConfig(server, workspaceRoot) {
  if (!server?.command) {
    return { allowed: false, reason: 'MCP 服务缺少启动命令' };
  }
  const commandCheck = validateCommand(server.command);
  if (!commandCheck.allowed) return commandCheck;
  const executable = path.basename(String(server.command).trim());
  if (!ALLOWED_MCP_EXECUTABLES.has(executable)) {
    return {
      allowed: false,
      reason: `MCP 服务启动器必须是 ${Array.from(ALLOWED_MCP_EXECUTABLES).join(', ')}`
    };
  }
  // Validate args array for injection attacks
  const argsValidation = validateArgs(server.args || [], executable);
  if (!argsValidation.allowed) return argsValidation;
  const cwdValidation = validateWorkspacePath(workspaceRoot, server.cwd || workspaceRoot);
  if (!cwdValidation.allowed) return cwdValidation;
  return {
    allowed: true,
    command: String(server.command).trim(),
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    cwd: cwdValidation.target,
    env: server.env && typeof server.env === 'object' ? server.env : {}
  };
}

export class McpManager {
  constructor({ store }) {
    this.store = store;
    this.processes = new Map();
    this.protocols = new Map();
    this.transports = new Map();
    this.toolCache = new Map();
    this.refreshIntervals = new Map();  // 定期刷新定时器
    this.refreshIntervalMs = 5 * 60 * 1000;  // 默认 5 分钟刷新一次
  }

  snapshot(serverId) {
    const processInfo = this.processes.get(serverId);
    if (!processInfo) return null;
    return {
      pid: processInfo.child.pid,
      startedAt: processInfo.startedAt,
      stdout: processInfo.stdout,
      stderr: processInfo.stderr
    };
  }

  async start(serverId) {
    const server = this.store.getMcpServer(serverId);
    if (!server) {
      throw new Error('MCP 服务不存在');
    }
    const existing = this.processes.get(serverId);
    if (existing && !existing.child.killed) {
      return { ok: true, status: 'running', pid: existing.child.pid, alreadyRunning: true };
    }

    const settings = this.store.getSettings();
    const validation = validateMcpConfig(server, settings.workspaceRoot);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    const child = spawn(validation.command, validation.args, {
      cwd: validation.cwd,
      shell: false,
      env: {
        ...process.env,
        ...validation.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const protocol = new McpProtocol();
    const transport = createTransportFromProcess(child);

    const info = {
      child,
      protocol,
      transport,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: ''
    };
    this.processes.set(serverId, info);
    this.protocols.set(serverId, protocol);
    this.transports.set(serverId, transport);

    child.stdout.on('data', (chunk) => {
      info.stdout = appendLog(info.stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      info.stderr = appendLog(info.stderr, chunk);
    });

    child.on('error', (error) => {
      info.stderr = appendLog(info.stderr, `${error.message}\n`);
      this.store.updateMcpServer(serverId, { status: 'error', lastError: error.message, pid: null });
      this.cleanup(serverId);
    });
    child.on('close', (exitCode) => {
      const nextStatus = exitCode === 0 ? 'stopped' : 'error';
      this.store.updateMcpServer(serverId, {
        status: nextStatus,
        enabled: false,
        pid: null,
        lastExitCode: exitCode,
        lastStoppedAt: new Date().toISOString()
      });
      this.cleanup(serverId);
    });

    this.store.updateMcpServer(serverId, {
      status: 'running',
      enabled: true,
      pid: child.pid,
      lastStartedAt: info.startedAt
    });

    // Perform MCP handshake
    try {
      await this.performHandshake(serverId);
    } catch (error) {
      info.stderr = appendLog(info.stderr, `Handshake failed: ${error.message}\n`);
      this.stop(serverId);
      throw error;
    }

    // Setup periodic tool refresh
    this._setupPeriodicRefresh(serverId);

    return { ok: true, status: 'running', pid: child.pid };
  }

  /**
   * 设置定期工具刷新
   */
  _setupPeriodicRefresh(serverId) {
    // 清除已有的定时器
    this._clearPeriodicRefresh(serverId);

    // 设置新的定时器
    this.refreshIntervals.set(serverId, setInterval(async () => {
      try {
        const tools = await this.discoverTools(serverId);
        console.log(`[MCP] ${serverId} 工具已刷新，当前 ${tools.length} 个工具`);
      } catch (error) {
        console.warn(`[MCP] ${serverId} 工具刷新失败: ${error.message}`);
      }
    }, this.refreshIntervalMs));
  }

  /**
   * 清除定期刷新定时器
   */
  _clearPeriodicRefresh(serverId) {
    const interval = this.refreshIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.refreshIntervals.delete(serverId);
    }
  }

  async performHandshake(serverId) {
    const protocol = this.protocols.get(serverId);
    const transport = this.transports.get(serverId);
    if (!protocol || !transport) {
      throw new Error('Protocol or transport not initialized');
    }

    // Step 1: Send initialize
    const initRequest = protocol.createInitializeRequest();
    const initResponse = await transport.sendAndWait(initRequest);

    if (initResponse.error) {
      throw new Error(`Initialize failed: ${initResponse.error.message}`);
    }

    // Step 2: Send initialized notification
    await transport.send({ jsonrpc: '2.0', method: 'initialized', params: {} });

    // Step 3: Discover tools
    await this.discoverTools(serverId);

    return true;
  }

  async discoverTools(serverId) {
    const protocol = this.protocols.get(serverId);
    const transport = this.transports.get(serverId);
    if (!protocol || !transport) {
      throw new Error('Protocol or transport not initialized');
    }

    const toolsRequest = protocol.createToolsListRequest();
    const toolsResponse = await transport.sendAndWait(toolsRequest);

    if (toolsResponse.error) {
      throw new Error(`Tools list failed: ${toolsResponse.error.message}`);
    }

    const tools = toolsResponse.result?.tools || [];
    this.toolCache.set(serverId, tools);

    this.store.updateMcpServer(serverId, {
      lastDiscoveredAt: new Date().toISOString(),
      toolCount: tools.length
    });

    return tools;
  }

  async stop(serverId) {
    const server = this.store.getMcpServer(serverId);
    if (!server) {
      throw new Error('MCP 服务不存在');
    }
    // 清除定期刷新定时器
    this._clearPeriodicRefresh(serverId);

    const info = this.processes.get(serverId);
    if (info) {
      info.transport?.close();
      info.child.kill('SIGTERM');
      this.cleanup(serverId);
    }
    this.store.updateMcpServer(serverId, {
      status: 'stopped',
      enabled: false,
      pid: null,
      lastStoppedAt: new Date().toISOString()
    });
    return { ok: true, status: 'stopped' };
  }

  cleanup(serverId) {
    this.processes.delete(serverId);
    this.protocols.delete(serverId);
    this.transports.delete(serverId);
    this.toolCache.delete(serverId);
  }

  getTools(serverId) {
    return this.toolCache.get(serverId) || [];
  }

  async callTool(serverId, toolName, args = {}) {
    const protocol = this.protocols.get(serverId);
    const transport = this.transports.get(serverId);
    if (!protocol || !transport) {
      throw new Error('Protocol or transport not initialized');
    }

    const request = protocol.createToolsCallRequest(toolName, args);
    const response = await transport.sendAndWait(request);

    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }

    return response.result;
  }

  async rediscoverTools(serverId) {
    await this.discoverTools(serverId);
    return this.getTools(serverId);
  }
}
