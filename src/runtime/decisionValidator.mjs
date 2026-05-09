/**
 * DecisionValidator - 验证 Agent 决策是否合理
 */

export class DecisionValidator {
  constructor() {
    this.rules = [
      // 范围蔓延检测 — 决策关键词与目标关键词无重叠时警告
      {
        type: 'scope_creep',
        severity: 'warn',
        check: (decision, context) => {
          if (!context.goal || !decision.content) return true;
          const goalKeywords = this._extractKeywords(context.goal);
          const decisionKeywords = this._extractKeywords(decision.content);
          if (goalKeywords.length === 0) return true;
          const overlap = goalKeywords.filter(k => decisionKeywords.includes(k));
          // 降低阈值到 15%，允许轻微词根变化（如 auth ~ authent）
          return overlap.length >= Math.max(1, goalKeywords.length * 0.15);
        }
      },
      // 决策一致性检测
      {
        type: 'consistency',
        severity: 'block',
        check: (decision, context) => {
          if (!context.history || context.history.length < 1) return true;

          const recent = context.history.slice(-3);
          for (const h of recent) {
            if (h.role === 'assistant') {
              if (this._isReversal(decision.content, h.content)) {
                return false;
              }
            }
          }
          return true;
        }
      },
      // 置信度匹配检测
      {
        type: 'confidence_mismatch',
        severity: 'warn',
        check: (decision) => {
          const importance = decision.importance || 'medium';
          const confidence = decision.confidence || 0.5;

          const thresholds = { high: 0.7, medium: 0.5, low: 0.3 };

          return confidence >= thresholds[importance];
        }
      }
    ];
  }

  validate(decision, context = {}) {
    const issues = [];

    for (const rule of this.rules) {
      if (!rule.check(decision, context)) {
        issues.push({
          type: rule.type,
          severity: rule.severity,
          message: this._getMessage(rule.type)
        });
      }
    }

    return {
      valid: issues.filter(i => i.severity === 'block').length === 0,
      issues
    };
  }

  addRule(rule) {
    this.rules.push(rule);
  }

  _extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  }

  _isReversal(newContent, oldContent) {
    const reversalPatterns = [
      /不对/, /错/, /取消/, /不是这样/, /重新/,
      /actually no/, /wait/, /actually,/
    ];
    const hasReversal = reversalPatterns.some(p => newContent.match(p));
    return hasReversal && this._similarity(newContent, oldContent) > 0.2;
  }

  _similarity(a, b) {
    const setA = new Set(this._extractKeywords(a));
    const setB = new Set(this._extractKeywords(b));
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }

  _getMessage(type) {
    const messages = {
      scope_creep: '检测到可能的范围蔓延',
      consistency: '决策与历史不一致，可能推翻了之前的结论',
      confidence_mismatch: '置信度与决策重要性不匹配'
    };
    return messages[type] || '未知问题';
  }
}
