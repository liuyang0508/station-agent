import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeWorkspaceRoot } from './safety.mjs';
import pkg from 'ml-distance';
const { cosine } = pkg.similarity;

function now() {
  return new Date().toISOString();
}

export class SqliteStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = this._initDb();
    this._migrate();
  }

  _initDb() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const db = new Database(this.filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        workspace_root TEXT,
        status TEXT DEFAULT 'idle',
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        trace TEXT,
        created_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        source TEXT,
        entrypoint TEXT,
        command TEXT,
        args TEXT,
        metadata TEXT,
        enabled INTEGER DEFAULT 1,
        installed_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS skill_runs (
        id TEXT PRIMARY KEY,
        skill_id TEXT,
        skill_name TEXT,
        status TEXT,
        input TEXT,
        output TEXT,
        error TEXT,
        created_at TEXT,
        FOREIGN KEY (skill_id) REFERENCES skills(id)
      );
      CREATE INDEX IF NOT EXISTS idx_skillruns_skill ON skill_runs(skill_id);

      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT,
        channel TEXT,
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT,
        command TEXT,
        args TEXT,
        cwd TEXT,
        env TEXT,
        enabled INTEGER DEFAULT 0,
        status TEXT DEFAULT 'stopped',
        source TEXT,
        tool_count INTEGER DEFAULT 0,
        last_discovered_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        title TEXT,
        detail TEXT,
        kind TEXT DEFAULT 'generic',
        payload TEXT,
        risk TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        decided_by TEXT,
        decided_at TEXT,
        result TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        source TEXT DEFAULT 'manual',
        embedding BLOB,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT,
        cadence TEXT,
        status TEXT,
        target TEXT
      );
    `);

    return db;
  }

  _migrate() {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM settings').get();
    if (count.c === 0) {
      this.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run('global', JSON.stringify(this._defaultSettings()), now());
    }
  }

  _defaultSettings() {
    const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    return {
      workspaceRoot: normalizeWorkspaceRoot(
        process.env.AIAGENT_WORKSPACE_ROOT || path.resolve(projectRoot, '..')
      ),
      runtimeMode: 'demo',
      provider: 'openai-compatible',
      baseUrl: '',
      model: 'gpt-5.2',
      apiKeyEnv: 'AIAGENT_API_KEY',
      approvalMode: 'ask',
      language: 'zh-CN'
    };
  }

  save() {}

  getSettings() {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('global');
    return row ? JSON.parse(row.value) : this._defaultSettings();
  }

  getStorePath() {
    return this.filePath;
  }

  updateSettings(patch) {
    const current = this.getSettings();
    const updated = {
      ...current,
      ...patch,
      workspaceRoot: patch.workspaceRoot
        ? normalizeWorkspaceRoot(patch.workspaceRoot)
        : current.workspaceRoot
    };
    this.db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
      .run(JSON.stringify(updated), now(), 'global');
    return updated;
  }

  listSessions() {
    return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all()
      .map(this._mapSession);
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return row ? this._mapSession(row) : null;
  }

  _mapSession(row) {
    return {
      id: row.id, title: row.title, workspaceRoot: row.workspace_root,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  createSession({ title, workspaceRoot } = {}) {
    const id = randomUUID();
    const ws = workspaceRoot || this.getSettings().workspaceRoot;
    this.db.prepare(`
      INSERT INTO sessions (id, title, workspace_root, status, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', ?, ?)
    `).run(id, title || '新的 Agent 会话', ws, now(), now());
    return this.getSession(id);
  }

  updateSession(sessionId, patch) {
    const fields = [];
    const values = [];
    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (fields.length === 0) return this.getSession(sessionId);
    fields.push('updated_at = ?');
    values.push(now());
    values.push(sessionId);
    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getSession(sessionId);
  }

  listMessages(sessionId) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId).map(this._mapMessage);
  }

  _mapMessage(row) {
    return {
      id: row.id, sessionId: row.session_id, role: row.role, content: row.content,
      trace: row.trace ? JSON.parse(row.trace) : [], createdAt: row.created_at
    };
  }

  addMessage({ sessionId, role, content, trace = [] }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, trace, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, role, content, JSON.stringify(trace), now());
    this.updateSession(sessionId, { status: 'idle' });
    return { id, sessionId, role, content, trace, createdAt: now() };
  }

  listSkills() {
    return this.db.prepare('SELECT * FROM skills ORDER BY installed_at DESC').all()
      .map(this._mapSkill);
  }

  _mapSkill(row) {
    return {
      id: row.id, name: row.name, description: row.description, source: row.source,
      entrypoint: row.entrypoint, command: row.command,
      args: row.args ? JSON.parse(row.args) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      enabled: Boolean(row.enabled), installedAt: row.installed_at, updatedAt: row.updated_at
    };
  }

  toggleSkill(skillId) {
    const skill = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId);
    if (!skill) return null;
    this.db.prepare('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(skill.enabled ? 0 : 1, now(), skillId);
    return this._mapSkill(this.db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId));
  }

  installSkill({ name, description, source = 'local', entrypoint = '', command = '', args = [], metadata = {} }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO skills (id, name, description, source, entrypoint, command, args, metadata, enabled, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, name, description, source, entrypoint, command, JSON.stringify(args), JSON.stringify(metadata), now(), now());
    return this._mapSkill(this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id));
  }

  recordSkillRun({ skillId, status, input = {}, output = '', error = '' }) {
    const id = randomUUID();
    const skill = this.db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);
    this.db.prepare(`
      INSERT INTO skill_runs (id, skill_id, skill_name, status, input, output, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, skillId, skill?.name || '', status, JSON.stringify(input), output, error, now());
    this.db.prepare(`DELETE FROM skill_runs WHERE id NOT IN (SELECT id FROM skill_runs ORDER BY created_at DESC LIMIT 100)`).run();
    return { id, skillId, skillName: skill?.name || '', status, input, output, error, createdAt: now() };
  }

  listSkillRuns(skillId) {
    const sql = skillId
      ? 'SELECT * FROM skill_runs WHERE skill_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM skill_runs ORDER BY created_at DESC';
    return this.db.prepare(sql).all(skillId || undefined).map(row => ({
      id: row.id, skillId: row.skill_id, skillName: row.skill_name, status: row.status,
      input: row.input ? JSON.parse(row.input) : {}, output: row.output, error: row.error, createdAt: row.created_at
    }));
  }

  listConnectors() {
    return this.db.prepare('SELECT * FROM connectors').all().map(row => ({
      id: row.id, name: row.name, status: row.status, channel: row.channel, source: row.source
    }));
  }

  listMcpServers() {
    return this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all()
      .map(this._mapMcpServer);
  }

  _mapMcpServer(row) {
    return {
      id: row.id, name: row.name, command: row.command,
      args: row.args ? JSON.parse(row.args) : [], cwd: row.cwd, env: row.env ? JSON.parse(row.env) : {},
      enabled: Boolean(row.enabled), status: row.status, source: row.source,
      toolCount: row.tool_count || 0, lastDiscoveredAt: row.last_discovered_at,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  getMcpServer(serverId) {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(serverId);
    return row ? this._mapMcpServer(row) : null;
  }

  createMcpServer({ name, command = '', args = [], cwd, env = {}, enabled = false }) {
    const id = randomUUID();
    const ws = cwd || this.getSettings().workspaceRoot;
    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, command, args, cwd, env, enabled, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', 'custom', ?, ?)
    `).run(id, name, command, JSON.stringify(args), ws, JSON.stringify(env), enabled ? 1 : 0, now(), now());
    return this._mapMcpServer(this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id));
  }

  updateMcpServer(serverId, patch) {
    const server = this.getMcpServer(serverId);
    if (!server) return null;
    const fields = [];
    const values = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.command !== undefined) { fields.push('command = ?'); values.push(patch.command); }
    if (patch.args !== undefined) { fields.push('args = ?'); values.push(JSON.stringify(patch.args)); }
    if (patch.cwd !== undefined) { fields.push('cwd = ?'); values.push(normalizeWorkspaceRoot(patch.cwd)); }
    if (patch.env !== undefined) { fields.push('env = ?'); values.push(JSON.stringify(patch.env)); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.toolCount !== undefined) { fields.push('tool_count = ?'); values.push(patch.toolCount); }
    if (patch.lastDiscoveredAt !== undefined) { fields.push('last_discovered_at = ?'); values.push(patch.lastDiscoveredAt); }
    if (fields.length === 0) return server;
    fields.push('updated_at = ?');
    values.push(now());
    values.push(serverId);
    this.db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getMcpServer(serverId);
  }

  removeMcpServer(serverId) {
    const row = this.getMcpServer(serverId);
    if (!row) return null;
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId);
    return row;
  }

  listTasks() {
    return this.db.prepare('SELECT * FROM tasks').all().map(row => ({
      id: row.id, title: row.title, cadence: row.cadence, status: row.status, target: row.target
    }));
  }

  listApprovals() {
    return this.db.prepare('SELECT * FROM approvals ORDER BY created_at DESC').all()
      .map(this._mapApproval);
  }

  _mapApproval(row) {
    return {
      id: row.id, title: row.title, detail: row.detail, kind: row.kind,
      payload: row.payload ? JSON.parse(row.payload) : {}, risk: row.risk, status: row.status,
      decidedBy: row.decided_by, decidedAt: row.decided_at,
      result: row.result ? JSON.parse(row.result) : {},
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  getApproval(approvalId) {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
    return row ? this._mapApproval(row) : null;
  }

  createApproval({ title, detail, kind = 'generic', payload = {}, risk = 'medium' }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO approvals (id, title, detail, kind, payload, risk, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, title, detail, kind, JSON.stringify(payload), risk, now(), now());
    return this._mapApproval(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
  }

  decideApproval(approvalId, decision, decidedBy = 'local-user') {
    const approval = this.getApproval(approvalId);
    if (!approval) return null;
    this.db.prepare(`
      UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?
    `).run(decision === 'approved' ? 'approved' : 'rejected', decidedBy, now(), now(), approvalId);
    return this.getApproval(approvalId);
  }

  consumeApproval(approvalId, result = {}) {
    const approval = this.getApproval(approvalId);
    if (!approval) return null;
    this.db.prepare(`
      UPDATE approvals SET status = 'used', result = ?, used_at = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(result), now(), now(), approvalId);
    return this.getApproval(approvalId);
  }

  listMemories() {
    return this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all()
      .map(this._mapMemory);
  }

  _mapMemory(row) {
    return {
      id: row.id, title: row.title, content: row.content,
      tags: row.tags ? JSON.parse(row.tags) : [], source: row.source,
      embedding: row.embedding, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  createMemory({ title, content, tags = [], source = 'manual' }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO memories (id, title, content, tags, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, content, JSON.stringify(tags), source, now(), now());
    return this._mapMemory(this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
  }

  createMemoryEmbedding(memoryId, embeddingVector) {
    const embedding = Buffer.from(new Float32Array(embeddingVector).buffer);
    this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, memoryId);
  }

  searchMemoriesByVector(queryEmbedding, limit = 5) {
    const memories = this.listMemories().filter(m => m.embedding);
    if (memories.length === 0) return [];
    const queryVec = new Float32Array(queryEmbedding);
    const scored = memories.map(m => {
      const emb = new Float32Array(m.embedding.buffer);
      const similarity = cosine(queryVec, emb);
      return { ...m, similarity };
    });
    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  deleteMemory(memoryId) {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (!row) return null;
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    return this._mapMemory(row);
  }

  search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { query: q, sessions: [], messages: [], memories: [], skills: [] };
    const like = `%${q}%`;
    const sessions = this.db.prepare('SELECT * FROM sessions WHERE LOWER(title) LIKE ? LIMIT 20').all(like)
      .map(this._mapSession);
    const messages = this.db.prepare(
      'SELECT * FROM messages WHERE LOWER(content) LIKE ? ORDER BY created_at DESC LIMIT 50'
    ).all(like).map(row => ({
      ...this._mapMessage(row),
      sessionTitle: this.getSession(row.session_id)?.title || '未知会话'
    }));
    const memories = this.db.prepare(
      'SELECT * FROM memories WHERE LOWER(title) LIKE ? OR LOWER(content) LIKE ? LIMIT 20'
    ).all(like, like).map(this._mapMemory);
    const skills = this.db.prepare(
      'SELECT * FROM skills WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ? LIMIT 20'
    ).all(like, like).map(this._mapSkill);
    return { query: q, sessions, messages, memories, skills };
  }

  migrateFromJsonStore(jsonStore) {
    for (const session of jsonStore.listSessions()) {
      this.db.prepare(`
        INSERT OR IGNORE INTO sessions (id, title, workspace_root, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(session.id, session.title, session.workspaceRoot, session.status, session.createdAt, session.updatedAt);
    }
    for (const session of jsonStore.listSessions()) {
      for (const msg of jsonStore.listMessages(session.id)) {
        this.db.prepare(`
          INSERT OR IGNORE INTO messages (id, session_id, role, content, trace, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(msg.id, msg.sessionId, msg.role, msg.content, JSON.stringify(msg.trace), msg.createdAt);
      }
    }
    for (const skill of jsonStore.listSkills()) {
      this.db.prepare(`
        INSERT OR IGNORE INTO skills (id, name, description, source, entrypoint, command, args, metadata, enabled, installed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(skill.id, skill.name, skill.description, skill.source, skill.entrypoint || '', skill.command || '',
        JSON.stringify(skill.args || []), JSON.stringify(skill.metadata || {}), skill.enabled ? 1 : 0, skill.installedAt, skill.updatedAt);
    }
    for (const memory of jsonStore.listMemories()) {
      this.db.prepare(`
        INSERT OR IGNORE INTO memories (id, title, content, tags, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(memory.id, memory.title, memory.content, JSON.stringify(memory.tags), memory.source, memory.createdAt, memory.updatedAt);
    }
    for (const server of jsonStore.listMcpServers()) {
      this.db.prepare(`
        INSERT OR IGNORE INTO mcp_servers (id, name, command, args, cwd, env, enabled, status, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(server.id, server.name, server.command, JSON.stringify(server.args), server.cwd,
        JSON.stringify(server.env || {}), server.enabled ? 1 : 0, server.status, server.source, server.createdAt, server.updatedAt);
    }
    for (const approval of jsonStore.listApprovals()) {
      this.db.prepare(`
        INSERT OR IGNORE INTO approvals (id, title, detail, kind, payload, risk, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(approval.id, approval.title, approval.detail, approval.kind, JSON.stringify(approval.payload),
        approval.risk, approval.status, approval.createdAt, approval.updatedAt);
    }
  }
}
