import fs from 'node:fs';
import path from 'node:path';
import { validateWorkspacePath, normalizeWorkspaceRoot } from '../lib/safety.mjs';
import { listWorkspaceDirectory, readWorkspaceFile } from '../lib/workspace.mjs';

function resolveWriteTarget(workspaceRoot, relativePath) {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  const target = path.resolve(normalized, relativePath || '.');
  const validation = validateWorkspacePath(normalized, target);
  if (!validation.allowed) {
    const error = new Error(validation.reason || 'Path is outside workspace');
    error.statusCode = 403;
    throw error;
  }
  return { workspaceRoot: normalized, target: validation.target, relativePath };
}

function safeReadFile(workspaceRoot, relativePath, maxBytes = 512 * 1024) {
  const resolved = resolveWriteTarget(workspaceRoot, relativePath);
  const stat = fs.statSync(resolved.target);
  if (!stat.isFile()) {
    const error = new Error('Path is not a file');
    error.statusCode = 400;
    throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error(`File is larger than ${Math.round(maxBytes / 1024)}KB preview limit`);
    error.statusCode = 413;
    throw error;
  }
  return {
    workspaceRoot: resolved.workspaceRoot,
    path: resolved.relativePath,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    content: fs.readFileSync(resolved.target, 'utf8')
  };
}

// Singleton Python sidecar instance - set via setPythonSidecar()
let _pythonSidecar = null;

export function setPythonSidecar(sidecar) {
  _pythonSidecar = sidecar;
}

export function createToolRegistry({ settings, mcpTools = [], skills = [] }) {
  const tools = new Map();

  tools.set('workspace.list', {
    name: 'workspace.list',
    description: '列出工作区内的目录内容',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，默认 "."' },
        limit: { type: 'number', description: '最大条目数，默认 300' }
      }
    },
    run(args = {}) {
      return listWorkspaceDirectory(settings.workspaceRoot, args.path || '.', args.limit || 300);
    }
  });

  tools.set('workspace.read', {
    name: 'workspace.read',
    description: '读取工作区内的小型文本文件',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必需）' },
        maxBytes: { type: 'number', description: '最大字节数，默认 512KB' }
      },
      required: ['path']
    },
    run(args = {}) {
      return safeReadFile(settings.workspaceRoot, args.path, args.maxBytes || 512 * 1024);
    }
  });

  tools.set('workspace.write', {
    name: 'workspace.write',
    description: '创建或覆盖工作区内的文本文件',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必需）' },
        content: { type: 'string', description: '文件内容（必需）' }
      },
      required: ['path', 'content']
    },
    run(args = {}) {
      const resolved = resolveWriteTarget(settings.workspaceRoot, args.path);
      const dir = path.dirname(resolved.target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved.target, args.content, 'utf8');
      const stat = fs.statSync(resolved.target);
      return {
        ok: true,
        path: resolved.relativePath,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    }
  });

  tools.set('workspace.edit', {
    name: 'workspace.edit',
    description: '对工作区内的文本文件进行精确行编辑（替换指定行范围的内容）',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必需）' },
        oldText: { type: 'string', description: '要替换的原始文本片段（必需，必须精确匹配）' },
        newText: { type: 'string', description: '要替换成的新文本（必需）' }
      },
      required: ['path', 'oldText', 'newText']
    },
    run(args = {}) {
      const resolved = resolveWriteTarget(settings.workspaceRoot, args.path);
      const content = fs.readFileSync(resolved.target, 'utf8');
      const oldText = args.oldText;
      const newText = args.newText;

      if (!content.includes(oldText)) {
        throw new Error(`oldText not found in file: no match for "${oldText.slice(0, 50)}..."`);
      }

      const updated = content.split(oldText).join(newText);
      fs.writeFileSync(resolved.target, updated, 'utf8');
      const stat = fs.statSync(resolved.target);
      return {
        ok: true,
        path: resolved.relativePath,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    }
  });

  tools.set('workspace.create', {
    name: 'workspace.create',
    description: '在工作区内创建新目录',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（必需）' }
      },
      required: ['path']
    },
    run(args = {}) {
      const resolved = resolveWriteTarget(settings.workspaceRoot, args.path);
      fs.mkdirSync(resolved.target, { recursive: true });
      return { ok: true, path: resolved.relativePath };
    }
  });

  tools.set('workspace.delete', {
    name: 'workspace.delete',
    description: '删除工作区内的文件或空目录',
    params: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径（必需）' }
      },
      required: ['path']
    },
    run(args = {}) {
      const resolved = resolveWriteTarget(settings.workspaceRoot, args.path);
      const stat = fs.statSync(resolved.target);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved.target);
        if (entries.length > 0) {
          throw new Error('Cannot delete non-empty directory');
        }
        fs.rmdirSync(resolved.target);
      } else {
        fs.unlinkSync(resolved.target);
      }
      return { ok: true, path: resolved.relativePath };
    }
  });

  tools.set('workspace.glob', {
    name: 'workspace.glob',
    description: '在工作区内按模式搜索文件（如 **\/*.js, src\/**\/*.ts）',
    params: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式（必需）' },
        base: { type: 'string', description: '搜索根路径，默认 "."' }
      },
      required: ['pattern']
    },
    run(args = {}) {
      const { pattern, base = '.' } = args;
      const resolved = resolveWriteTarget(settings.workspaceRoot, base);
      const results = globWalk(resolved.target, pattern);
      return { matches: results, base: resolved.relativePath };
    }
  });

  // Register MCP tools
  for (const tool of mcpTools) {
    if (!tools.has(tool.name)) {
      tools.set(tool.name, {
        name: tool.name,
        description: tool.description || 'MCP tool',
        params: { type: 'object', properties: {} },
        run: () => ({ error: 'MCP tool must be called via MCP manager' })
      });
    }
  }

  // Register skills as tools
  for (const skill of skills) {
    if (!tools.has(skill.name)) {
      const isExecutable = !!(skill.entrypoint || skill.command);
      tools.set(skill.name, {
        name: skill.name,
        description: skill.description || `Skill: ${skill.name}`,
        params: {
          type: 'object',
          properties: {
            context: { type: 'object', description: 'Execution context for the skill' }
          }
        },
        async run(args = {}) {
          // Try Python sidecar first for executable skills
          if (_pythonSidecar && isExecutable) {
            try {
              const result = await _pythonSidecar.skillRun(skill.name, args.context || {});
              return result;
            } catch (e) {
              return { error: `Python sidecar error: ${e.message}` };
            }
          }
          if (!isExecutable) {
            return { description: skill.description, guidelines: 'This skill provides guidelines. Reference it in your work but do not call it as a tool.' };
          }
          return { error: `Skill "${skill.name}" execution unavailable. Python sidecar not connected.` };
        },
        _skill: skill
      });
    }
  }

  return {
    list() {
      return Array.from(tools.values()).map(({ name, description, params }) => ({
        name,
        description,
        ...(params ? { parameters: params } : {})
      }));
    },
    has(name) {
      return tools.has(name);
    },
    run(name, args) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool.run(args);
    }
  };
}

