import { listWorkspaceDirectory, readWorkspaceFile } from '../lib/workspace.mjs';

export function createToolRegistry({ settings }) {
  const tools = new Map();

  tools.set('workspace.list', {
    name: 'workspace.list',
    description: '列出工作区内的目录内容',
    run(args = {}) {
      return listWorkspaceDirectory(settings.workspaceRoot, args.path || '.', args.limit || 30);
    }
  });

  tools.set('workspace.read', {
    name: 'workspace.read',
    description: '读取工作区内的小型文本文件',
    run(args = {}) {
      return readWorkspaceFile(settings.workspaceRoot, args.path, args.maxBytes || 128 * 1024);
    }
  });

  return {
    list() {
      return Array.from(tools.values()).map(({ name, description }) => ({ name, description }));
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
