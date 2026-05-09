/**
 * ConstraintEnforcer - 执行操作约束
 */

export const ConstraintType = {
  HARD: 'hard',
  SOFT: 'soft',
  OPTIMIZATION: 'optimization'
};

export class ConstraintEnforcer {
  constructor() {
    this.constraints = this._defaultConstraints();
  }

  _defaultConstraints() {
    return [
      {
        id: 'no_destructive',
        type: ConstraintType.HARD,
        rule: (action) => {
          const destructivePatterns = [
            /rm\s+-rf/, /del(\s+\/?[sq])?(?:\s+C:)?/i, /format/i,
            /drop\s+table/i, /delete\s+from\s+\*/i
          ];
          const cmd = action.command || action.content || '';
          return !destructivePatterns.some(p => cmd.match(p));
        },
        message: '禁止执行破坏性操作'
      },
      {
        id: 'workspace_boundary',
        type: ConstraintType.HARD,
        rule: (action, context) => {
          if (!context.workspaceRoot) return true;
          const cmd = action.command || '';
          // Block any .. path segment anywhere in command
          return !cmd.match(/(^|\s)\.\.\//);
        },
        message: '操作必须在工作区内'
      },
      {
        id: 'approval_required',
        type: ConstraintType.SOFT,
        rule: (action) => {
          const highRiskPatterns = [
            /sudo/, /chmod\s+777/, /kill\s+-9/,
            /curl\s+http/, /wget\s+http/
          ];
          const cmd = action.command || '';
          return !highRiskPatterns.some(p => cmd.match(p));
        },
        message: '高风险操作需要额外确认'
      }
    ];
  }

  check(action, context = {}) {
    const results = {
      allowed: true,
      hardViolations: [],
      softViolations: [],
      warnings: []
    };

    for (const constraint of this.constraints) {
      const passed = constraint.rule(action, context);

      if (!passed) {
        if (constraint.type === ConstraintType.HARD) {
          results.allowed = false;
          results.hardViolations.push({
            id: constraint.id,
            message: constraint.message
          });
        } else if (constraint.type === ConstraintType.SOFT) {
          results.softViolations.push({
            id: constraint.id,
            message: constraint.message
          });
        }
      }
    }

    return results;
  }

  addConstraint(constraint) {
    this.constraints.push(constraint);
  }

  removeConstraint(id) {
    this.constraints = this.constraints.filter(c => c.id !== id);
  }

  list() {
    return this.constraints.map(c => ({
      id: c.id,
      type: c.type,
      message: c.message
    }));
  }
}
