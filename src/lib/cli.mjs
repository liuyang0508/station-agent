/**
 * CLI — Unix 管道风格的命令行接口
 *
 * 用法:
 *   echo "任务描述" | station-agent --cli
 *   cat file.txt | station-agent --cli -p "分析这个文件"
 *   station-agent --cli -p "解释: $(cat context.txt)"
 */

import { createAgentRuntime } from '../runtime/agentRuntime.mjs';
import { JsonStore } from './store.mjs';

const DEFAULT_TIMEOUT_MS = 120000;

export class CLI {
  constructor({ store, settings }) {
    this.store = store;
    this.settings = settings;
  }

  /**
   * 从 stdin 读取输入
   */
  async readStdin() {
    return new Promise((resolve, reject) => {
      const chunks = [];
      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (chunk) => {
        if (process.stdout.isTTY) {
          // 非管道模式，不读取 stdin
          return;
        }
        chunks.push(chunk);
      });

      process.stdin.on('end', () => {
        resolve(chunks.join(''));
      });

      process.stdin.on('error', reject);

      // 设置超时
      setTimeout(() => {
        if (chunks.length === 0) {
          resolve('');
        }
      }, 100);
    });
  }

  /**
   * 执行单次 CLI 对话
   */
  async run(prompt, options = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, streaming = true } = options;

    const runtime = createAgentRuntime(this.settings, {
      skills: this.store.listSkills(),
      memories: this.store.listMemories(),
      tools: null,  // CLI 模式下暂不支持工具
      mcpTools: []
    });

    const timeout = setTimeout(() => {
      console.error('[CLI] Timeout reached');
      process.exit(124);  // 标准 timeout 退出码
    }, timeoutMs);

    try {
      const events = runtime.runTurn(prompt, {
        session: { id: 'cli-session' },
        history: [],
        settings: this.settings,
        skills: this.store.listSkills(),
        memories: this.store.listMemories(),
        connectors: this.store.listConnectors(),
        autonomousLoop: false
      });

      let finalOutput = '';

      for await (const event of events) {
        switch (event.type) {
          case 'trace':
            if (streaming) {
              console.error(`[${event.title}] ${event.detail}`);
            }
            break;

          case 'thinking':
            if (streaming) {
              process.stderr.write(`\r[思考] ${event.detail.slice(0, 100)}`);
            }
            break;

          case 'assistant.delta':
            finalOutput += event.delta;
            if (streaming) {
              process.stdout.write(event.delta);
            }
            break;

          case 'tool':
            if (streaming) {
              console.error(`\n[工具] ${event.tool} - ${event.status}: ${event.detail}`);
            }
            break;

          case 'done':
            if (streaming) {
              process.stderr.write('\n');
              console.error(`[完成] ${event.detail}`);
            }
            break;
        }
      }

      clearTimeout(timeout);
      return finalOutput;
    } catch (error) {
      clearTimeout(timeout);
      console.error(`[CLI Error] ${error.message}`);
      throw error;
    }
  }

  /**
   * 交互式 CLI 模式
   */
  async interactive() {
    const readline = await import('readline');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'station-agent> '
    });

    console.log('=== Station Agent CLI ===');
    console.log('输入任务描述，或按 Ctrl+C 退出。\n');

    rl.prompt();

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        return;
      }

      try {
        await this.run(trimmed);
      } catch (error) {
        console.error(`错误: ${error.message}`);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n再见!');
      process.exit(0);
    });
  }
}

/**
 * 从环境变量加载 CLI 配置
 */
export function createCliFromEnv() {
  const store = new JsonStore();
  const settings = store.getSettings();

  return new CLI({ store, settings });
}

/**
 * CLI 主入口
 */
export async function cliMain() {
  const args = process.argv.slice(2);

  // 解析 CLI 参数
  const cliOptions = {
    prompt: null,
    interactive: false,
    timeout: DEFAULT_TIMEOUT_MS,
    streaming: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--prompt') {
      cliOptions.prompt = args[++i] || '';
    } else if (arg === '-i' || arg === '--interactive') {
      cliOptions.interactive = true;
    } else if (arg === '-t' || arg === '--timeout') {
      cliOptions.timeout = Number(args[++i]) * 1000;
    } else if (arg === '--no-stream') {
      cliOptions.streaming = false;
    }
  }

  // 从 stdin 读取（如果没有通过 -p 指定）
  let input = cliOptions.prompt;
  if (!input) {
    // 检查是否有管道输入
    if (!process.stdin.isTTY) {
      input = await new Promise((resolve) => {
        const chunks = [];
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(chunks.join('')));
      });
    }
  }

  if (!input || input.trim() === '') {
    // 进入交互模式
    cliOptions.interactive = true;
  }

  const cli = createCliFromEnv();

  if (cliOptions.interactive || !input) {
    await cli.interactive();
  } else {
    await cli.run(input, {
      timeoutMs: cliOptions.timeout,
      streaming: cliOptions.streaming
    });
  }
}
