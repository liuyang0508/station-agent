// Python Agent Core sidecar manager for Node.js.

// Spawns and communicates with the Python Agent Core sidecar process
// via stdin/stdout JSON-RPC.

import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class PythonSidecar {
  #proc = null;
  #requestId = 0;
  #pythonPath = null;
  #basePath = null;

  constructor(pythonPath = null, basePath = null) {
    this.#pythonPath = pythonPath || "python3";
    this.#basePath = basePath || join(__dirname, "..", "..");
  }

  start() {
    if (this.#proc !== null) return;

    const mainPath = join(this.#basePath, "python", "agent_core", "main.py");

    this.#proc = spawn(this.#pythonPath, [mainPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this.#proc.on("error", (err) => {
      console.error("[python_sidecar] process error:", err);
    });

    this.#proc.on("exit", (code) => {
      console.log(`[python_sidecar] process exited with code ${code}`);
      this.#proc = null;
    });

    console.log(`[python_sidecar] started (pid=${this.#proc.pid})`);
  }

  stop() {
    if (this.#proc === null) return;

    this.#proc.terminate();
    this.#proc = null;
    console.log("[python_sidecar] stopped");
  }

  #send(method, params = {}) {
    if (this.#proc === null) {
      throw new Error("Sidecar not started");
    }

    this.#requestId++;
    const request = {
      jsonrpc: "2.0",
      id: this.#requestId,
      method,
      params,
    };

    const requestStr = JSON.stringify(request) + "\n";
    this.#proc.stdin.write(requestStr);

    return new Promise((resolve, reject) => {
      const onData = (data) => {
        try {
          const response = JSON.parse(data.toString());
          this.#proc.stdout.removeListener("data", onData);
          resolve(response);
        } catch {
          // ignore partial data
        }
      };
      this.#proc.stdout.on("data", onData);
      this.#proc.stderr.once("data", (d) => {
        console.error("[python_sidecar] stderr:", d.toString());
      });
    });
  }

  // ─── Skill API ────────────────────────────────────────────────

  async skillLoad(path) {
    const result = await this.#send("skill.load", { path });
    return result.result ?? result.error;
  }

  async skillList() {
    const result = await this.#send("skill.list");
    return result.result ?? [];
  }

  async skillUnload(name) {
    const result = await this.#send("skill.unload", { name });
    return result.result ?? result.error;
  }

  async skillReload(name) {
    const result = await this.#send("skill.reload", { name });
    return result.result ?? result.error;
  }

  async skillRun(name, context = {}) {
    const result = await this.#send("skill.run", { name, context });
    return result.result ?? result.error;
  }

  // ─── Memory API ────────────────────────────────────────────────

  async memoryStore(content, metadata = {}, embedding = null) {
    const result = await this.#send("memory.store", {
      content,
      metadata,
      embedding,
    });
    return result.result ?? result.error;
  }

  async memorySearch(embedding, limit = 5) {
    const result = await this.#send("memory.search", { embedding, limit });
    return result.result ?? result.error;
  }

  async memoryList(limit = 20) {
    const result = await this.#send("memory.list", { limit });
    return result.result ?? result.error;
  }

  async memoryDelete(id) {
    const result = await this.#send("memory.delete", { id });
    return result.result ?? result.error;
  }

  // ─── Exec API ─────────────────────────────────────────────────

  async execRun(code, cwd = null, timeout = 30) {
    const result = await this.#send("exec.run", { code, cwd, timeout });
    return result.result ?? result.error;
  }

  async execKill(runId) {
    const result = await this.#send("exec.kill", { run_id: runId });
    return result.result ?? result.error;
  }
}
