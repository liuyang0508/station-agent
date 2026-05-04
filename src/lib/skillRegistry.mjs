/**
 * SkillRegistry — GitHub-based skill fetching, parsing, and backup management
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSoulMarkdown, parseAgentMarkdown, parseSkillMarkdown } from './skillFormats.mjs';

export const GITHUB_SOURCES = [
  {
    owner: 'forrestchang',
    repo: 'andrej-karpathy-skills',
    branch: 'main',
    patterns: ['skills/*/SKILL.md', 'CLAUDE.md']
  },
  {
    owner: 'mattpocock',
    repo: 'skills',
    branch: 'main',
    patterns: ['skills/*/*/SKILL.md']
  }
];

const SKILLS_INDEX_PATH = path.join('data', 'skills-index.json');
const BACKUPS_DIR = path.join('data', 'external-skills', 'backups');

export async function fetchRepoContents(owner, repo, pathStr = '', branch = 'main') {
  const encodedPath = pathStr ? `/${encodeURIComponent(pathStr)}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents${encodedPath}?ref=${branch}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'station-agent' }
  });
  if (response.status === 403) {
    const resetHeader = response.headers.get('X-RateLimit-Reset');
    if (resetHeader) {
      const waitSeconds = parseInt(resetHeader) - Math.floor(Date.now() / 1000);
      throw new Error(`GitHub API rate limit exceeded. Retry after ${waitSeconds} seconds.`);
    }
    throw new Error('GitHub API rate limit exceeded.');
  }
  if (response.status === 404) throw new Error(`Repository path not found: ${owner}/${repo}/${pathStr}`);
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  return response.json();
}

export async function fetchFileContent(owner, repo, filePath, branch = 'main') {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'station-agent' }
  });
  if (response.status === 403) throw new Error('GitHub API rate limit exceeded.');
  if (response.status === 404) throw new Error(`File not found: ${owner}/${repo}/${filePath}`);
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  const data = await response.json();
  if (data.encoding === 'base64') {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return data.content;
}

function detectFormatFromFilename(filename) {
  const upper = filename.toUpperCase();
  if (upper === 'SOUL.MD') return 'SOUL.md';
  if (upper === 'AGENT.MD') return 'AGENT.md';
  if (upper === 'MEMORY.MD') return 'MEMORY.md';
  if (upper === 'SKILL.MD') return 'SKILL.md';
  if (upper === 'CLAUDE.MD') return 'CLAUDE.md';
  return null;
}

export function parseSkillFile(content, filename, repo) {
  const format = detectFormatFromFilename(filename) || detectSkillFormatFromContent(content);
  const baseMetadata = { sourceRepo: repo, filename, format, fetchedAt: new Date().toISOString() };
  switch (format) {
    case 'AGENT.md': return { ...parseAgentMarkdown(content), metadata: baseMetadata };
    case 'SOUL.md': return { ...parseSoulMarkdown(content), metadata: baseMetadata };
    case 'SKILL.md':
    case 'CLAUDE.md':
    default: return { ...parseSkillMarkdown(content), metadata: baseMetadata };
  }
}

function detectSkillFormatFromContent(content) {
  if (content.includes('retrieval:') && content.includes('update_policy:')) return 'MEMORY.md';
  if (content.includes('entrypoint:') && content.includes('capabilities:')) return 'AGENT.md';
  if (content.includes('trigger:') && content.includes('evolution:')) return 'SOUL.md';
  return 'SOUL.md';
}

export function backupSkill(skillPath, backupDir) {
  if (!fs.existsSync(skillPath)) throw new Error(`Skill path does not exist: ${skillPath}`);
  const skillName = path.basename(skillPath);
  const today = new Date().toISOString().split('T')[0];
  const backupPath = path.join(backupDir, today, skillName);
  fs.mkdirSync(backupPath, { recursive: true });
  const stat = fs.statSync(skillPath);
  if (stat.isDirectory()) copyDirectory(skillPath, backupPath);
  else fs.copyFileSync(skillPath, backupPath);
  return backupPath;
}

function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirectory(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

export function readSkillsIndex() {
  if (!fs.existsSync(SKILLS_INDEX_PATH)) return { lastFullSync: null, sources: [] };
  try { return JSON.parse(fs.readFileSync(SKILLS_INDEX_PATH, 'utf8')); }
  catch (error) { return { lastFullSync: null, sources: [] }; }
}

export function writeSkillsIndex(index) {
  const dataDir = path.dirname(SKILLS_INDEX_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(SKILLS_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

export function updateSourceInIndex(url, updates) {
  const index = readSkillsIndex();
  const sourceIndex = index.sources.findIndex(s => s.url === url);
  if (sourceIndex >= 0) index.sources[sourceIndex] = { ...index.sources[sourceIndex], ...updates };
  else index.sources.push({ url, ...updates });
  writeSkillsIndex(index);
}

export function getExternalSkillsDir(source) {
  return path.join('data', 'external-skills', `${source.owner}-${source.repo}`);
}

export async function fetchSkillsFromSource(source) {
  const results = [];
  for (const pattern of source.patterns) {
    const pathParts = pattern.split('/');
    if (pathParts.length === 3 && pathParts[1] === '*') {
      // Pattern: skills/*/SKILL.md
      try {
        const contents = await fetchRepoContents(source.owner, source.repo, pathParts[0], source.branch);
        if (Array.isArray(contents)) {
          for (const item of contents) {
            if (item.type === 'dir') {
              try {
                const filePath = `${pathParts[0]}/${item.name}/${pathParts[2]}`;
                const content = await fetchFileContent(source.owner, source.repo, filePath, source.branch);
                const parsed = parseSkillFile(content, pathParts[2], `${source.owner}/${source.repo}`);
                results.push({ skillName: item.name, filePath, content, parsed, sourceRepo: `${source.owner}/${source.repo}` });
              } catch (error) { console.warn(`Skipping ${filePath}: ${error.message}`); }
            }
          }
        }
      } catch (error) { console.warn(`Failed to fetch ${pathParts[0]}: ${error.message}`); }
    } else if (pathParts.length === 4 && pathParts[1] === '*' && pathParts[2] === '*') {
      // Pattern: skills/*/*/SKILL.md (e.g. skills/engineering/diagnose/SKILL.md)
      try {
        const topLevel = await fetchRepoContents(source.owner, source.repo, pathParts[0], source.branch);
        if (Array.isArray(topLevel)) {
          for (const category of topLevel) {
            if (category.type === 'dir') {
              try {
                const secondLevel = await fetchRepoContents(source.owner, source.repo, `${pathParts[0]}/${category.name}`, source.branch);
                if (Array.isArray(secondLevel)) {
                  for (const skillDir of secondLevel) {
                    if (skillDir.type === 'dir') {
                      try {
                        const filePath = `${pathParts[0]}/${category.name}/${skillDir.name}/${pathParts[3]}`;
                        const content = await fetchFileContent(source.owner, source.repo, filePath, source.branch);
                        const parsed = parseSkillFile(content, pathParts[3], `${source.owner}/${source.repo}`);
                        results.push({ skillName: skillDir.name, filePath, content, parsed, sourceRepo: `${source.owner}/${source.repo}` });
                      } catch (error) { console.warn(`Skipping ${filePath}: ${error.message}`); }
                    }
                  }
                }
              } catch (error) { console.warn(`Failed to fetch ${pathParts[0]}/${category.name}: ${error.message}`); }
            }
          }
        }
      } catch (error) { console.warn(`Failed to fetch ${pathParts[0]}: ${error.message}`); }
    } else if (pathParts.length === 1) {
      // Single file in root like "CLAUDE.md"
      try {
        const content = await fetchFileContent(source.owner, source.repo, pathParts[0], source.branch);
        const parsed = parseSkillFile(content, pathParts[0], `${source.owner}/${source.repo}`);
        results.push({ skillName: path.basename(source.repo), filePath: pathParts[0], content, parsed, sourceRepo: `${source.owner}/${source.repo}` });
      } catch (error) { console.warn(`Skipping ${pathParts[0]}: ${error.message}`); }
    }
  }
  return results;
}

export function saveSkillsToLocal(skills, source) {
  const baseDir = getExternalSkillsDir(source);
  const saved = [];
  for (const skill of skills) {
    const skillDir = path.join(baseDir, skill.skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const fileName = path.basename(skill.filePath);
    const filePath = path.join(skillDir, fileName);
    if (fs.existsSync(filePath)) {
      const existingContent = fs.readFileSync(filePath, 'utf8');
      if (existingContent !== skill.content) { backupSkill(filePath, path.join(BACKUPS_DIR)); }
    }
    fs.writeFileSync(filePath, skill.content, 'utf8');
    saved.push({ skillName: skill.skillName, path: filePath, backedUp: false });
  }
  return saved;
}

export async function fullSync() {
  const index = readSkillsIndex();
  index.lastFullSync = new Date().toISOString();
  for (const source of GITHUB_SOURCES) {
    const repoUrl = `https://github.com/${source.owner}/${source.repo}`;
    try {
      await fetchAllSkillsForSource(source);
      updateSourceInIndex(repoUrl, { branch: source.branch, lastSync: new Date().toISOString() });
    } catch (error) { console.error(`Failed to sync ${source.owner}/${source.repo}: ${error.message}`); }
  }
  return readSkillsIndex();
}

async function fetchAllSkillsForSource(source) {
  const skills = await fetchSkillsFromSource(source);
  const saved = saveSkillsToLocal(skills, source);
  console.log(`Synced ${saved.length} skills from ${source.owner}/${source.repo}`);
}
