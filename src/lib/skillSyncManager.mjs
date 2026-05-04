/**
 * SkillSyncManager — Core engine for GitHub-based skill synchronization
 */

import fs from 'node:fs';
import path from 'node:path';
import { GITHUB_SOURCES, fullSync as fetchAllSkills, getExternalSkillsDir, readSkillsIndex, writeSkillsIndex } from './skillRegistry.mjs';
import { installSkillFromDir } from './skillManager.mjs';

function getSkillDirs(source) {
  const baseDir = getExternalSkillsDir(source);
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory()).map(entry => ({
    name: entry.name,
    path: path.join(baseDir, entry.name)
  }));
}

export class SkillSyncManager {
  constructor({ store, dataDir = 'data' }) {
    this.store = store;
    this.dataDir = dataDir;
    this.externalSkillsDir = path.join(dataDir, 'external-skills');
    this.backupsDir = path.join(dataDir, 'backups');
    this.indexPath = path.join(dataDir, 'skills-index.json');
    this._lastSyncAt = null;
    this._lastSyncResult = null;
    this._syncErrors = [];
  }

  async syncAll() {
    this._syncErrors = [];
    let totalInstalled = 0;
    let totalBackedUp = 0;
    const sourceResults = [];

    try {
      await fetchAllSkills();
    } catch (error) {
      this._syncErrors.push({ source: 'all', error: error.message });
      return this._buildStatus('failed', 0, [], this._syncErrors);
    }

    for (const source of GITHUB_SOURCES) {
      const repoId = `${source.owner}/${source.repo}`;
      const result = await this.syncSource(source);
      sourceResults.push({ repo: repoId, ...result });
      totalInstalled += result.installed.length;
      totalBackedUp += result.backedUp.length;
      this._syncErrors.push(...result.errors.map(e => ({ source: repoId, ...e })));
    }

    this._updateIndexAfterSync(sourceResults);
    this._lastSyncAt = new Date().toISOString();
    this._lastSyncResult = { totalInstalled, totalBackedUp, sources: sourceResults };

    return this._buildStatus('ok', totalInstalled, sourceResults, this._syncErrors);
  }

  async syncSource(source) {
    const repoId = `${source.owner}/${source.repo}`;
    const installed = [];
    const backedUp = [];
    const errors = [];
    const skillDirs = getSkillDirs(source);

    for (const { name: skillName, path: dirPath } of skillDirs) {
      try {
        const existingSkills = this.store.listSkills();
        const existingSkill = existingSkills.find(s => s.source === `external:github/${repoId}/${skillName}`);

        if (existingSkill) {
          const skillFilePath = path.join(dirPath, 'SKILL.md');
          if (fs.existsSync(skillFilePath)) {
            const currentContent = fs.readFileSync(skillFilePath, 'utf8');
            const storedContent = existingSkill.metadata?.body || '';
            if (storedContent && storedContent !== currentContent) {
              backedUp.push({ skillName, reason: 'local modification overwritten' });
            }
          }
        }

        const result = installSkillFromDir({ store: this.store, dirPath, metadata: { repoName: `${repoId}/${skillName}` } });

        if (result.installed.length > 0) {
          installed.push({ skillName, filesInstalled: result.installed.map(s => s.id || skillName) });
        }

        for (const fileError of result.errors) {
          errors.push({ skillName, file: fileError.file, error: fileError.error });
        }
      } catch (error) {
        errors.push({ skillName, error: error.message });
      }
    }

    return { installed, backedUp, errors };
  }

  getStatus() {
    const index = readSkillsIndex();
    return {
      lastSyncAt: this._lastSyncAt || index.lastFullSync || null,
      status: this._lastSyncResult ? 'ok' : 'not_started',
      totalInstalled: this._lastSyncResult?.totalInstalled || 0,
      totalBackedUp: this._lastSyncResult?.totalBackedUp || 0,
      sources: this._lastSyncResult?.sources || [],
      errors: this._syncErrors,
      index
    };
  }

  _updateIndexAfterSync(sourceResults) {
    const index = readSkillsIndex();
    for (const sourceResult of sourceResults) {
      const repoUrl = `https://github.com/${sourceResult.repo}`;
      const sourceIndex = index.sources.findIndex(s => s.url === repoUrl);
      const sourceEntry = { url: repoUrl, lastSync: new Date().toISOString(), skillsInstalled: sourceResult.installed.length, skillsBackedUp: sourceResult.backedUp.length };
      if (sourceIndex >= 0) {
        index.sources[sourceIndex] = { ...index.sources[sourceIndex], ...sourceEntry };
      } else {
        index.sources.push(sourceEntry);
      }
    }
    index.lastFullSync = new Date().toISOString();
    writeSkillsIndex(index);
  }

  _buildStatus(status, totalInstalled, sourceResults, errors) {
    return { status, totalInstalled, totalErrors: errors.length, sourceResults, errors, lastSyncAt: this._lastSyncAt };
  }
}

export function createSkillSyncManager({ store, dataDir = 'data' }) {
  return new SkillSyncManager({ store, dataDir });
}
