import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const CONTENT_LENGTH_HEADER = 'Content-Length: ';
const HEADER_SEPARATOR = '\r\n\r\n';

/**
 * MCP Traffic Logger - captures MCP JSON-RPC messages for debugging
 */
export const mcpTrafficLogger = {
  enabled: false,
  logs: [],

  log(direction, message) {
    if (!this.enabled) return;
    const entry = {
      timestamp: new Date().toISOString(),
      direction, // 'send' or 'recv'
      message
    };
    this.logs.push(entry);
    // Keep last 1000 entries
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
    // Also log to stderr for real-time debugging
    console.error(`[MCP TRAFFIC ${direction.toUpperCase()}]`, JSON.stringify(message).slice(0, 500));
  },

  getLogs() {
    return this.logs;
  },

  clear() {
    this.logs = [];
  }
};

/**
 * MCP Transport for stdio communication
 *
 * MCP protocol uses a simple message framing:
 * 1. Each message is preceded by a Content-Length header
 * 2. Headers are separated from body by \r\n\r\n
 * 3. Body is raw JSON-RPC 2.0
 */
export class McpTransport {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.buffer = '';
    this.messageHandler = null;
    this.pendingRead = null;
    this.closed = false;

    // Set up stdout data handler
    if (this.stdout && typeof this.stdout.on === 'function') {
      this.stdout.on('data', (chunk) => this._handleData(chunk));
      this.stdout.on('end', () => {
        this.closed = true;
        if (this.pendingRead) {
          this.pendingRead.reject(new Error('Transport closed'));
          this.pendingRead = null;
        }
      });
    }
  }

  /**
   * Handle incoming data chunk
   */
  _handleData(chunk) {
    this.buffer += chunk.toString('utf8');
    this._processBuffer();
  }

  /**
   * Process buffer to extract complete messages
   * Supports both MCP Content-Length framing and JSON-Lines format
   */
  _processBuffer() {
    while (this.buffer.length > 0) {
      // Try MCP Content-Length framing first
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd !== -1) {
        const headerStr = this.buffer.slice(0, headerEnd);
        const contentLengthMatch = headerStr.match(/Content-Length: (\d+)/i);

        if (contentLengthMatch) {
          const contentLength = parseInt(contentLengthMatch[1], 10);
          const bodyStart = headerEnd + HEADER_SEPARATOR.length;

          if (this.buffer.length >= bodyStart + contentLength) {
            const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
            this.buffer = this.buffer.slice(bodyStart + contentLength);

            try {
              const message = JSON.parse(body);
              // Log incoming traffic
              mcpTrafficLogger.log('recv', message);
              if (this.messageHandler) {
                this.messageHandler(message);
              }
            } catch (error) {
              console.error('Failed to parse MCP message:', error.message);
            }
            continue;
          }
        }
      }

      // Try JSON-Lines format (newline-delimited JSON)
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);

        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const message = JSON.parse(line);
            // Log incoming traffic
            mcpTrafficLogger.log('recv', message);
            if (this.messageHandler) {
              this.messageHandler(message);
            }
          } catch (error) {
            // Not JSON, skip
          }
        }
        continue;
      }

      // No complete message found, wait for more data
      break;
    }
  }

  /**
   * Send a JSON-RPC message
   * Uses JSON-Lines format (\n terminated) for better compatibility with spawned processes
   */
  send(message) {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

    // Log outgoing traffic
    mcpTrafficLogger.log('send', message);

    const body = JSON.stringify(message) + '\n';

    return new Promise((resolve, reject) => {
      if (this.stdin && typeof this.stdin.write === 'function') {
        const ok = this.stdin.write(body, 'utf8', (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        if (!ok) {
          // Write buffer is full, wait for drain
          this.stdin.once('drain', resolve);
        } else {
          resolve();
        }
      } else {
        reject(new Error('stdin is not writable'));
      }
    });
  }

  /**
   * Send a JSON-RPC message and wait for response
   */
  async sendAndWait(message, timeoutMs = 30000) {
    const id = message.id;
    if (!id) {
      // Notification - no response expected
      await this.send(message);
      return null;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRead = null;
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Temporary handler for this specific response
      const handler = (response) => {
        if (response.id === id) {
          clearTimeout(timer);
          if (this.messageHandler) {
            // Restore original handler
            const original = this.messageHandler;
            this.messageHandler = (msg) => {
              if (msg.id !== id) {
                original(msg);
              }
            };
          }
          resolve(response);
        }
      };

      // Use a composite handler that checks message id
      const originalHandler = this.messageHandler;
      this.messageHandler = (msg) => {
        if (msg.id === id) {
          handler(msg);
        } else if (originalHandler) {
          originalHandler(msg);
        }
      };

      this.send(message).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Receive a single message
   */
  async receive() {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

    return new Promise((resolve, reject) => {
      if (this.pendingRead) {
        reject(new Error('Already waiting for a message'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRead = null;
        reject(new Error('Receive timeout'));
      }, 30000);

      this.pendingRead = {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      // The message will be received via the data handler
      // since we're using buffered reading
    });
  }

  /**
   * Set message handler
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * Close the transport
   */
  close() {
    this.closed = true;
    if (this.stdin && typeof this.stdin.end === 'function') {
      this.stdin.end();
    }
    if (this.stdout && typeof this.stdout.destroy === 'function') {
      this.stdout.destroy();
    }
  }

  /**
   * Check if transport is closed
   */
  isClosed() {
    return this.closed;
  }
}

/**
 * Create a transport from a child process
 */
export function createTransportFromProcess(child) {
  return new McpTransport(child.stdin, child.stdout);
}

/**
 * Serialize a JSON-RPC message with MCP framing
 */
export function serializeMessage(message) {
  const body = JSON.stringify(message);
  const contentLength = Buffer.byteLength(body, 'utf8');
  return `${CONTENT_LENGTH_HEADER}${contentLength}${HEADER_SEPARATOR}${body}`;
}

/**
 * Parse MCP framed message
 */
export function parseMessage(buffer) {
  const str = buffer.toString('utf8');
  const headerEnd = str.indexOf(HEADER_SEPARATOR);

  if (headerEnd === -1) {
    return null;
  }

  const headerStr = str.slice(0, headerEnd);
  const contentLengthMatch = headerStr.match(/Content-Length: (\d+)/i);

  if (!contentLengthMatch) {
    return null;
  }

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const bodyStart = headerEnd + HEADER_SEPARATOR.length;

  if (str.length < bodyStart + contentLength) {
    return null;
  }

  const body = str.slice(bodyStart, bodyStart + contentLength);

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
