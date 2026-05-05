import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { JsonStore } from './lib/store.mjs';
import { runReadOnlyCommand, validateReadOnlyCommand } from './lib/commandRunner.mjs';
import { McpManager } from './lib/mcpManager.mjs';
import { referenceBlueprint, summarizeReferences } from './lib/referenceBlueprint.mjs';
import { validateWorkspacePath, redactSecret } from './lib/safety.mjs';
import { deleteModelApiKey, readModelApiKey, writeModelApiKey } from './lib/secrets.mjs';
import { exportSessionJson, exportSessionMarkdown } from './lib/sessionExport.mjs';
import { installSkillFromWorkspace, runSkill } from './lib/skillManager.mjs';
import { listWorkspaceDirectory, readWorkspaceFile } from './lib/workspace.mjs';
import { runAgentTurn, agentLoop, harness } from './runtime/agentRuntime.mjs';
import { setPythonSidecar } from './runtime/toolRegistry.mjs';
import { parseSkillMarkdown } from './lib/skillFormats.mjs';
import { SkillEvolution, createSkillEvolution } from './lib/skillEvolution.mjs';
import { PythonSidecar } from './lib/pythonSidecar.mjs';
import { testModelConnection } from './runtime/modelRuntime.mjs';
import { ContextCompactor, SubagentManager } from './runtime/sandboxExecutor.mjs';
import { renderDiffAsText } from './lib/diffEngine.mjs';
import { WorkflowEngine, parseAgentWorkflow } from './runtime/workflowEngine.mjs';
import { createToolRegistry } from './runtime/toolRegistry.mjs';
import { WorkspaceWatcher } from './lib/fileWatcher.mjs';
import { PluginManager, createPluginScaffold } from './lib/pluginSystem.mjs';
import { TaskScheduler } from './lib/taskScheduler.mjs';
import { RollbackManager } from './lib/rollbackManager.mjs';
import { SkillSyncManager } from './lib/skillSyncManager.mjs';
import { PythonBridge } from './runtime/pythonBridge.mjs';
import { generateEmbedding } from './lib/embedding.mjs';
import { SkillCache } from './lib/skillCache.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const store = new JsonStore();
const skillSyncManager = new SkillSyncManager({ store, dataDir: path.join(projectRoot, 'data') });
const mcpManager = new McpManager({ store });
// Auto-register filesystem MCP server if not already configured
const existingServers = store.listMcpServers();
const hasFilesystem = existingServers.some(s => s.name === 'filesystem');
if (!hasFilesystem) {
  try {
    store.createMcpServer({
      name: 'Filesystem MCP',
      command: 'node',
      args: [path.join(projectRoot, 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'), path.join(projectRoot, 'public')],
      cwd: projectRoot,
      env: {},
      enabled: true
    });
  } catch (e) {
    console.warn('Failed to register filesystem MCP server:', e.message);
  }
}
const subagentManager = new SubagentManager({ store, settings: store.getSettings() });
const workspaceWatcher = new WorkspaceWatcher({ store });
const pluginManager = new PluginManager({ store, settings: store.getSettings() });
const taskScheduler = new TaskScheduler({ store, subagentManager });
const rollbackManager = new RollbackManager({
  store,
  workspaceRoot: store.getSettings().workspaceRoot
});
const pythonSidecar = new PythonSidecar("python3", projectRoot);
setPythonSidecar(pythonSidecar); // make available to tool registry
const pythonBridge = new PythonBridge({
  pythonPath: 'python3',
  scriptPath: path.join(projectRoot, 'python', 'agent_core', 'ipc.py'),
  timeoutMs: 60000
});
const skillEvolution = createSkillEvolution(store);
const skillCache = new SkillCache(store);
const runs = new Map();
const runCancellers = new Map();
const fileChangeSubscribers = new Set();
const startedAt = new Date();

function detectMemoryTrigger(content, role) {
  // Only detect user messages
  if (role !== 'user') return null;

  // Detect trigger words
  const triggers = [
    { pattern: /记住.*/i, extractTitle: (c) => c.replace(/记住/gi, '').trim() },
    { pattern: /save to memory/i, extractTitle: () => '用户保存的记忆' },
    { pattern: /沉淀到记忆/i, extractTitle: (c) => c.replace(/沉淀到记忆/gi, '').trim() }
  ];

  for (const trigger of triggers) {
    const match = content.match(trigger.pattern);
    if (match) {
      // Check for duplicate by content similarity
      const existingMemories = store.listMemories();
      const isDuplicate = existingMemories.some(m =>
        m.content === content || m.title === trigger.extractTitle(content)
      );
      if (isDuplicate) {
        return null;
      }

      return {
        title: trigger.extractTitle(content),
        content: content,
        tags: ['auto', 'user-request'],
        source: 'auto:user-request'
      };
    }
  }
  return null;
}

function loadBuildInfo() {
  const buildInfoPath = path.join(projectRoot, 'build-info.json');
  if (!fs.existsSync(buildInfoPath)) {
    return {
      id: 'development',
      builtAt: null
    };
  }

  try {
    return JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  } catch {
    return {
      id: 'unknown',
      builtAt: null
    };
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

function parseArgs() {
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : Number(process.env.PORT || 47891);
  return {
    port,
    doctor: process.argv.includes('--doctor')
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(publicDir, `.${requestedPath}`);
  const validation = validateWorkspacePath(publicDir, target);

  if (!validation.allowed || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    notFound(res);
    return;
  }

  const ext = path.extname(target);
  res.writeHead(200, {
    'content-type': contentTypes[ext] || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  fs.createReadStream(target).pipe(res);
}

function healthSnapshot() {
  const settings = store.getSettings();
  const modelSecret = readModelApiKey(settings.apiKeyEnv);
  return {
    ok: true,
    name: referenceBlueprint.productName,
    version: '0.1.0',
    build: loadBuildInfo(),
    runtime: {
      mode: settings.runtimeMode,
      provider: settings.provider,
      model: settings.model,
      baseUrlConfigured: Boolean(settings.baseUrl),
      apiKeyEnv: settings.apiKeyEnv,
      apiKeyDetected: Boolean(modelSecret.value),
      apiKeySource: modelSecret.source,
      apiKeyPreview: redactSecret(modelSecret.value)
    },
    server: {
      pid: process.pid,
      node: process.version,
      execPath: process.execPath,
      platform: `${process.platform}/${process.arch}`,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    },
    paths: {
      appRoot: projectRoot,
      dataStore: store.getStorePath()
    },
    workspaceRoot: settings.workspaceRoot,
    references: summarizeReferences()
  };
}

function diagnosticsSnapshot() {
  const settings = store.getSettings();
  return {
    ...healthSnapshot(),
    counts: {
      sessions: store.listSessions().length,
      skills: store.listSkills().length,
      enabledSkills: store.listSkills().filter((skill) => skill.enabled).length,
      connectors: store.listConnectors().length,
      tasks: store.listTasks().length,
      approvals: store.listApprovals().length,
      pendingApprovals: store.listApprovals().filter((approval) => approval.status === 'pending').length,
      mcpServers: store.listMcpServers().length,
      runningMcpServers: store.listMcpServers().filter((server) => server.status === 'running').length,
      memories: store.listMemories().length,
      activeRuns: runs.size
    },
    config: {
      runtimeMode: settings.runtimeMode,
      approvalMode: settings.approvalMode,
      language: settings.language
    }
  };
}

function sendSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handleRunEvents(req, res, runId) {
  const run = runs.get(runId);
  if (!run) {
    sendJson(res, 404, { error: 'Run not found' });
    return;
  }

  const session = store.getSession(run.sessionId);
  if (!session) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }

  const compactor = new ContextCompactor({ maxMessages: 40, maxTokens: 60000 });
  let history = store.listMessages(session.id);
  const { messages: compactedHistory, compacted } = compactor.compact(history);

  // Collect MCP tools from running servers
  const mcpTools = [];
  for (const server of store.listMcpServers()) {
    if (server.status === 'running') {
      const serverTools = mcpManager.getTools(server.id);
      for (const tool of serverTools) {
        mcpTools.push({ name: tool.name, description: tool.description || '' });
      }
    }
  }

  const recordUsage = (usage) => {
    store.addTokenUsage({ sessionId: session.id, ...usage });
  };

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });

  let assistantContent = '';
  const trace = [];
  store.updateSession(session.id, { status: 'running' });

  try {
    for await (const event of runAgentTurn({
      prompt: run.prompt,
      session,
      history: compactedHistory,
      settings: store.getSettings(),
      skills: store.listSkills(),
      connectors: store.listConnectors(),
      memories: store.listMemories(),
      mcpTools,
      autonomousLoop: store.getSettings().autonomousMode || false,
      recordUsage,
      isCancelled: () => run.cancelled
    })) {
      if (run.cancelled) {
        sendSse(res, { type: 'done', detail: '运行已取消' });
        res.end();
        break;
      }
      if (event.type === 'assistant.delta') {
        assistantContent += event.delta;
      }
      if (event.type === 'trace' || event.type === 'tool') {
        trace.push({ ...event, id: randomUUID(), at: new Date().toISOString() });
      }
      sendSse(res, event);
    }

    if (assistantContent.trim()) {
      store.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: assistantContent,
        trace
      });
    }
    sendSse(res, { type: 'stored', sessionId: session.id });
  } catch (error) {
    store.updateSession(session.id, { status: 'idle' });
    sendSse(res, { type: 'error', message: error.message });
  } finally {
    runs.delete(runId);
    res.end();
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, healthSnapshot());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    sendJson(res, 200, diagnosticsSnapshot());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/blueprint') {
    sendJson(res, 200, referenceBlueprint);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    sendJson(res, 200, store.getSettings());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    sendJson(res, 200, store.search(url.searchParams.get('q') || ''));
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    const body = await parseJson(req);
    sendJson(res, 200, store.updateSettings(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/test-model') {
    sendJson(res, 200, await testModelConnection(store.getSettings()));
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/secrets/model-key') {
    const body = await parseJson(req);
    sendJson(res, 200, writeModelApiKey(body.apiKey));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/secrets/model-key') {
    sendJson(res, 200, deleteModelApiKey());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    sendJson(res, 200, store.listSessions());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await parseJson(req);
    sendJson(res, 201, store.createSession(body));
    return;
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'messages') {
    const session = store.getSession(parts[2]);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    sendJson(res, 200, store.listMessages(parts[2]));
    return;
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'export') {
    const session = store.getSession(parts[2]);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    const messages = store.listMessages(parts[2]);
    const format = url.searchParams.get('format') || 'markdown';
    if (format === 'json') {
      sendJson(res, 200, exportSessionJson(session, messages));
      return;
    }
    const markdown = exportSessionMarkdown(session, messages);
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${session.id}.md"`
    });
    res.end(markdown);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/runs') {
    const body = await parseJson(req);
    const session = store.getSession(body.sessionId);
    const prompt = String(body.prompt || '').trim();
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    if (!prompt) {
      sendJson(res, 400, { error: 'Prompt is required' });
      return;
    }
    store.addMessage({ sessionId: session.id, role: 'user', content: prompt });

    // Auto-write memory if trigger detected
    const memoryTrigger = detectMemoryTrigger(prompt, 'user');
    if (memoryTrigger) {
      try {
        const memory = store.createMemory(memoryTrigger);
        // Async generate embedding, don't block response
        generateEmbedding(memoryTrigger.content).then(embedding => {
          if (store.createMemoryEmbedding && memory.id) {
            store.createMemoryEmbedding(memory.id, Array.from(embedding));
          }
        }).catch(err => {
          console.error('Failed to generate embedding:', err);
        });
      } catch (err) {
        // Skip on duplicate but log other errors for debugging
        if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
          console.warn(`[memory] Failed to create memory: ${err.message}`);
        }
      }
    }

    const run = {
      id: randomUUID(),
      sessionId: session.id,
      prompt,
      createdAt: new Date().toISOString(),
      cancelled: false
    };
    runCancellers.set(run.id, () => { run.cancelled = true; });
    runs.set(run.id, run);
    sendJson(res, 201, { runId: run.id });
    return;
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'runs' && parts[3] === 'events') {
    await handleRunEvents(req, res, parts[2]);
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'runs' && parts[3] === 'cancel') {
    const runId = parts[2];
    const canceller = runCancellers.get(runId);
    if (canceller) {
      canceller();
      sendJson(res, 200, { ok: true, message: 'Run cancellation requested' });
    } else {
      sendJson(res, 404, { error: 'Run not found or already completed' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    sendJson(res, 200, store.listSkills());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/install') {
    const body = await parseJson(req);
    sendJson(res, 201, installSkillFromWorkspace({ store, settings: store.getSettings(), payload: body }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/upload') {
    try {
      const formData = await req.formData();
      const file = formData.get('file');
      const name = formData.get('name');

      if (!file || !(file instanceof File)) {
        sendJson(res, 400, { error: '未找到上传文件' });
        return;
      }

      const settings = store.getSettings();
      const tempDir = path.join(settings.workspaceRoot, '.skill-uploads');
      fs.mkdirSync(tempDir, { recursive: true });

      const ext = path.extname(file.name).toLowerCase();
      const buffer = Buffer.from(await file.arrayBuffer());
      let skillRoot = '';

      if (ext === '.zip') {
        // Extract zip to temp directory
        const zipFileName = `${randomUUID()}`;
        const extractDir = path.join(tempDir, zipFileName);
        fs.mkdirSync(extractDir, { recursive: true });

        const zip = await JSZip.loadAsync(buffer);
        const entries = Object.values(zip.files);
        await Promise.all(entries.map(async (entry) => {
          const entryPath = path.join(extractDir, entry.name);
          if (entry.dir) {
            fs.mkdirSync(entryPath, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(entryPath), { recursive: true });
            const content = await entry.async('nodebuffer');
            fs.writeFileSync(entryPath, content);
          }
        }));
        skillRoot = extractDir;
      } else {
        // Single file: save directly
        const tempFileName = `${randomUUID()}${ext}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        fs.writeFileSync(tempFilePath, buffer);
        skillRoot = tempFilePath;
      }

      const payload = { path: skillRoot };
      if (name) payload.name = name;

      const skill = installSkillFromWorkspace({ store, settings, payload });

      // Clean up temp files after installation
      try {
        if (ext === '.zip') {
          fs.rmSync(skillRoot, { recursive: true, force: true });
        } else {
          fs.unlinkSync(skillRoot);
        }
        const dirFiles = fs.readdirSync(tempDir);
        if (dirFiles.length === 0) fs.rmdirSync(tempDir);
      } catch { /* ignore cleanup errors */ }

      sendJson(res, 201, skill);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/runs') {
    sendJson(res, 200, store.listSkillRuns(url.searchParams.get('skillId')));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/evolutions') {
    const skillId = url.searchParams.get('skillId');
    sendJson(res, 200, store.listEvolutionEntries(skillId));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/evolve') {
    try {
      const body = await parseJson(req);
      const { skillId, trigger, result, userFeedback, newWorkflow } = body;

      if (!skillId) {
        sendJson(res, 400, { error: 'skillId required' });
        return;
      }

      const skillRun = result ? { skillId, ...result } : null;
      const evolution = new SkillEvolution(store);
      const suggestion = evolution.evaluate(skillRun, { userFeedback, newWorkflow });

      if (!suggestion) {
        sendJson(res, 200, { evolved: false, message: 'No evolution needed' });
        return;
      }

      // Apply evolution automatically
      const applied = await evolution.evolve(skillId, suggestion);
      sendJson(res, 200, { evolved: true, suggestion, applied });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/skills/:id/rollback - Rollback a skill from an evolution entry
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'rollback') {
    try {
      const skillId = parts[2];
      const body = await parseJson(req);
      const { evolutionEntryId } = body;

      if (!skillId) {
        sendJson(res, 400, { error: 'skillId required' });
        return;
      }

      const evolution = new SkillEvolution(store);
      const result = await evolution.rollbackSkill(skillId, evolutionEntryId);

      if (result.success) {
        sendJson(res, 200, result);
      } else {
        sendJson(res, 400, result);
      }
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/skills/:id/backups - List available backups for a skill
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'backups') {
    try {
      const skillId = parts[2];

      if (!skillId) {
        sendJson(res, 400, { error: 'skillId required' });
        return;
      }

      const evolution = new SkillEvolution(store);
      const backups = evolution.listBackups(skillId);
      sendJson(res, 200, { backups });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/parse') {
    try {
      const body = await parseJson(req);
      const { content } = body;
      if (!content) {
        sendJson(res, 400, { error: 'content required' });
        return;
      }
      const parsed = parseSkillMarkdown(content);
      sendJson(res, 200, parsed);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/skills/cache/status - 获取缓存状态
  if (req.method === 'GET' && url.pathname === '/api/skills/cache/status') {
    try {
      const status = skillCache.getStatus();
      sendJson(res, 200, { success: true, ...status });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/skills/cache/warm - 预热 skill
  if (req.method === 'POST' && url.pathname === '/api/skills/cache/warm') {
    try {
      const body = await parseJson(req);
      const { skillId } = body;
      if (skillId) {
        await skillCache.warmSkill(skillId);
        sendJson(res, 200, { success: true, warmed: skillId });
      } else {
        const result = await skillCache.warmAll();
        sendJson(res, 200, { success: true, ...result });
      }
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/skills/cache/clear - 清空内存缓存
  if (req.method === 'POST' && url.pathname === '/api/skills/cache/clear') {
    try {
      const result = skillCache.clearMemoryCache();
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/skills/:id/content - 获取 skill 完整内容
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'content') {
    try {
      const skill = await skillCache.getSkill(parts[2]);
      if (!skill) {
        sendJson(res, 404, { error: 'Skill not found' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        skill: {
          id: skill.id,
          name: skill.name,
          content: skill.content,
          format: skill.format
        }
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'toggle') {
    const skill = store.toggleSkill(parts[2]);
    if (!skill) {
      sendJson(res, 404, { error: 'Skill not found' });
      return;
    }
    sendJson(res, 200, skill);
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'run') {
    const body = await parseJson(req);
    sendJson(
      res,
      200,
      await runSkill({ store, settings: store.getSettings(), skillId: parts[2], input: body.input || {} })
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/connectors') {
    sendJson(res, 200, store.listConnectors());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp') {
    sendJson(
      res,
      200,
      store.listMcpServers().map((server) => ({
        ...server,
        runtime: mcpManager.snapshot(server.id)
      }))
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp') {
    const body = await parseJson(req);
    sendJson(res, 201, store.createMcpServer(body));
    return;
  }

  if (req.method === 'PATCH' && parts[0] === 'api' && parts[1] === 'mcp' && parts.length === 3) {
    const body = await parseJson(req);
    const server = store.updateMcpServer(parts[2], body);
    if (!server) {
      sendJson(res, 404, { error: 'MCP server not found' });
      return;
    }
    sendJson(res, 200, server);
    return;
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'mcp' && parts.length === 3) {
    mcpManager.stop(parts[2]);
    const server = store.removeMcpServer(parts[2]);
    if (!server) {
      sendJson(res, 404, { error: 'MCP server not found' });
      return;
    }
    sendJson(res, 200, server);
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'mcp' && parts[3] === 'start') {
    try {
      const result = await mcpManager.start(parts[2]);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'mcp' && parts[3] === 'stop') {
    sendJson(res, 200, mcpManager.stop(parts[2]));
    return;
  }

  // GET /api/mcp/:id/tools - List discovered tools
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'mcp' && parts[3] === 'tools') {
    const tools = mcpManager.getTools(parts[2]);
    sendJson(res, 200, { tools });
    return;
  }

  // POST /api/mcp/:id/call - Call a tool
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'mcp' && parts[3] === 'call') {
    const body = await parseJson(req);
    try {
      const result = await mcpManager.callTool(parts[2], body.name, body.args || {});
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/mcp/:id/discover - Rediscover tools
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'mcp' && parts[3] === 'discover') {
    try {
      const tools = await mcpManager.rediscoverTools(parts[2]);
      sendJson(res, 200, { tools });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // Subagent routes
  if (req.method === 'GET' && url.pathname === '/api/subagents') {
    sendJson(res, 200, subagentManager.listActive());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/subagents') {
    const body = await parseJson(req);
    const subagent = subagentManager.spawn({
      task: body.task,
      parentSessionId: body.parentSessionId,
      priority: body.priority || 'normal'
    });
    sendJson(res, 201, subagent);
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'subagents' && parts[3] === 'complete') {
    const body = await parseJson(req);
    subagentManager.complete(parts[2], body.result);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'subagents' && parts[3] === 'fail') {
    const body = await parseJson(req);
    subagentManager.fail(parts[2], body.error);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'subagents' && parts.length === 3) {
    const subagent = subagentManager.get(parts[2]);
    if (!subagent) {
      sendJson(res, 404, { error: 'Subagent not found' });
      return;
    }
    sendJson(res, 200, subagent);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    sendJson(res, 200, store.listTasks());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/approvals') {
    sendJson(res, 200, store.listApprovals());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/approvals/request') {
    const body = await parseJson(req);
    if (body.kind === 'command') {
      const validation = validateReadOnlyCommand(body.command);
      if (!validation.allowed) {
        sendJson(res, 400, { error: validation.reason });
        return;
      }
      sendJson(
        res,
        201,
        store.createApproval({
          title: `执行命令: ${validation.sanitizedCommand}`,
          detail: `工作区内只读执行，cwd=${body.cwd || '.'}`,
          kind: 'command',
          risk: 'medium',
          payload: {
            command: validation.sanitizedCommand,
            cwd: body.cwd || '.'
          }
        })
      );
      return;
    }
    sendJson(res, 201, store.createApproval(body));
    return;
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'approvals' && parts[3] === 'decision') {
    const body = await parseJson(req);
    const approval = store.decideApproval(parts[2], body.decision);
    if (!approval) {
      sendJson(res, 404, { error: 'Approval not found' });
      return;
    }
    sendJson(res, 200, approval);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tools/system/run') {
    const body = await parseJson(req);
    const approval = store.getApproval(body.approvalId);
    if (!approval || approval.status !== 'approved' || approval.kind !== 'command') {
      sendJson(res, 403, { error: '需要已批准的命令审批' });
      return;
    }
    const result = await runReadOnlyCommand({
      command: approval.payload.command,
      cwd: approval.payload.cwd || '.',
      workspaceRoot: store.getSettings().workspaceRoot
    });
    store.consumeApproval(approval.id, {
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/memories') {
    sendJson(res, 200, store.listMemories());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/token-usage') {
    const window = store.listTokenUsage();
    const dailyLimit = 100000;
    const now = Date.now();
    const windowStart = now - 24 * 60 * 60 * 1000;
    const recent = window.filter(e => e.timestamp > windowStart);
    const totals = recent.reduce((acc, e) => {
      acc.input += e.inputTokens || 0;
      acc.output += e.outputTokens || 0;
      acc.total += e.totalTokens || 0;
      return acc;
    }, { input: 0, output: 0, total: 0 });
    sendJson(res, 200, {
      dailyLimit,
      windowTokens: totals,
      windowPercent: Math.round((totals.total / dailyLimit) * 100),
      remaining: Math.max(0, dailyLimit - totals.total),
      records: recent.slice(0, 50)
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/memories') {
    const body = await parseJson(req);
    sendJson(res, 201, store.createMemory(body));
    return;
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'memories' && parts.length === 3) {
    const memory = store.deleteMemory(parts[2]);
    if (!memory) {
      sendJson(res, 404, { error: 'Memory not found' });
      return;
    }
    sendJson(res, 200, memory);
    return;
  }

  // POST /api/memories/search - Vector-based memory search
  if (req.method === 'POST' && url.pathname === '/api/memories/search') {
    try {
      const { query, limit = 5 } = await parseJson(req);

      if (!query) {
        sendJson(res, 400, { error: 'query required' });
        return;
      }

      const embedding = await generateEmbedding(query);
      const results = store.searchMemoriesByVector(Array.from(embedding), limit);

      sendJson(res, 200, {
        success: true,
        query,
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          similarity: r.similarity,
          createdAt: r.createdAt
        }))
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/workspace/list') {
    sendJson(
      res,
      200,
      listWorkspaceDirectory(store.getSettings().workspaceRoot, url.searchParams.get('path') || '.')
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/workspace/read') {
    sendJson(
      res,
      200,
      readWorkspaceFile(store.getSettings().workspaceRoot, url.searchParams.get('path'))
    );
    return;
  }

  // Diff two file paths
  if (req.method === 'POST' && url.pathname === '/api/diff') {
    const body = await parseJson(req);
    const { oldPath, newPath } = body;
    if (!oldPath || !newPath) {
      sendJson(res, 400, { error: 'oldPath and newPath required' });
      return;
    }
    try {
      const wsRoot = store.getSettings().workspaceRoot;
      const oldPathValidation = validateWorkspacePath(wsRoot, path.resolve(wsRoot, oldPath));
      if (!oldPathValidation.allowed) {
        sendJson(res, 403, { error: `oldPath: ${oldPathValidation.reason}` });
        return;
      }
      const newPathValidation = validateWorkspacePath(wsRoot, path.resolve(wsRoot, newPath));
      if (!newPathValidation.allowed) {
        sendJson(res, 403, { error: `newPath: ${newPathValidation.reason}` });
        return;
      }
      const oldContent = fs.readFileSync(oldPathValidation.target, 'utf8');
      const newContent = fs.readFileSync(newPathValidation.target, 'utf8');
      const result = renderDiffAsText(oldContent, newContent);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/settings/sync - Export current settings for backup
  if (req.method === 'GET' && url.pathname === '/api/settings/sync') {
    const settings = store.getSettings();
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      skills: store.listSkills(),
      memories: store.listMemories(),
      mcpServers: store.listMcpServers().map(s => ({ ...s, env: {} })),
      approvals: store.listApprovals()
    };
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="station-agent-backup.json"'
    });
    res.end(JSON.stringify(exportData, null, 2));
    return;
  }

  // POST /api/settings/sync - Import settings from backup
  if (req.method === 'POST' && url.pathname === '/api/settings/sync') {
    try {
      const body = await parseJson(req);
      const { version, settings, skills, memories, mcpServers } = body;
      if (!version || !settings) {
        sendJson(res, 400, { error: 'Invalid backup format' });
        return;
      }
      store.updateSettings(settings);
      if (Array.isArray(skills)) {
        const existing = store.listSkills();
        for (const skill of skills) {
          if (!existing.find(s => s.name === skill.name)) {
            try { store.installSkill(skill); } catch (err) {
            // Skip on duplicate (SQLITE_CONSTRAINT) but log other errors
            if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
              console.warn(`[import] Failed to import skill "${skill.name}": ${err.message}`);
            }
          }
          }
        }
      }
      if (Array.isArray(memories)) {
        const existing = store.listMemories();
        for (const mem of memories) {
          if (!existing.find(m => m.title === mem.title)) {
            try { store.createMemory({ title: mem.title, content: mem.content, tags: mem.tags, source: 'imported' }); } catch (err) {
              // Skip on duplicate but log other errors
              if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
                console.warn(`[import] Failed to import memory "${mem.title}": ${err.message}`);
              }
            }
          }
        }
      }
      if (Array.isArray(mcpServers)) {
        const existing = store.listMcpServers();
        for (const srv of mcpServers) {
          if (!existing.find(s => s.name === srv.name)) {
            try { store.createMcpServer({ name: srv.name, command: srv.command, args: srv.args, cwd: srv.cwd, enabled: false }); } catch (err) {
              // Skip on duplicate but log other errors
              if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
                console.warn(`[import] Failed to import MCP server "${srv.name}": ${err.message}`);
              }
            }
          }
        }
      }
      sendJson(res, 200, { ok: true, message: '设置已从备份恢复' });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/settings/cloud-backup - Push to user-provided cloud endpoint
  if (req.method === 'POST' && url.pathname === '/api/settings/cloud-backup') {
    try {
      const body = await parseJson(req);
      const { endpoint, apiKey } = body;
      if (!endpoint) {
        sendJson(res, 400, { error: 'endpoint is required' });
        return;
      }
      const backupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: store.getSettings(),
        skills: store.listSkills(),
        memories: store.listMemories()
      };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { 'authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(backupData)
      });
      if (!response.ok) throw new Error(`Cloud backup failed: ${response.statusText}`);
      sendJson(res, 200, { ok: true, message: '已备份到云端' });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // Model configs CRUD
  if (req.method === 'GET' && url.pathname === '/api/models') {
    sendJson(res, 200, store.listModelConfigs());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/models') {
    const body = await parseJson(req);
    sendJson(res, 201, store.upsertModelConfig(body));
    return;
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'models' && parts.length === 3) {
    const removed = store.removeModelConfig(parts[2]);
    if (!removed) {
      sendJson(res, 404, { error: 'Model config not found' });
      return;
    }
    sendJson(res, 200, removed);
    return;
  }

  // Workflow execution from AGENT.md definition
  if (req.method === 'POST' && url.pathname === '/api/workflow/run') {
    const body = await parseJson(req);
    const { skillId, input = {} } = body;
    if (!skillId) {
      sendJson(res, 400, { error: 'skillId required' });
      return;
    }

    const skill = store.listSkills().find(s => s.id === skillId);
    if (!skill) {
      sendJson(res, 404, { error: 'Skill not found' });
      return;
    }

    // Parse agent.md metadata from skill
    const parsed = parseAgentMarkdown(skill.metadata?.raw || '');
    if (!parsed.capabilities || parsed.capabilities.length === 0) {
      sendJson(res, 400, { error: 'Skill has no AGENT.md workflow definition' });
      return;
    }

    const workflowDef = parseAgentWorkflow(parsed);
    const engine = new WorkflowEngine({ maxParallel: 3 });
    const settings = store.getSettings();
    const tools = createToolRegistry({ settings });

    // Execute workflow and stream steps
    const steps = engine.buildWorkflow(workflowDef, { input, skill });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });

    for await (const event of engine.execute(steps, { input }, tools)) {
      sendSse(res, event);
    }

    res.end();
    return;
  }

  // File watcher management
  if (req.method === 'POST' && url.pathname === '/api/watcher/start') {
    try {
      workspaceWatcher.startWatching();
      sendJson(res, 200, { ok: true, message: '文件监控已启动' });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/watcher/stop') {
    workspaceWatcher.stopWatching();
    sendJson(res, 200, { ok: true, message: '文件监控已停止' });
    return;
  }

  // Subscribe to file change SSE stream
  if (req.method === 'GET' && url.pathname === '/api/watcher/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
    fileChangeSubscribers.add(res);
    res.on('close', () => fileChangeSubscribers.delete(res));
    return;
  }

  // Plugin routes
  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    sendJson(res, 200, {
      plugins: pluginManager.listPlugins(),
      hookCount: pluginManager.getHookCount()
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins/scan') {
    try {
      const loaded = await pluginManager.loadAllPlugins();
      sendJson(res, 200, { ok: true, loaded: loaded.length });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins/scaffold') {
    const body = await parseJson(req);
    const { name } = body;
    if (!name) {
      sendJson(res, 400, { error: 'plugin name required' });
      return;
    }
    try {
      const scaffold = createPluginScaffold(name);
      const pluginDir = path.join(store.getSettings().workspaceRoot, 'plugins', name.toLowerCase().replace(/\s+/g, '-'));
      fs.mkdirSync(pluginDir, { recursive: true });
      for (const [filename, content] of Object.entries(scaffold)) {
        if (filename !== 'manifest.json') continue;
        fs.writeFileSync(path.join(pluginDir, filename), content);
      }
      sendJson(res, 201, { ok: true, path: pluginDir });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // Rollback routes
  if (req.method === 'GET' && url.pathname === '/api/rollback') {
    sendJson(res, 200, rollbackManager.listOperations());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rollback') {
    const body = await parseJson(req);
    const { operationId } = body;
    if (!operationId) {
      sendJson(res, 400, { error: 'operationId required' });
      return;
    }
    try {
      const result = await rollbackManager.rollback(operationId);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // Skill sync routes
  if (req.method === 'POST' && url.pathname === '/api/skills/sync') {
    try {
      const result = await skillSyncManager.syncAll();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/sync-status') {
    sendJson(res, 200, skillSyncManager.getStatus());
    return;
  }

  // GET /api/skills/:id/evolution - Get skill evolution history
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'evolution') {
    try {
      const entries = store.listEvolutionEntries(parts[2]);
      sendJson(res, 200, { success: true, entries });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/skills/:id/evolution - Manually trigger evolution
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'skills' && parts[3] === 'evolution') {
    try {
      const body = await parseJson(req);
      const { action, trigger, delta } = body;
      const evolution = {
        action,
        trigger,
        delta,
        reason: 'Manual trigger'
      };
      const entry = await skillEvolution.evolve(parts[2], evolution);
      sendJson(res, 200, { success: true, entry });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/skills/evolution/history - Get global evolution history
  if (req.method === 'GET' && url.pathname === '/api/skills/evolution/history') {
    try {
      const entries = store.listEvolutionEntries();
      sendJson(res, 200, { success: true, entries });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ─── Python Sidecar Routes ────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/python/skills') {
    try {
      const skills = await pythonSidecar.skillList();
      sendJson(res, 200, skills);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/python/skills/load') {
    try {
      const { path: skillPath } = await parseJson(req);
      const result = await pythonSidecar.skillLoad(skillPath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/python/skills/run') {
    try {
      const { name, context } = await parseJson(req);
      const result = await pythonSidecar.skillRun(name, context);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/python/memories') {
    try {
      const memories = await pythonSidecar.memoryList();
      sendJson(res, 200, memories);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/python/memories') {
    try {
      const { content, metadata, embedding } = await parseJson(req);
      const result = await pythonSidecar.memoryStore(content, metadata || {}, embedding);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/python/exec') {
    try {
      const { code, cwd, timeout } = await parseJson(req);
      const result = await pythonSidecar.execRun(code, cwd, timeout);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/agent/run - Execute with Python Agent
  if (req.method === 'POST' && url.pathname === '/api/agent/run') {
    try {
      const { input, context } = await parseJson(req);
      const result = await pythonBridge.run(input, context);
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/agent/stream - Streaming execution (SSE)
  if (req.method === 'GET' && url.pathname === '/api/agent/stream') {
    const { input, context } = url.searchParams ? Object.fromEntries(url.searchParams) : {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of pythonBridge.runStreaming(input, { context })) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
    return;
  }

  // GET /api/agent/loop/status - 获取循环状态
  if (req.method === 'GET' && url.pathname === '/api/agent/loop/status') {
    try {
      const status = agentLoop.getStatus();
      sendJson(res, 200, { success: true, ...status });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/agent/loop/start - 启动循环
  if (req.method === 'POST' && url.pathname === '/api/agent/loop/start') {
    try {
      agentLoop.start();
      sendJson(res, 200, { success: true, state: agentLoop.state });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/agent/loop/stop - 停止循环
  if (req.method === 'POST' && url.pathname === '/api/agent/loop/stop') {
    try {
      agentLoop.stop();
      sendJson(res, 200, { success: true, state: agentLoop.state });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/agent/loop/pause - 暂停循环
  if (req.method === 'POST' && url.pathname === '/api/agent/loop/pause') {
    try {
      agentLoop.pause();
      sendJson(res, 200, { success: true, state: agentLoop.state });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/harness/status - 获取 harness 状态
  if (req.method === 'GET' && url.pathname === '/api/harness/status') {
    try {
      const status = harness.getStatus();
      sendJson(res, 200, { success: true, ...status });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/harness/checkpoint - 创建检查点
  if (req.method === 'POST' && url.pathname === '/api/harness/checkpoint') {
    try {
      const { state, label, metadata } = await parseJson(req);
      const checkpointId = harness.saveCheckpoint(state, label, metadata);
      sendJson(res, 200, { success: true, checkpointId });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/harness/rollback - 回滚
  if (req.method === 'POST' && url.pathname === '/api/harness/rollback') {
    try {
      const { checkpointId } = await parseJson(req);
      const state = harness.rollbackTo(checkpointId);
      if (state) {
        sendJson(res, 200, { success: true, state });
      } else {
        sendJson(res, 404, { error: 'Checkpoint not found' });
      }
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/harness/constraints - 获取约束列表
  if (req.method === 'GET' && url.pathname === '/api/harness/constraints') {
    try {
      const constraints = harness.enforcer.list();
      sendJson(res, 200, { success: true, constraints });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // Default: 404
  notFound(res);
}

  function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        await handleApi(req, res);
        return;
      }
      serveStatic(req, res);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
  });
}

const args = parseArgs();

if (args.doctor) {
  console.log(JSON.stringify(healthSnapshot(), null, 2));
  process.exit(0);
}

// Skill sync on startup (non-blocking)
skillSyncManager.syncAll().catch(err => {
  console.warn('Skill sync failed (non-critical):', err.message);
});

// Start Python sidecar
try {
  pythonSidecar.start();
  pythonSidecar._syncLoadedSkills(); // populate skill cache before first tool registry use
} catch (e) {
  console.warn('Python sidecar start failed:', e.message);
}

process.on('exit', () => pythonSidecar.stop());

createServer().listen(args.port, '127.0.0.1', () => {
  console.log(`AIAgent Client running at http://127.0.0.1:${args.port}`);
  taskScheduler.start();

  // Auto-start enabled MCP servers
  for (const server of store.listMcpServers()) {
    if (server.enabled && server.status !== 'running') {
      mcpManager.start(server.id).catch(err => {
        console.warn(`MCP server ${server.name} start failed:`, err.message);
      });
    }
  }
});
