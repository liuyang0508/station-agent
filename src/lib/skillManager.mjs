import fs from 'node:fs';
import path from 'node:path';
import { runReadOnlyCommand } from './commandRunner.mjs';
import { validateWorkspacePath } from './safety.mjs';
import { SandboxExecutor } from '../runtime/sandboxExecutor.mjs';
import {
  parseSoulMarkdown,
  parseAgentMarkdown,
  parseSkillMarkdown,
  detectSkillFormat
} from './skillFormats.mjs';
import { createSkillEvolution } from './skillEvolution.mjs';
import { SkillCache } from './skillCache.mjs';

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function inferFromMarkdown(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const firstHeading = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .find((line) => line.trim().startsWith('# '));
  return firstHeading ? { name: firstHeading.replace(/^#\s+/, '').trim() } : {};
}

function firstExisting(root, candidates) {
  return candidates.map((candidate) => path.join(root, candidate)).find((candidate) => fs.existsSync(candidate)) || '';
}

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentValue = null;

  for (const line of lines) {
    const keyMatch = line.match(/^(\w+(?:_\w+)*):\s*/);
    if (keyMatch) {
      if (currentKey) frontmatter[currentKey] = currentValue;
      currentKey = keyMatch[1];
      currentValue = line.slice(keyMatch[0].length).trim();
    } else if (line.match(/^\s+-/) && currentKey) {
      const value = line.replace(/^\s+-\s*/, '').trim();
      if (Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey].push(value);
      } else {
        frontmatter[currentKey] = [value];
      }
    }
  }
  if (currentKey) frontmatter[currentKey] = currentValue;

  return {
    frontmatter,
    body: content.slice(match[0].length).trim()
  };
}

function now() {
  return new Date().toISOString();
}

function extractSkillFromFile(filePath, repoName = '', relativePath = '') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const format = detectSkillFormat(content);

  let parsed;
  switch (format) {
    case 'SOUL.md':
      parsed = parseSoulMarkdown(content);
      break;
    case 'AGENT.md':
      parsed = parseAgentMarkdown(content);
      break;
    case 'MEMORY.md':
      parsed = parseSkillMarkdown(content);
      break;
    default:
      parsed = parseSkillMarkdown(content);
  }

  const { frontmatter, body } = parseYamlFrontmatter(content);

  return {
    name: frontmatter.name || parsed.name || path.basename(filePath, path.extname(filePath)),
    description: frontmatter.description || parsed.description || body.slice(0, 200),
    source: frontmatter.source || `external:github/${repoName}`,
    entrypoint: frontmatter.entrypoint || parsed.entrypoint || '',
    command: frontmatter.command || '',
    args: frontmatter.args || [],
    metadata: {
      format,
      repo: repoName,
      repoPath: relativePath,
      body,
      frontmatter,
      syncedAt: now()
    },
    enabled: true
  };
}

export function installSkillFromFile({ store, skillPath, metadata = {} }) {
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }

  const repoName = metadata.repoName || '';
  const relativePath = metadata.relativePath || path.basename(skillPath);

  const skillData = extractSkillFromFile(skillPath, repoName, relativePath);

  // Check if skill with same source + name already exists, update if so
  const existingSkills = store.listSkills();
  const existing = existingSkills.find(
    (s) => s.source === skillData.source && s.name === skillData.name
  );

  if (existing) {
    const updated = store.updateSkill(existing.id, {
      description: skillData.description,
      entrypoint: skillData.entrypoint,
      command: skillData.command,
      args: skillData.args,
      metadata: { ...existing.metadata, ...skillData.metadata }
    });
    // Cache to SQLite
    if (store.cacheSkill) {
      store.cacheSkill(updated);
    }
    return updated;
  }

  const skill = store.installSkill(skillData);
  // Cache to SQLite
  if (store.cacheSkill) {
    store.cacheSkill(skill);
  }
  return skill;
}

export function installSkillFromDir({ store, dirPath, metadata = {} }) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Skill directory not found: ${dirPath}`);
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Expected directory path: ${dirPath}`);
  }

  const repoName = metadata.repoName || path.basename(dirPath);

  const skillFiles = [
    { name: 'SKILL.md', format: 'SKILL.md' },
    { name: 'SOUL.md', format: 'SOUL.md' },
    { name: 'AGENT.md', format: 'AGENT.md' },
    { name: 'MEMORY.md', format: 'MEMORY.md' },
    { name: 'CLAUDE.md', format: 'CLAUDE.md' }
  ];

  const installed = [];
  const errors = [];

  for (const { name: fileName } of skillFiles) {
    const filePath = path.join(dirPath, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const skill = installSkillFromFile({
          store,
          skillPath: filePath,
          metadata: {
            repoName,
            relativePath: fileName
          }
        });
        // Cache to SQLite
        if (store.cacheSkill) {
          store.cacheSkill(skill);
        }
        installed.push(skill);
      } catch (err) {
        errors.push({ file: fileName, error: err.message });
      }
    }
  }

  return { installed, errors };
}

