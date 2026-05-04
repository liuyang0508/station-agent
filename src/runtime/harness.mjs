/**
 * Harness - Agent 运行时保护层
 *
 * 整合 DecisionValidator, ConstraintEnforcer, RollbackManager
 */

import { DecisionValidator } from './decisionValidator.mjs';
import { ConstraintEnforcer } from './constraintEnforcer.mjs';
import { RollbackManager } from './rollbackManager.mjs';

export class Harness {
  constructor(options = {}) {
    this.validator = new DecisionValidator();
    this.enforcer = new ConstraintEnforcer();
    this.rollback = new RollbackManager(options.maxSnapshots || 10);
    this.enabled = options.enabled !== false;
  }

  validateDecision(decision, context = {}) {
    if (!this.enabled) return { valid: true, issues: [] };
    return this.validator.validate(decision, context);
  }

  checkConstraint(action, context = {}) {
    if (!this.enabled) return { allowed: true };
    return this.enforcer.check(action, context);
  }

  saveCheckpoint(state, label = '', metadata = {}) {
    return this.rollback.snapshot(state, { label, ...metadata });
  }

  rollbackTo(checkpointId) {
    return this.rollback.rollback(checkpointId);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      snapshots: this.rollback.list().length,
      constraints: this.enforcer.list()
    };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  addDecisionRule(rule) {
    this.validator.addRule(rule);
  }

  addConstraint(constraint) {
    this.enforcer.addConstraint(constraint);
  }
}
