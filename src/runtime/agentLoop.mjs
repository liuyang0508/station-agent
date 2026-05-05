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

    // Check exact equality first (fast path)
    if (outputs.every(o => o === outputs[0])) {
      return true;
    }

    // Normalize outputs: remove timestamps, UUIDs, random strings
    const normalized = outputs.map(o => this._normalizeOutput(o));

    // Check if normalized outputs are identical
    const normalizedHashes = normalized.map(o => this._simpleHash(o));
    if (normalizedHashes.every(h => h === normalizedHashes[0])) {
      return true;
    }

    // Check token-based similarity (n-gram overlap)
    const similarity = this._calculateSimilarity(normalized);
    if (similarity >= 0.85) {
      return true;
    }

    // Check for repeated action patterns
    const actions = recent.map(h => h.action).filter(Boolean);
    if (actions.length >= this.loopThreshold) {
      const actionStr = actions.join('|');
      const actionHash = this._simpleHash(actionStr);
      const firstActionRepetition = actions[0].repeat(Math.ceil(actions.length / actions[0].length));
      if (actionHash === this._simpleHash(firstActionRepetition)) {
        return true;
      }
    }

    return false;
  }

  _normalizeOutput(output) {
    if (!output || typeof output !== 'string') return '';

    let normalized = output;

    // Remove ISO timestamps
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TS>');

    // Remove Unix timestamps (10-13 digits)
    normalized = normalized.replace(/\b\d{10,13}\b/g, '<NUM>');

    // Remove UUIDs
    normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');

    // Remove hex strings (like file hashes)
    normalized = normalized.replace(/\b[0-9a-f]{32,64}\b/gi, '<HEX>');

    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  _calculateSimilarity(outputs) {
    if (outputs.length < 2) return 0;

    // Calculate token-based Jaccard similarity
    const tokenSets = outputs.map(o => new Set(o.split(/\s+/).filter(t => t.length > 2)));

    let totalIntersection = 0;
    let totalUnion = 0;

    for (let i = 1; i < tokenSets.length; i++) {
      const intersection = new Set([...tokenSets[0]].filter(x => tokenSets[i].has(x)));
      const union = new Set([...tokenSets[0], ...tokenSets[i]]);
      totalIntersection += intersection.size;
      totalUnion += union.size;
    }

    return totalUnion > 0 ? totalIntersection / totalUnion : 0;
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
