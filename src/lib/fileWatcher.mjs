import fs from 'node:fs';
import path from 'node:path';
import { validateWorkspacePath } from './safety.mjs';

const watchedDirs = new Map();

export class FileWatcher {
  constructor({ workspaceRoot, onChange }) {
    this.workspaceRoot = workspaceRoot;
    this.onChange = onChange || (() => {});
    this.watcher = null;
    this.debounceTimers = new Map();
    this.DEBOUNCE_MS = 300;
  }

  watch(targetPath = '.') {
    if (this.watcher) this.unwatch();

    const resolved = path.resolve(this.workspaceRoot, targetPath);
    const validation = validateWorkspacePath(this.workspaceRoot, resolved);
    if (!validation.allowed) return false;

    this.watcher = fs.watch(resolved, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      this._debounce(resolved, filename);
    });

    this.watcher.on('error', (err) => {
      this.onChange({ type: 'error', path: targetPath, error: err.message });
    });

    watchedDirs.set(this.workspaceRoot, this);
    return true;
  }

  unwatch() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    watchedDirs.delete(this.workspaceRoot);
  }

  _debounce(base, filename) {
    const key = path.join(base, filename);
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const relativePath = path.relative(this.workspaceRoot, path.join(base, filename));
      this.onChange({
        type: 'change',
        path: relativePath,
        fullPath: path.join(base, filename),
        timestamp: new Date().toISOString()
      });
    }, this.DEBOUNCE_MS);
    this.debounceTimers.set(key, timer);
  }
}

export class WorkspaceWatcher {
  constructor({ store }) {
    this.store = store;
    this.watchers = new Map();
  }

  startWatching() {
    const settings = this.store.getSettings();
    const wsRoot = settings.workspaceRoot;

    if (this.watchers.has(wsRoot)) return;

    const watcher = new FileWatcher({
      workspaceRoot: wsRoot,
      onChange: (event) => this._notify(event)
    });

    if (watcher.watch('.')) {
      this.watchers.set(wsRoot, watcher);
    }
  }

  stopWatching() {
    for (const watcher of this.watchers.values()) {
      watcher.unwatch();
    }
    this.watchers.clear();
  }

  _notify(event) {
    // Emit via SSE would need server integration
    // For now, just log
    console.log('[WorkspaceWatcher]', JSON.stringify(event));
  }

  getWatcher(wsRoot) {
    return this.watchers.get(wsRoot);
  }
}
