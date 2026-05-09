/**
 * Checkpoint Persistence — extends CheckpointManager to survive session restarts
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'path';

const CHECKPOINT_FILE = 'checkpoints.json';

/**
 * Persist checkpoints to disk, load them back on restart.
 * Each entry: { id, goal, status, label, metadata, created_at, validated_at }
 */
export class CheckpointPersistence {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, CHECKPOINT_FILE);
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  saveAll(checkpoints) {
    const serializable = checkpoints.map(cp => ({
      id: cp.id,
      goal: cp.goal,
      status: cp.status,
      label: cp.label || '',
      metadata: cp.metadata || {},
      expected_outcomes: cp.expected_outcomes || [],
      created_at: cp.created_at,
      validated_at: cp.validated_at
    }));
    fs.writeFileSync(this.filePath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  loadAll() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  clear() {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  getFilePath() {
    return this.filePath;
  }
}

/**
 * Mixin: gives any CheckpointManager instance persistent checkpoints.
 * Call `enablePersistence(dataDir)` once after construction.
 */
export function mixinCheckpointPersistence(manager, dataDir = './data') {
  const persist = new CheckpointPersistence(dataDir);

  // Override create to also persist
  const origCreate = manager.create.bind(manager);
  manager.create = (opts) => {
    const cp = origCreate(opts);
    persist.saveAll(manager.checkpoints);
    return cp;
  };

  // Override validateAll to persist after validation
  const origValidateAll = manager.validateAll.bind(manager);
  manager.validateAll = (agent_state) => {
    const results = origValidateAll(agent_state);
    persist.saveAll(manager.checkpoints);
    return results;
  };

  // Override list to load from disk if empty
  const origList = manager.list.bind(manager);
  manager.list = () => {
    if (manager.checkpoints.length === 0) {
      const loaded = persist.loadAll();
      if (loaded.length > 0) {
        for (const entry of loaded) {
          manager.checkpoints.push(entry);
        }
      }
    }
    return origList();
  };

  manager.persistCheckpoints = () => persist.saveAll(manager.checkpoints);
  manager.loadCheckpoints = () => {
    const loaded = persist.loadAll();
    manager.checkpoints = loaded;
    return loaded;
  };
  manager.clearPersistedCheckpoints = () => persist.clear();

  return manager;
}
