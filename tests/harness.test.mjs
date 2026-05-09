import test from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/runtime/harness.mjs';
import { ConstraintEnforcer, ConstraintType } from '../src/runtime/constraintEnforcer.mjs';
import { DecisionValidator } from '../src/runtime/decisionValidator.mjs';
import { RollbackManager } from '../src/runtime/rollbackManager.mjs';
import { CheckpointManager } from '../src/runtime/checkpoint.mjs';

// ============================================================
// DecisionValidator tests
// ============================================================

test('DecisionValidator passes valid decision', () => {
  const validator = new DecisionValidator();
  const result = validator.validate(
    { content: 'Create a new file for user authentication', confidence: 0.8, importance: 'high' },
    { goal: 'Add user authentication system', history: [] }
  );
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test('DecisionValidator detects scope creep when decision unrelated to goal', () => {
  const validator = new DecisionValidator();
  // Decision about cooking when goal is about authentication — should trigger scope_creep
  const result = validator.validate(
    { content: 'Cook pasta for dinner', confidence: 0.9, importance: 'medium' },
    { goal: 'Add user authentication system', history: [] }
  );
  // overlap < 20% threshold → issue
  const scopeIssue = result.issues.find(i => i.type === 'scope_creep');
  assert.ok(scopeIssue, 'Should detect scope creep');
});

test('DecisionValidator allows decision related to goal', () => {
  const validator = new DecisionValidator();
  // Decision and goal share clear keywords: "authentication", "token", "JWT"
  const result = validator.validate(
    { content: 'Add JWT token handling to the authentication module', confidence: 0.8, importance: 'high' },
    { goal: 'Build authentication system with JWT token support', history: [] }
  );
  const scopeIssue = result.issues.find(i => i.type === 'scope_creep');
  assert.equal(scopeIssue, undefined, 'Should NOT detect scope creep');
});

test('DecisionValidator detects reversal decisions', () => {
  const validator = new DecisionValidator();
  const history = [
    { role: 'assistant', content: 'Let me implement the login flow using OAuth' }
  ];
  // The new decision shares keywords with history (login, implement) so similarity > 0,
  // AND contains 'actually no' pattern → should trigger reversal detection
  const result = validator.validate(
    { content: 'actually no, let me cancel the login and OAuth implementation', confidence: 0.9, importance: 'high' },
    { goal: 'Add user authentication', history }
  );
  const consistencyIssue = result.issues.find(i => i.type === 'consistency');
  assert.ok(consistencyIssue, 'Should detect decision reversal');
  assert.equal(result.valid, false, 'Should be invalid due to consistency block');
});

test('DecisionValidator passes when no history', () => {
  const validator = new DecisionValidator();
  const result = validator.validate(
    { content: 'Create a new file', confidence: 0.5, importance: 'medium' },
    { goal: 'Add feature', history: [] }
  );
  assert.equal(result.valid, true);
});

test('DecisionValidator warns on low confidence for high importance', () => {
  const validator = new DecisionValidator();
  const result = validator.validate(
    { content: 'Modify the database schema', confidence: 0.2, importance: 'high' },
    { goal: 'Refactor database layer', history: [] }
  );
  const mismatch = result.issues.find(i => i.type === 'confidence_mismatch');
  assert.ok(mismatch, 'Should warn about confidence/importance mismatch');
});

test('DecisionValidator allows adding custom rules', () => {
  const validator = new DecisionValidator();
  validator.addRule({
    type: 'custom_rule',
    severity: 'warn',
    check: (decision) => decision.content.length > 0
  });
  const result = validator.validate({ content: 'test', confidence: 0.5, importance: 'low' }, {});
  const customIssue = result.issues.find(i => i.type === 'custom_rule');
  assert.ok(!customIssue, 'Custom rule should pass');
});

// ============================================================
// ConstraintEnforcer tests
// ============================================================

test('ConstraintEnforcer allows safe commands', () => {
  const enforcer = new ConstraintEnforcer();
  const result = enforcer.check({ command: 'ls -la /tmp' });
  assert.equal(result.allowed, true);
  assert.equal(result.hardViolations.length, 0);
});

test('ConstraintEnforcer blocks destructive commands (HARD)', () => {
  const enforcer = new ConstraintEnforcer();
  const destructive = [
    { command: 'rm -rf /tmp/*' },
    { command: 'del /s /q C:\\*' },
    { command: 'format E:' },
    { command: 'drop table users' }
  ];

  for (const action of destructive) {
    const result = enforcer.check(action);
    assert.equal(result.allowed, false, `Should block: ${action.command}`);
    assert.ok(result.hardViolations.some(v => v.id === 'no_destructive'), `Should have no_destructive violation: ${action.command}`);
  }
});

test('ConstraintEnforcer allows non-destructive commands through no_destructive', () => {
  const enforcer = new ConstraintEnforcer();
  const safe = [
    { command: 'ls -la' },
    { command: 'git status' },
    { command: 'echo hello' }
  ];

  for (const action of safe) {
    const result = enforcer.check(action);
    assert.equal(result.allowed, true, `Should allow: ${action.command}`);
  }
});

test('ConstraintEnforcer blocks parent directory escape (workspace_boundary HARD)', () => {
  const enforcer = new ConstraintEnforcer();
  const result = enforcer.check(
    { command: 'cat ../../etc/passwd' },
    { workspaceRoot: '/home/user/project' }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.hardViolations.some(v => v.id === 'workspace_boundary'), 'Should block ../ escape');
});

test('ConstraintEnforcer allows same-directory access', () => {
  const enforcer = new ConstraintEnforcer();
  const result = enforcer.check(
    { command: 'cat ./config.json' },
    { workspaceRoot: '/home/user/project' }
  );
  assert.equal(result.allowed, true);
});

test('ConstraintEnforcer SOFT triggers on high-risk commands', () => {
  const enforcer = new ConstraintEnforcer();
  const result = enforcer.check({ command: 'sudo apt update' });
  // SOFT: still allowed, but softViolations recorded
  assert.equal(result.allowed, true, 'SOFT should still allow execution');
  assert.ok(result.softViolations.some(v => v.id === 'approval_required'), 'Should have soft violation');
});

test('ConstraintEnforcer SOFT does not block on non-high-risk commands', () => {
  const enforcer = new ConstraintEnforcer();
  const result = enforcer.check({ command: 'git log --oneline -5' });
  assert.equal(result.allowed, true);
  assert.equal(result.softViolations.length, 0);
});

test('ConstraintEnforcer custom HARD constraint blocks network commands', () => {
  const enforcer = new ConstraintEnforcer();
  enforcer.addConstraint({
    id: 'no_network',
    type: ConstraintType.HARD,
    rule: (action) => {
      const cmd = action.command || '';
      // Block only curl/wget that look like network fetches, not -V/help
      return !cmd.match(/^curl\s+(?!-)/) && !cmd.match(/^wget\s+(?!-)/);
    },
    message: 'Network commands blocked'
  });

  const blocked = enforcer.check({ command: 'curl http://example.com' });
  assert.equal(blocked.allowed, false, 'Should block curl http fetch');

  const allowed = enforcer.check({ command: 'curl -V' });
  assert.equal(allowed.allowed, true, 'curl -V should be allowed');
});

test('ConstraintEnforcer list() returns constraint summaries', () => {
  const enforcer = new ConstraintEnforcer();
  const list = enforcer.list();
  assert.ok(list.length >= 3, 'Should have at least 3 default constraints');
  assert.ok(list.some(c => c.id === 'no_destructive'), 'Should have no_destructive');
  assert.ok(list.some(c => c.id === 'workspace_boundary'), 'Should have workspace_boundary');
  assert.ok(list.some(c => c.id === 'approval_required'), 'Should have approval_required');
});

// ============================================================
// RollbackManager tests
// ============================================================

test('RollbackManager snapshots and restores state', () => {
  const manager = new RollbackManager(10);
  const state = { count: 1, data: 'original' };

  const id = manager.snapshot(state);
  assert.ok(id, 'Should return snapshot ID');

  state.count = 999; // modify after snapshot
  const restored = manager.rollback(id);

  assert.equal(restored.count, 1);
  assert.equal(restored.data, 'original');
});

test('RollbackManager respects maxSnapshots limit', () => {
  const manager = new RollbackManager(3);
  for (let i = 0; i < 5; i++) {
    manager.snapshot({ count: i });
  }
  assert.equal(manager.list().length, 3, 'Should keep only 3 snapshots');
});

test('RollbackManager rollbackLast returns most recent snapshot', () => {
  const manager = new RollbackManager(10);
  manager.snapshot({ value: 'first' });
  manager.snapshot({ value: 'second' });
  manager.snapshot({ value: 'third' });

  const last = manager.rollbackLast();
  assert.equal(last.value, 'third');
});

test('RollbackManager clear removes all snapshots', () => {
  const manager = new RollbackManager(10);
  manager.snapshot({ count: 1 });
  manager.snapshot({ count: 2 });
  manager.clear();
  assert.equal(manager.list().length, 0);
});

test('RollbackManager returns null for unknown snapshot ID', () => {
  const manager = new RollbackManager(10);
  const result = manager.rollback('non-existent-id');
  assert.equal(result, null);
});

// ============================================================
// CheckpointManager tests
// ============================================================

test('CheckpointManager creates checkpoints', () => {
  const manager = new CheckpointManager();
  const cp = manager.create({
    goal: 'Implement login',
    expected_outcomes: ['token issued', 'session created']
  });

  assert.ok(cp.id, 'Should have an ID');
  assert.equal(cp.goal, 'Implement login');
  assert.equal(cp.status, 'pending');
});

test('CheckpointManager validates pending checkpoints', () => {
  const manager = new CheckpointManager();
  manager.create({ goal: 'Add numbers', validation_fn: (state) => state?.output === 42 });
  const results = manager.validateAll({ output: 42 });
  assert.equal(results[0].status, 'passed');
});

test('CheckpointManager tracks failed checkpoints', () => {
  const manager = new CheckpointManager();
  manager.create({
    goal: 'Add numbers',
    validation_fn: (state) => state?.result === 'correct'
  });
  manager.validateAll({ result: 'wrong' });
  const failed = manager.getFailed();
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, 'failed');
});

test('CheckpointManager returns all checkpoints via list()', () => {
  const manager = new CheckpointManager();
  manager.create({ goal: 'Task 1' });
  manager.create({ goal: 'Task 2' });
  const all = manager.list();
  assert.equal(all.length, 2);
});

// ============================================================
// Harness integration tests
// ============================================================

test('Harness starts enabled by default', () => {
  const harness = new Harness();
  const status = harness.getStatus();
  assert.equal(status.enabled, true);
});

test('Harness can be disabled', () => {
  const harness = new Harness({ enabled: false });
  assert.equal(harness.checkConstraint({ command: 'rm -rf /' }).allowed, true, 'Disabled harness should allow everything');
});

test('Harness.getStatus() returns constraint count', () => {
  const harness = new Harness();
  const status = harness.getStatus();
  assert.ok(typeof status.constraints === 'number' || Array.isArray(status.constraints), 'Should have constraints info');
  assert.ok(status.snapshots === 0 || typeof status.snapshots === 'number');
});

test('Harness.saveCheckpoint returns checkpoint ID', () => {
  const harness = new Harness();
  const id = harness.saveCheckpoint({ step: 1, data: 'test' }, 'initial');
  assert.ok(id, 'Should return a checkpoint ID');
});

test('Harness.addDecisionRule adds rule to validator', () => {
  const harness = new Harness();
  const before = harness.validator.rules.length;
  harness.addDecisionRule({ type: 'test', severity: 'warn', check: () => true });
  assert.equal(harness.validator.rules.length, before + 1);
});

test('Harness.addConstraint adds constraint to enforcer', () => {
  const harness = new Harness();
  const before = harness.enforcer.constraints.length;
  harness.addConstraint({
    id: 'test_constraint',
    type: 'hard',
    rule: () => true,
    message: 'test'
  });
  assert.equal(harness.enforcer.constraints.length, before + 1);
});

test('Harness.validateDecision delegates to DecisionValidator', () => {
  const harness = new Harness();
  const result = harness.validateDecision(
    { content: 'Add new feature', confidence: 0.8 },
    { goal: 'Add new feature', history: [] }
  );
  assert.ok(result.hasOwnProperty('valid'));
  assert.ok(Array.isArray(result.issues));
});

test('Harness.checkConstraint delegates to ConstraintEnforcer', () => {
  const harness = new Harness();
  const result = harness.checkConstraint({ command: 'ls' });
  assert.ok(result.hasOwnProperty('allowed'));
});

test('Harness.setEnabled toggles harness on/off', () => {
  const harness = new Harness({ enabled: true });
  harness.setEnabled(false);
  assert.equal(harness.getStatus().enabled, false);
  harness.setEnabled(true);
  assert.equal(harness.getStatus().enabled, true);
});
