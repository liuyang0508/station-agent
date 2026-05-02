import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateWorkspacePath } from './safety.mjs';

export class RollbackManager {
  constructor({ store, workspaceRoot, snapshotDir }) {
    this.store = store;
    this.workspaceRoot = workspaceRoot;
    this.snapshotDir = snapshotDir || path.join(workspaceRoot, '.snapshots');
    this._ensureSnapshotDir();
  }

  _ensureSnapshotDir() {
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  async snapshot(targetPath) {
    const validation = validateWorkspacePath(this.workspaceRoot, targetPath);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    const realPath = validation.target;
    if (!fs.existsSync(realPath)) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(realPath);
    const snapshotId = randomUUID();
    const snapshotPath = path.join(this.snapshotDir, snapshotId);

    if (stat.isDirectory()) {
      fs.cpSync(realPath, snapshotPath, { recursive: true });
    } else {
      const destDir = path.dirname(snapshotPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(realPath, snapshotPath);
    }

    return snapshotId;
  }

  record(operationType, target, snapshotId, metadata = {}) {
    const operation = {
      id: randomUUID(),
      type: operationType,
      target,
      snapshotId,
      metadata,
      createdAt: new Date().toISOString(),
      rolledBack: false,
    };

    // Store operation record
    const key = `rollback:${operation.id}`;
    this._saveOperation(operation);
    return operation;
  }

  _saveOperation(operation) {
    // Simple file-based storage for rollback operations
    const opsFile = path.join(this.snapshotDir, 'operations.json');
    let operations = [];
    if (fs.existsSync(opsFile)) {
      try {
        operations = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
      } catch {
        operations = [];
      }
    }
    operations.push(operation);
    fs.writeFileSync(opsFile, JSON.stringify(operations, null, 2));
  }

  _loadOperations() {
    const opsFile = path.join(this.snapshotDir, 'operations.json');
    if (!fs.existsSync(opsFile)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(opsFile, 'utf8'));
    } catch {
      return [];
    }
  }

  async rollback(operationId) {
    const operations = this._loadOperations();
    const operation = operations.find(op => op.id === operationId);

    if (!operation) {
      throw new Error('Operation not found');
    }
    if (operation.rolledBack) {
      throw new Error('Operation already rolled back');
    }

    const snapshotPath = path.join(this.snapshotDir, operation.snapshotId);
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Snapshot not found: ${operation.snapshotId}`);
    }

    const validation = validateWorkspacePath(this.workspaceRoot, operation.target);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

    const targetPath = validation.target;
    const targetExists = fs.existsSync(targetPath);

    if (targetExists) {
      const targetStat = fs.statSync(targetPath);
      if (targetStat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true });
      } else {
        fs.unlinkSync(targetPath);
      }
    }

    const snapshotStat = fs.statSync(snapshotPath);
    if (snapshotStat.isDirectory()) {
      fs.cpSync(snapshotPath, targetPath, { recursive: true });
    } else {
      const destDir = path.dirname(targetPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(snapshotPath, targetPath);
    }

    operation.rolledBack = true;
    operation.rolledBackAt = new Date().toISOString();
    this._saveOperations(operations);

    return { ok: true, operation };
  }

  _saveOperations(operations) {
    const opsFile = path.join(this.snapshotDir, 'operations.json');
    fs.writeFileSync(opsFile, JSON.stringify(operations, null, 2));
  }

  listOperations(targetPath = null) {
    const operations = this._loadOperations();
    if (targetPath) {
      return operations.filter(op => op.target === targetPath && !op.rolledBack);
    }
    return operations.filter(op => !op.rolledBack);
  }
}
