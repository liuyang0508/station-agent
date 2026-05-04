/**
 * Python Agent Bridge - IPC between JS and Python Agent
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class PythonBridge {
  constructor({ pythonPath = 'python3', scriptPath = './python/agent_core/ipc.py', timeoutMs = 60000 } = {}) {
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
    this._process = null;
    this._pending = new Map();
    this._idCounter = 0;
  }

  _ensureProcess() {
    if (!this._process) {
      this._process = spawn(this.pythonPath, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this._process.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            const pending = this._pending.get(response.id);
            if (pending) {
              this._pending.delete(response.id);
              if (response.error) {
                pending.reject(new Error(response.error));
              } else {
                pending.resolve(response.result);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });

      this._process.stderr.on('data', (chunk) => {
        console.error('[PythonBridge stderr]', chunk.toString());
      });

      this._process.on('error', (err) => {
        console.error('[PythonBridge process error]', err);
        this._process = null;
      });

      this._process.on('close', (code) => {
        console.log('[PythonBridge exited with code]', code);
        this._process = null;
      });
    }
    return this._process;
  }

  async _send(method, params = {}) {
    const id = ++this._idCounter;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, this.timeoutMs);

      this._pending.set(id, { resolve, reject, timeout });

      this._ensureProcess();
      this._process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async run(input, context = {}) {
    return this._send('run', { input, context });
  }

  async *runStreaming(input, context = {}) {
    const result = await this._send('run_streaming', { input, context });
    for (const chunk of result.chunks || []) {
      yield chunk;
    }
  }

  async executeTool(name, args = {}) {
    return this._send('tool_call', { name, args });
  }

  async storeMemory(params) {
    return this._send('memory_store', params);
  }

  async searchMemory(params) {
    return this._send('memory_search', params);
  }

  destroy() {
    if (this._process) {
      this._process.stdin.end();
      this._process.kill();
      this._process = null;
    }
  }
}