function globWalk(rootDir, pattern) {
  const results = [];
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const parts = normalizedPattern.split('/');
  const isRecursive = parts.includes('**');

  if (isRecursive) {
    const recurseIndex = parts.indexOf('**');
    const prefix = parts.slice(0, recurseIndex).join('/');
    const suffix = parts.slice(recurseIndex + 1).join('/');
    const searchRoot = prefix ? path.join(rootDir, prefix) : rootDir;
    recurseDir(searchRoot, suffix, results);
  } else {
    walkDir(rootDir, parts, results, 0);
  }
  return results;
}

function recurseDir(dir, suffixPattern, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      recurseDir(fullPath, suffixPattern, results);
      if (matchesPattern(entry.name, suffixPattern)) {
        results.push(fullPath);
      }
    } else if (entry.isFile() && matchesPattern(entry.name, suffixPattern)) {
      results.push(fullPath);
    }
  }
}

function walkDir(dir, patternParts, results, index) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const currentPattern = patternParts[index];
  const isLast = index === patternParts.length - 1;

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!isLast && matchesPattern(entry.name, currentPattern)) {
        walkDir(fullPath, patternParts, results, index + 1);
      } else if (isLast && (currentPattern === '*' || currentPattern === '**')) {
        results.push(fullPath);
      }
    } else if (entry.isFile()) {
      if (isLast && matchesPattern(entry.name, currentPattern)) {
        results.push(fullPath);
      }
    }
  }
}

function matchesPattern(name, pattern) {
  if (pattern === '*') return true;
  if (pattern === '**') return true;
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(name);
}
