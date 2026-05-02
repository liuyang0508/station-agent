/**
 * Skill Self-Evolution Engine
 *
 * Analyzes skill execution results and triggers evolution actions:
 * - create: New skill from successful workflow
 * - patch: Targeted modification on failure
 * - evolve: Enhancement based on repeated success
 * - archive: Long-failure skill deactivation
 */

import { parseSkillMarkdown } from './skillFormats.mjs';

const TRIGGERS = {
  REPEATED_FAILURE: 'repeated_failure',
  REPEATED_SUCCESS: 'repeated_success',
  USER_FEEDBACK: 'user_feedback',
  TIMEOUT_THEN_SUCCESS: 'timeout_then_success',
  NEW_PATTERN: 'new_pattern'
};

const ACTIONS = {
  CREATE: 'create',
  PATCH: 'patch',
  EVOLVE: 'evolve',
  ARCHIVE: 'archive',
  DELETE: 'delete'
};

export class SkillEvolution {
  constructor(store) {
    this.store = store;
    this.evolutionHistory = [];
  }

  /**
   * Evaluate a skill run and determine if evolution is needed
   * @param {Object} skillRun - The skill execution record
   * @param {Object} context - Additional context (session, user feedback)
   * @returns {Object} Evolution suggestion or null
   */
  evaluate(skillRun, context = {}) {
    const { skillId, status, durationMs, error, input, output } = skillRun;
    const skill = this.store.listSkills().find(s => s.id === skillId);

    if (!skill) return null;

    const meta = skill.metadata || {};
    const evolutionConfig = skill.evolution || meta.evolution || { enabled: true, triggers: [] };
    const history = this.getSkillHistory(skillId);

    if (!evolutionConfig.enabled) return null;

    // Check each trigger threshold
    for (const trigger of evolutionConfig.triggers) {
      const result = this.checkTrigger(trigger, {
        skillRun,
        skill,
        history,
        context
      });

      if (result.shouldEvolve) {
        return this.generateEvolution(skill, result);
      }
    }

    // Check for user feedback override
    if (context.userFeedback) {
      return {
        action: ACTIONS.PATCH,
        skillId,
        trigger: TRIGGERS.USER_FEEDBACK,
        delta: this.buildDeltaFromFeedback(context.userFeedback),
        reason: 'User provided correction'
      };
    }

    return null;
  }

  checkTrigger(trigger, { skillRun, skill, history, context }) {
    const { status, error, durationMs } = skillRun;
    const recentRuns = history.slice(-10);

    switch (trigger.type) {
      case TRIGGERS.REPEATED_FAILURE: {
        const threshold = trigger.threshold || 2;
        const recentFailures = recentRuns.filter(r => r.status === 'failed').length;
        if (recentFailures >= threshold) {
          return {
            shouldEvolve: true,
            reason: `Failed ${recentFailures} times in recent runs`,
            errorPattern: this.extractErrorPattern(recentRuns.filter(r => r.error))
          };
        }
        break;
      }

      case TRIGGERS.REPEATED_SUCCESS: {
        const threshold = trigger.threshold || 5;
        const recentSuccesses = recentRuns.filter(r => r.status === 'completed').length;
        if (recentSuccesses >= threshold && recentRuns.length >= threshold) {
          return {
            shouldEvolve: true,
            reason: `Succeeded ${recentSuccesses} times consistently`,
            bestPractices: this.extractBestPractices(recentRuns)
          };
        }
        break;
      }

      case TRIGGERS.USER_FEEDBACK: {
        if (context.userFeedback) {
          return {
            shouldEvolve: true,
            reason: 'User provided feedback',
            feedback: context.userFeedback
          };
        }
        break;
      }

      case TRIGGERS.TIMEOUT_THEN_SUCCESS: {
        if (durationMs > 10000 && status === 'completed') {
          return {
            shouldEvolve: true,
            reason: `Completed after ${durationMs}ms timeout`,
            suggestion: 'Consider optimizing or increasing timeout'
          };
        }
        break;
      }

      case TRIGGERS.NEW_PATTERN: {
        if (context.newWorkflow && this.isRepeatedWorkflow(context.newWorkflow)) {
          return {
            shouldEvolve: true,
            reason: 'Detected repeated workflow pattern',
            workflow: context.newWorkflow
          };
        }
        break;
      }
    }

    return { shouldEvolve: false };
  }

  extractErrorPattern(failedRuns) {
    if (!failedRuns.length) return '';

    const errors = failedRuns
      .map(r => r.error)
      .filter(Boolean)
      .join('\n');

    // Extract common error keywords
    const keywords = ['ENOENT', 'NOT_FOUND', 'TIMEOUT', 'PERMISSION', 'SYNTAX'];
    for (const keyword of keywords) {
      if (errors.includes(keyword)) {
        return keyword;
      }
    }

    return 'UNKNOWN';
  }

  extractBestPractices(successfulRuns) {
    const outputs = successfulRuns
      .filter(r => r.output)
      .map(r => r.output);

    // Return last successful output as reference
    return outputs[outputs.length - 1] || '';
  }

  isRepeatedWorkflow(workflow) {
    // Check if this workflow has been seen multiple times
    const hash = this.hashWorkflow(workflow);
    const seen = this.store.listSkills().some(s =>
      s.metadata?.lastWorkflowHash === hash
    );
    return seen;
  }

