import { randomUUID } from 'node:crypto';

const JSONRPC_VERSION = '2.0';

// MCP protocol methods
const METHODS = {
  INITIALIZE: 'initialize',
  INITIALIZED: 'initialized',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
};

export class McpProtocol {
  constructor() {
    this.pendingRequests = new Map();
    this.initialized = false;
    this.serverInfo = null;
    this.tools = [];
  }

  // Build JSON-RPC 2.0 request
  buildRequest(method, params = {}) {
    const id = randomUUID();
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params,
    };
  }

  // Build JSON-RPC 2.0 response
  buildResponse(id, result) {
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      result,
    };
  }

  // Build JSON-RPC 2.0 error
  buildError(id, code, message, data = null) {
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      error: {
        code,
        message,
        data,
      },
    };
  }

  // Parse incoming JSON-RPC message
  parseMessage(message) {
    if (!message || typeof message !== 'object') {
      return { type: 'invalid', error: 'Invalid message format' };
    }

    if (message.jsonrpc !== JSONRPC_VERSION) {
      return { type: 'invalid', error: `Invalid JSON-RPC version: ${message.jsonrpc}` };
    }

    if (message.method) {
      // Request or notification
      return {
        type: message.id ? 'request' : 'notification',
        id: message.id,
        method: message.method,
        params: message.params || {},
      };
    }

    if (message.result !== undefined || message.error) {
      // Response
      return {
        type: 'response',
        id: message.id,
        result: message.result,
        error: message.error,
      };
    }

    return { type: 'invalid', error: 'Unknown message type' };
  }

  // Handle incoming message and return response if needed
  async handleMessage(message) {
    const parsed = this.parseMessage(message);

    if (parsed.type === 'invalid') {
      return this.buildError(null, -32600, 'Invalid Request');
    }

    if (parsed.type === 'response') {
      // Resolve pending request
      const resolve = this.pendingRequests.get(parsed.id);
      if (resolve) {
        this.pendingRequests.delete(parsed.id);
        if (parsed.error) {
          resolve.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
        } else {
          resolve.resolve(parsed.result);
        }
      }
      return null;
    }

    if (parsed.type === 'request') {
      return this.handleRequest(parsed);
    }

    return null;
  }

  // Handle incoming request
  async handleRequest(request) {
    switch (request.method) {
      case METHODS.INITIALIZE:
        return this.handleInitialize(request);

      case METHODS.TOOLS_LIST:
        return this.handleToolsList(request);

      case METHODS.TOOLS_CALL:
        return this.handleToolsCall(request);

      default:
        return this.buildError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  // Initialize handshake - step 1
  async handleInitialize(request) {
    const { protocolVersion, clientInfo, capabilities } = request.params;

    this.serverInfo = {
      protocolVersion,
      clientInfo,
      capabilities,
    };

    // MCP server capabilities
    const serverCapabilities = {
      tools: {
        listChanged: true,
      },
    };

    this.initialized = true;

    return this.buildResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: serverCapabilities,
      serverInfo: {
        name: 'AIAgent-MCP',
        version: '0.2.0',
      },
    });
  }

  // Initialize handshake - step 2 (notification after initialize)
  async handleInitialized(request) {
    // Client is telling us it's ready
    this.initialized = true;
    return null; // No response for notifications
  }

  // Handle tools/list request
  async handleToolsList(request) {
    return this.buildResponse(request.id, {
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      })),
    });
  }

  // Handle tools/call request
  async handleToolsCall(request) {
    const { name, arguments: args } = request.params;
    const tool = this.tools.find((t) => t.name === name);

    if (!tool) {
      return this.buildError(request.id, -32602, `Tool not found: ${name}`);
    }

    try {
      const result = await tool.handler(args || {});
      return this.buildResponse(request.id, {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
        isError: false,
      });
    } catch (error) {
      return this.buildResponse(request.id, {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      });
    }
  }

  // Register tools from MCP server
  setTools(tools) {
    this.tools = tools;
  }

  // Add a single tool
  addTool(tool) {
    this.tools.push(tool);
  }

  // Check if initialized
  isInitialized() {
    return this.initialized;
  }

  // Wait for a response to a request
  waitForResponse(id, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  // Create protocol messages for handshake
  createInitializeRequest(clientInfo = {}) {
    return this.buildRequest(METHODS.INITIALIZE, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: clientInfo.name || 'AIAgent Client',
        version: clientInfo.version || '0.1.0',
      },
    });
  }

  // Create tools/list request
  createToolsListRequest() {
    return this.buildRequest(METHODS.TOOLS_LIST);
  }

  // Create tools/call request
  createToolsCallRequest(toolName, args = {}) {
    return this.buildRequest(METHODS.TOOLS_CALL, {
      name: toolName,
      arguments: args,
    });
  }
}

export { METHODS };
