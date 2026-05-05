/**
 * Settings Routes — get, update, sync/backup
 */

import { validateWorkspacePath } from '../lib/safety.mjs';
import { testModelConnection } from '../runtime/modelRuntime.mjs';

export default function settingsRoutes(routes) {
  // GET /api/settings
  routes.get('/api/settings', (context) => {
    const { req, res, store } = context;
    const settings = store.getSettings();
    // Mask sensitive fields
    const safe = { ...settings };
    delete safe.apiKey;
    sendJson(res, 200, safe);
  });

  // PATCH /api/settings
  routes.patch('/api/settings', async (context) => {
    const { req, res, store, body } = context;
    if (!body || typeof body !== 'object') {
      sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }
    const updated = store.updateSettings(body);
    sendJson(res, 200, { ok: true, settings: updated });
  });

  // GET /api/settings/sync — Export backup
  routes.get('/api/settings/sync', (context) => {
    const { req, res, store } = context;
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
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="station-agent-backup.json"'
    });
    res.end(JSON.stringify(exportData, null, 2));
  });

  // POST /api/settings/sync — Import backup
  routes.post('/api/settings/sync', async (context) => {
    const { req, res, store, body } = context;
    const { version, settings, skills, memories, mcpServers } = body;

    if (!version || !settings) {
      sendJson(res, 400, { error: 'Invalid backup format' });
      return;
    }

    store.updateSettings(settings);

    // Import skills
    if (Array.isArray(skills)) {
      const existing = store.listSkills();
      for (const skill of skills) {
        if (!existing.find(s => s.name === skill.name)) {
          try {
            store.installSkill(skill);
          } catch (err) {
            if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
              console.warn(`[import] Failed to import skill "${skill.name}": ${err.message}`);
            }
          }
        }
      }
    }

    // Import memories
    if (Array.isArray(memories)) {
      const existing = store.listMemories();
      for (const mem of memories) {
        if (!existing.find(m => m.title === mem.title)) {
          try {
            store.createMemory({ title: mem.title, content: mem.content, tags: mem.tags, source: 'imported' });
          } catch (err) {
            if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
              console.warn(`[import] Failed to import memory "${mem.title}": ${err.message}`);
            }
          }
        }
      }
    }

    // Import MCP servers
    if (Array.isArray(mcpServers)) {
      const existing = store.listMcpServers();
      for (const srv of mcpServers) {
        if (!existing.find(s => s.name === srv.name)) {
          try {
            store.createMcpServer({ name: srv.name, command: srv.command, args: srv.args, cwd: srv.cwd, enabled: false });
          } catch (err) {
            if (err.code !== 'SQLITE_CONSTRAINT' && err.code !== '23505') {
              console.warn(`[import] Failed to import MCP server "${srv.name}": ${err.message}`);
            }
          }
        }
      }
    }

    sendJson(res, 200, { ok: true, message: '设置已从备份恢复' });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