  hashWorkflow(workflow) {
    const str = JSON.stringify(workflow);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  generateEvolution(skill, triggerResult) {
    if (triggerResult.errorPattern) {
      // Failure-triggered evolution
      return {
        action: ACTIONS.PATCH,
        skillId: skill.id,
        trigger: TRIGGERS.REPEATED_FAILURE,
        delta: {
          type: 'error_handling',
          pattern: triggerResult.errorPattern,
          suggestion: this.getErrorSuggestion(triggerResult.errorPattern)
        },
        reason: triggerResult.reason
      };
    }

    if (triggerResult.bestPractices) {
      // Success-triggered evolution
      return {
        action: ACTIONS.EVOLVE,
        skillId: skill.id,
        trigger: TRIGGERS.REPEATED_SUCCESS,
        delta: {
          type: 'enhancement',
          content: triggerResult.bestPractices,
          confidence: 0.8
        },
        reason: triggerResult.reason
      };
    }

    if (triggerResult.workflow) {
      // Pattern-triggered new skill
      return {
        action: ACTIONS.CREATE,
        skillId: skill.id,
        trigger: TRIGGERS.NEW_PATTERN,
        delta: {
          type: 'new_skill',
          workflow: triggerResult.workflow
        },
        reason: 'New repeated workflow detected'
      };
    }

    return null;
  }

  getErrorSuggestion(errorPattern) {
    const suggestions = {
      'ENOENT': 'Add file existence check before operation',
      'NOT_FOUND': 'Verify path is correct and accessible',
      'TIMEOUT': 'Increase timeout or optimize operation',
      'PERMISSION': 'Check workspace permissions',
      'SYNTAX': 'Review and fix syntax errors'
    };

    return suggestions[errorPattern] || 'Review and fix error';
  }

  buildDeltaFromFeedback(feedback) {
    return {
      type: 'user_feedback',
      content: feedback,
      appliedAt: new Date().toISOString()
    };
  }

  /**
   * Apply evolution to a skill
   */
  async evolve(skillId, evolution) {
    const skill = this.store.listSkills().find(s => s.id === skillId);
    if (!skill) throw new Error('Skill not found');

    const entry = {
      id: crypto.randomUUID(),
      skillId,
      action: evolution.action,
      trigger: evolution.trigger,
      delta: evolution.delta,
      reason: evolution.reason,
      applied: false,
      createdAt: new Date().toISOString()
    };

    // Store evolution entry
    this.store.addEvolutionEntry(entry);

    // Apply the evolution
    switch (evolution.action) {
      case ACTIONS.PATCH:
        this.applyPatch(skill, evolution.delta);
        break;
      case ACTIONS.EVOLVE:
        this.applyEvolve(skill, evolution.delta);
        break;
      case ACTIONS.CREATE:
        return this.applyCreate(evolution.delta);
      case ACTIONS.ARCHIVE:
        this.store.toggleSkill(skillId); // Disable
        break;
    }

    entry.applied = true;
    entry.appliedAt = new Date().toISOString();
    this.store.updateEvolutionEntry(entry.id, entry);

    return entry;
  }

  applyPatch(skill, delta) {
    // Update skill metadata with error handling
    const metadata = skill.metadata || {};
    metadata.errorHandling = metadata.errorHandling || [];
    metadata.errorHandling.push(delta);
    metadata.lastPatchedAt = new Date().toISOString();
    skill.metadata = metadata;
    skill.updatedAt = new Date().toISOString();

    this.store.updateSkill(skill);
  }

  applyEvolve(skill, delta) {
    // Update skill with enhancements
    if (delta.type === 'enhancement' && delta.content) {
      const metadata = skill.metadata || {};
      metadata.lastEvolvedAt = new Date().toISOString();
      metadata.evolutionsCount = (metadata.evolutionsCount || 0) + 1;
      skill.metadata = metadata;
      skill.updatedAt = new Date().toISOString();

      // Update description to reflect enhancement
      if (delta.confidence > 0.9) {
        skill.description = `[优化] ${skill.description}`;
      }

      this.store.updateSkill(skill);
    }
  }

  async applyCreate(delta) {
    if (delta.type === 'new_skill' && delta.workflow) {
      const newSkill = {
        name: `自动化-${Date.now()}`,
        description: `从工作流自动创建: ${delta.workflow.name || '未命名'}`,
        source: 'auto-evolved',
        enabled: true,
        entrypoint: '',
        command: '',
        metadata: {
          format: 'SOUL.md',
          evolvedFrom: delta.workflow.parentSkillId,
          workflow: delta.workflow,
          createdAt: new Date().toISOString()
        }
      };

      return this.store.installSkill(newSkill);
    }
    return null;
  }

  getSkillHistory(skillId) {
    return this.store.listSkillRuns(skillId);
  }

  getEvolutionHistory(skillId = null) {
    const entries = this.store.listEvolutionEntries();
    if (skillId) {
      return entries.filter(e => e.skillId === skillId);
    }
    return entries;
  }
}

/**
 * Create SkillEvolution instance with store
 */
export function createSkillEvolution(store) {
  return new SkillEvolution(store);
}
