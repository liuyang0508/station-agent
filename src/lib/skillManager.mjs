import fs from 'node:fs';
import path from 'node:path';
import { runReadOnlyCommand } from './commandRunner.mjs';
import { validateWorkspacePath } from './safety.mjs';
import { SandboxExecutor } from '../runtime/sandboxExecutor.mjs';

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

  if (!skill.command && !skill.entrypoint) {
    const output = [
      `技能 ${skill.name} 已完成一次本地编排检查。`,
      `入口: ${skill.entrypoint || '未配置'}`,
      `输入: ${JSON.stringify(input)}`
    ].join('\n');
    return store.recordSkillRun({ skillId, status: 'completed', input, output });
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
    return store.recordSkillRun({
      skillId,
      status: result.ok ? 'completed' : 'failed',
      input,
      output: result.stdout,
      error: result.stderr || (result.ok ? '' : result.error)
    });
  }

  // Shell command fallback
  const command = [skill.command, ...(skill.args || [])].join(' ');
  const result = await runReadOnlyCommand({
    command,
    cwd: skill.metadata?.root || settings.workspaceRoot,
    workspaceRoot: settings.workspaceRoot,
    timeoutMs: 15000
  });
  return store.recordSkillRun({
    skillId,
    status: result.ok ? 'completed' : 'failed',
    input,
    output: result.stdout,
    error: result.stderr || (result.ok ? '' : `exit ${result.exitCode}`)
  });
}
