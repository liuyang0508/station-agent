/**
 * RollbackManager - 状态快照和回滚
 */

import { randomUUID } from 'node:crypto';

export class RollbackManager {
  constructor(maxSnapshots = 10) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
  }

  snapshot(state, metadata = {}) {
    const snapshot = {
      id: randomUUID(),
      timestamp: Date.now(),
      state: this._deepClone(state),
      metadata
    };

    this.snapshots.push(snapshot);

    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot.id;
  }

  rollback(snapshotId) {
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (snapshot) {
      return this._deepClone(snapshot.state);
    }
    return null;
  }

  rollbackLast() {
    if (this.snapshots.length > 0) {
      const last = this.snapshots[this.snapshots.length - 1];
      return this._deepClone(last.state);
    }
    return null;
  }

  list() {
    return this.snapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      metadata: s.metadata
    }));
  }

  clear() {
    this.snapshots = [];
  }

  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._deepClone(item));
    }

    const clone = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clone[key] = this._deepClone(obj[key]);
      }
    }
    return clone;
  }
}