export function installSkillFromWorkspace({ store, settings, payload }) {
  const rawPath = String(payload.path || '').trim();
  if (!rawPath) {
    return store.installSkill(payload);
  }
  const requestedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(settings.workspaceRoot, rawPath);
  const validation = validateWorkspacePath(settings.workspaceRoot, requestedPath);
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }
  const stat = fs.statSync(validation.target);
  const skillRoot = stat.isDirectory() ? validation.target : path.dirname(validation.target);
  const skillJson = readJsonIfExists(path.join(skillRoot, 'skill.json'));
  const packageJson = readJsonIfExists(path.join(skillRoot, 'package.json'));

  // Check for skill format files (SOUL.md, AGENT.md, MEMORY.md)
  const soulMd = readTextIfExists(path.join(skillRoot, 'SOUL.md'));
  const agentMd = readTextIfExists(path.join(skillRoot, 'AGENT.md'));
  const memoryMd = readTextIfExists(path.join(skillRoot, 'MEMORY.md'));
  const markdown = inferFromMarkdown(path.join(skillRoot, 'SKILL.md'));

  // Detect skill format and parse
  let skillFormat = null;
  let formatMetadata = {};
  if (soulMd) {
    skillFormat = 'SOUL.md';
  } else if (agentMd) {
    skillFormat = 'AGENT.md';
  } else if (memoryMd) {
    skillFormat = 'MEMORY.md';
  }

  const entrypoint = payload.entrypoint
    ? path.resolve(skillRoot, payload.entrypoint)
    : firstExisting(skillRoot, ['skill.mjs', 'index.mjs', 'main.mjs', 'skill.py', 'main.py']);
  if (entrypoint) {
    const entrypointValidation = validateWorkspacePath(settings.workspaceRoot, entrypoint);
    if (!entrypointValidation.allowed) {
      throw new Error(entrypointValidation.reason);
    }
  }

  return store.installSkill({
    name: payload.name || skillJson?.name || packageJson?.name || markdown.name || path.basename(skillRoot),
    description:
      payload.description ||
      skillJson?.description ||
      packageJson?.description ||
      '从工作区安装的本地技能',
    source: payload.source || skillRoot,
    entrypoint,
    command: payload.command || '',
    args: payload.args || [],
    metadata: {
      root: skillRoot,
      manifest: skillJson ? 'skill.json' : packageJson ? 'package.json' : markdown.name ? 'SKILL.md' : 'inferred',
      format: skillFormat,
      evolution: {
        enabled: true,
        triggers: [
          { type: 'repeated_failure', threshold: 2 },
          { type: 'repeated_success', threshold: 5 }
        ]
      }
    }
  });
}

export async function runSkill({ store, settings, skillId, input = {} }) {
  const skill = store.listSkills().find((item) => item.id === skillId);
  if (!skill) {
    throw new Error('技能不存在');
  }
  if (!skill.enabled) {
    throw new Error('技能未启用');
  }

  // Ensure skill is cached
  const skillCache = new SkillCache(store);
  await skillCache.getSkill(skillId);

  const skillEvolution = createSkillEvolution(store);

  if (!skill.command && !skill.entrypoint) {
    const output = [
      `技能 ${skill.name} 已完成一次本地编排检查。`,
      `入口: ${skill.entrypoint || '未配置'}`,
      `输入: ${JSON.stringify(input)}`
    ].join('\n');
    const runRecord = store.recordSkillRun({ skillId, status: 'completed', input, output });
    // Trigger evolution evaluation (async, non-blocking)
    const evolution = skillEvolution.evaluate(runRecord, { context: {} });
    if (evolution) {
      skillEvolution.evolve(skillId, evolution).catch(err => {
        console.error('Evolution failed:', err);
      });
    }
    return runRecord;
  }

  // Sandbox execution for JS/Python scripts
  const executor = new SandboxExecutor({ timeoutMs: 30000 });
  const ext = skill.entrypoint ? path.extname(skill.entrypoint) : '';
  const language = ext === '.py' ? 'python' : ext === '.mjs' || ext === '.js' ? 'javascript' : null;

  if (language) {
    const code = fs.readFileSync(skill.entrypoint, 'utf8');
    const sandboxContext = {
      input: JSON.stringify(input),
      workspaceRoot: settings.workspaceRoot,
      skillName: skill.name
    };
    const result = await executor.execute(code, language, sandboxContext);
    const runRecord = store.recordSkillRun({
      skillId,
      status: result.ok ? 'completed' : 'failed',
      input,
      output: result.stdout,
      error: result.stderr || (result.ok ? '' : result.error)
    });
    // Trigger evolution evaluation (async, non-blocking)
    const evolution = skillEvolution.evaluate(runRecord, { context: {} });
    if (evolution) {
      skillEvolution.evolve(skillId, evolution).catch(err => {
        console.error('Evolution failed:', err);
      });
    }
    return runRecord;
  }

  // Shell command fallback
  const command = [skill.command, ...(skill.args || [])].join(' ');
  const result = await runReadOnlyCommand({
    command,
    cwd: skill.metadata?.root || settings.workspaceRoot,
    workspaceRoot: settings.workspaceRoot,
    timeoutMs: 15000
  });
  const runRecord = store.recordSkillRun({
    skillId,
    status: result.ok ? 'completed' : 'failed',
    input,
    output: result.stdout,
    error: result.stderr || (result.ok ? '' : `exit ${result.exitCode}`)
  });
  // Trigger evolution evaluation (async, non-blocking)
  const evolution = skillEvolution.evaluate(runRecord, { context: {} });
  if (evolution) {
    skillEvolution.evolve(skillId, evolution).catch(err => {
      console.error('Evolution failed:', err);
    });
  }
  return runRecord;
}
