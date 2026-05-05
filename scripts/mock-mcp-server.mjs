#!/usr/bin/env node
/**
 * Mock MCP Server for Testing
 *
 * A simple MCP server that responds to protocol messages with test data.
 * Supports the MCP stdio protocol with JSON-RPC 2.0 messages.
 *
 * Usage:
 *   node mock-mcp-server.mjs [--debug]
 */

import { readFileSync } from 'node:fs';

// Parse command line args
const debug = process.argv.includes('--debug');

// Mock tools registry
const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input arguments',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo back' }
      }
    },
    handler: (args) => ({ echoed: args.message, timestamp: new Date().toISOString() })
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' }
      },
      required: ['a', 'b']
    },
    handler: (args) => ({ result: args.a + args.b })
  },
  {
    name: 'get_time',
    description: 'Get current server time',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ time: new Date().toISOString(), uptime: process.uptime() })
  },
  {
    name: 'list_files',
    description: 'List files in a directory (mock)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' }
      }
    },
    handler: (args) => ({
      path: args.path || '.',
      files: [
        { name: 'file1.txt', size: 1024, type: 'file' },
        { name: 'file2.txt', size: 2048, type: 'file' },
        { name: 'subdir', type: 'directory' }
      ]
    })
  },
  {
    name: 'get_env',
    description: 'Get environment variables (mock)',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({
      NODE_ENV: 'test',
      MOCK_SERVER: 'true',
      PATH: '/usr/bin:/bin'
    })
  }
];

// MCP Protocol helpers
let messageId = 0;
function newId() {
  return `mock-${++messageId}-${Date.now()}`;
}

function parseMessage(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function sendMessage(msg) {
  const line = JSON.stringify(msg);
  if (debug) console.error('[MOCK DEBUG] SENT:', line);
  process.stdout.write(line + '\n');
}

// Process messages from stdin
let buffer = '';
let initialized = false;

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();

  // Process complete lines
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    if (debug) console.error('[MOCK DEBUG] RECV:', line);

    const msg = parseMessage(line);
    if (!msg) continue;

    handleMessage(msg);
  }
});

function handleMessage(msg) {
  const { id, method, params } = msg;

  // Handle notifications (no id)
  if (!id) {
    if (method === 'initialized') {
      initialized = true;
      if (debug) console.error('[MOCK] Client initialized notification received');
    }
    return;
  }

  // JSON-RPC 2.0 request
  if (msg.jsonrpc !== '2.0') {
    sendMessage({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }

  switch (method) {
    case 'initialize':
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: {
            name: 'Mock MCP Server',
            version: '1.0.0'
          }
        }
      });
      break;

    case 'tools/list':
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        }
      });
      break;

    case 'tools/call':
      const { name, arguments: args = {} } = params || {};
      const tool = TOOLS.find(t => t.name === name);

      if (!tool) {
        sendMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Tool not found: ${name}` }
        });
        break;
      }

      try {
        const result = tool.handler(args);
        sendMessage({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
              }
            ],
            isError: false
          }
        });
      } catch (error) {
        sendMessage({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          }
        });
      }
      break;

    default:
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
  }
}

// Handle stdin close
process.stdin.on('end', () => {
  if (debug) console.error('[MOCK] stdin closed, exiting');
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (err) => {
  console.error('[MOCK ERROR]', err.message);
  process.exit(1);
});

if (debug) {
  console.error('[MOCK] Mock MCP Server starting in debug mode...');
  console.error('[MOCK] Available tools:', TOOLS.map(t => t.name).join(', '));
}
