/**
 * AgentLoop - 自动循环执行控制器
 *
 * 状态机: IDLE → RUNNING → WAITING → RUNNING → DONE
 *                    ↓
 *                 LOOP_DETECTED → STOPPED
 */

export const LoopState = {
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING: 'waiting',
  LOOP_DETECTED: 'loop_detected',
  STOPPED: 'stopped',
  DONE: 'done'
};

export class AgentLoop {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 100;
    this.loopThreshold = options.loopThreshold || 3;
    this.autoContinue = options.autoContinue !== false;
    this.contextThreshold = options.contextThreshold || 0.8;

    this.state = LoopState.IDLE;
    this.iteration = 0;
    this.history = [];
    this.checkpoints = [];
  }

  start() {
    if (this.state === LoopState.RUNNING) return;
    this.state = LoopState.RUNNING;
    this.iteration = 0;
    this.history = [];
  }

  recordStep(step) {
    this.history.push(step);
    this.iteration++;

    const stopReason = this.shouldStop();
    if (stopReason) {
      this.state = stopReason === 'loop' ? LoopState.LOOP_DETECTED : LoopState.STOPPED;
      return { stopped: true, reason: stopReason };
    }

    return { stopped: false };
  }

  shouldStop() {
    if (this.iteration >= this.maxIterations) {
      return 'max_iterations';
    }

    if (this.detectLoop()) {
      return 'loop';
    }

    return null;
  }

  detectLoop() {
    if (this.history.length < this.loopThreshold) return false;

    const recent = this.history.slice(-this.loopThreshold);
    const outputs = recent.map(h => h.output);

    if (outputs.every(o => o === outputs[0])) {
      return true;
    }

    const hashes = outputs.map(o => this._simpleHash(o));
    if (hashes.every(h => h === hashes[0])) {
      return true;
    }

    return false;
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  pause() {
    this.state = LoopState.WAITING;
  }

  resume() {
    if (this.state === LoopState.WAITING) {
      this.state = LoopState.RUNNING;
    }
  }

  stop() {
    this.state = LoopState.STOPPED;
  }

  complete() {
    this.state = LoopState.DONE;
  }

  getStatus() {
    return {
      state: this.state,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      autoContinue: this.autoContinue,
      historyLength: this.history.length
    };
  }

  saveCheckpoint(label = '') {
    const checkpoint = {
      id: crypto.randomUUID(),
      iteration: this.iteration,
      history: [...this.history],
      state: this.state,
      label,
      timestamp: Date.now()
    };
    this.checkpoints.push(checkpoint);
    return checkpoint.id;
  }

  restoreCheckpoint(checkpointId) {
    const cp = this.checkpoints.find(c => c.id === checkpointId);
    if (cp) {
      this.iteration = cp.iteration;
      this.history = [...cp.history];
      this.state = LoopState.RUNNING;
      return true;
    }
    return false;
  }
}
