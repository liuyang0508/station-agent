import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const PLUGIN_DIR = 'plugins';
const MANIFEST_NAME = 'manifest.json';

export class PluginManifest {
  constructor(raw) {
    this.id = raw.id || raw.name?.toLowerCase().replace(/\s+/g, '-') || randomUUID();
    this.name = raw.name || 'Unnamed Plugin';
    this.version = raw.version || '1.0.0';
    this.description = raw.description || '';
    this.author = raw.author || '';
    this.entry = raw.entry || 'index.mjs';
    this.hooks = raw.hooks || {};
    this.enabled = raw.enabled !== false;
    this.dependencies = raw.dependencies || {};
  }
}

export class PluginManager {
  constructor({ store, settings }) {
    this.store = store;
    this.settings = settings;
    this.plugins = new Map();
    this.hooks = {
      onRun: [],
      onMessage: [],
      onToolCall: [],
      onSessionCreate: [],
      onSkillRun: []
    };
  }

  getPluginDir() {
    return path.join(this.settings.workspaceRoot, PLUGIN_DIR);
  }

  async loadPlugin(pluginPath) {
    const manifestPath = path.join(pluginPath, MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifest = new PluginManifest(raw);

      const entryPath = path.join(pluginPath, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        throw new Error(`Plugin entry ${entryPath} not found`);
      }

      // Dynamic import of plugin module
      const moduleUrl = `file://${entryPath}`;
      const pluginModule = await import(moduleUrl).catch(() => null);
      if (!pluginModule) return null;

      const plugin = {
        manifest,
        module: pluginModule,
        instance: pluginModule.default ? new pluginModule.default({ settings: this.settings }) : null
      };

      // Register hooks
      this._registerHooks(plugin);

      this.plugins.set(manifest.id, plugin);
      return plugin;
    } catch (error) {
      return null;
    }
  }

  _registerHooks(plugin) {
    const { hooks } = plugin.manifest;
    if (!hooks) return;

    for (const [hookName, handlerPath] of Object.entries(hooks)) {
      if (this.hooks[hookName]) {
        this.hooks[hookName].push({ pluginId: plugin.manifest.id, handlerPath });
      }
    }
  }

  async loadAllPlugins() {
    const pluginDir = this.getPluginDir();
    if (!fs.existsSync(pluginDir)) return [];

    const results = [];
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const plugin = await this.loadPlugin(path.join(pluginDir, entry.name));
        if (plugin) results.push(plugin);
      }
    }
    return results;
  }

  async callHook(hookName, payload) {
    const handlers = this.hooks[hookName] || [];
    const results = [];
    for (const { pluginId, handlerPath } of handlers) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin?.instance) continue;
      try {
        const method = plugin.instance[handlerPath] || plugin.instance[hookName];
        if (typeof method === 'function') {
          const result = await method(payload);
          results.push({ pluginId, ok: true, result });
        }
      } catch (error) {
        results.push({ pluginId, ok: false, error: error.message });
      }
    }
    return results;
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      enabled: p.manifest.enabled
    }));
  }

  getHookCount() {
    return Object.values(this.hooks).reduce((sum, arr) => sum + arr.length, 0);
  }
}

export function createPluginScaffold(name) {
  return {
    'manifest.json': JSON.stringify({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      version: '1.0.0',
      description: `Plugin: ${name}`,
      author: '',
      entry: 'index.mjs',
      hooks: {
        onRun: 'onRun',
        onToolCall: 'onToolCall'
      },
      dependencies: {}
    }, null, 2),
    'index.mjs': `// ${name} Plugin
export default class ${name.replace(/[^a-zA-Z0-9]/g, '')}Plugin {
  constructor({ settings }) {
    this.settings = settings;
  }

  async onRun({ prompt, context }) {
    // Called after each agent run
    console.log('[${name}] onRun:', prompt);
    return context;
  }

  async onToolCall({ tool, args, result }) {
    // Called after each tool call
    console.log('[${name}] onToolCall:', tool, args);
    return result;
  }
};
`
  };
}
