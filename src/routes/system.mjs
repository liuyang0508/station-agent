/**
 * System Routes — health, diagnostics, blueprint
 */

import { referenceBlueprint, summarizeReferences } from '../lib/referenceBlueprint.mjs';
import { SkillCache } from '../lib/skillCache.mjs';
import { SqliteStore } from '../lib/sqliteStore.mjs';

export default function systemRoutes(routes) {
  // GET /api/health
  routes.get('/api/health', (context) => {
    const { req, res, store } = context;
    const mem = process.memoryUsage();
    sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024)
      },
      version: '0.2.0'
    });
  });

  // GET /api/diagnostics
  routes.get('/api/diagnostics', (context) => {
    const { req, res, store } = context;
    const sessionCount = store.listSessions().length;
    const skillCount = store.listSkills().length;
    const mem = process.memoryUsage();

    sendJson(res, 200, {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024)
      },
      stats: {
        sessions: sessionCount,
        skills: skillCount
      }
    });
  });

  // GET /api/blueprint
  routes.get('/api/blueprint', (context) => {
    const { req, res, store } = context;
    const blueprint = referenceBlueprint();
    sendJson(res, 200, {
      principles: blueprint.runtimePrinciples,
      conventions: blueprint.conventions,
      agentGuidelines: blueprint.agentGuidelines,
      skillManifest: blueprint.skillManifest,
      summary: summarizeReferences()
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
