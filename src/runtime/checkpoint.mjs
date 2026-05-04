/**
 * Checkpoint System - 用于验证 Agent 是否在正确方向上
 */

import { randomUUID } from 'node:crypto';

export class Checkpoint {
  constructor({ goal, expected_outcomes = [], validation_fn = null }) {
    this.id = randomUUID();
    this.goal = goal;
    this.expected_outcomes = expected_outcomes;
    this.validation_fn = validation_fn;
    this.status = 'pending';
    this.created_at = new Date().toISOString();
    this.validated_at = null;
  }

  validate(agent_state) {
    if (this.validation_fn) {
      const result = this.validation_fn(agent_state, this.expected_outcomes);
      this.status = result ? 'passed' : 'failed';
    } else {
      this.status = agent_state?.output ? 'passed' : 'pending';
    }
    this.validated_at = new Date().toISOString();
    return this.status === 'passed';
  }
}

export class CheckpointManager {
  constructor() {
    this.checkpoints = [];
  }

  create({ goal, expected_outcomes, validation_fn, metadata = {} }) {
    const checkpoint = new Checkpoint({ goal, expected_outcomes, validation_fn });
    checkpoint.metadata = metadata;
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  validateAll(agent_state) {
    const results = [];
    for (const cp of this.checkpoints) {
      if (cp.status === 'pending') {
        cp.validate(agent_state);
      }
      results.push({ id: cp.id, goal: cp.goal, status: cp.status });
    }
    return results;
  }

  getPending() {
    return this.checkpoints.filter(cp => cp.status === 'pending');
  }

  getFailed() {
    return this.checkpoints.filter(cp => cp.status === 'failed');
  }

  list() {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      goal: cp.goal,
      status: cp.status,
      created_at: cp.created_at,
      validated_at: cp.validated_at
    }));
  }
}
