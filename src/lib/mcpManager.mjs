import { spawn } from 'node:child_process';
import path from 'node:path';
import { validateCommand, validateWorkspacePath } from './safety.mjs';
import { McpProtocol } from './mcpProtocol.mjs';
import { McpTransport, createTransportFromProcess } from './mcpTransport.mjs';

const ALLOWED_MCP_EXECUTABLES = new Set(['node', 'npx', 'uvx', 'python', 'python3']);
const MAX_LOG_BYTES = 48 * 1024;

function appendLog(existing, chunk) {
  const next = `${existing || ''}${chunk.toString('utf8')}`;
  return next.length > MAX_LOG_BYTES ? next.slice(-MAX_LOG_BYTES) : next;
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

    return { ok: true, status: 'running', pid: child.pid };
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
