import { randomUUID } from 'node:crypto';

export class MultiModelRouter {
  constructor({ store, settings }) {
    this.store = store;
    this.settings = settings;
    this.activeRuns = new Map();
  }

  async route({ prompt, context, strategy = 'single' }) {
    const runId = randomUUID();
    const models = this._getModelChain();

    if (strategy === 'single') {
      return this._singleRoute(runId, prompt, context, models);
    } else if (strategy === 'parallel') {
      return this._parallelRoute(runId, prompt, context, models);
    } else if (strategy === 'fallback') {
      return this._fallbackRoute(runId, prompt, context, models);
    }
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  _getModelChain() {
    const configs = this.store.listModelConfigs?.() || [];
    if (configs.length > 0) return configs;

    // Default chain from settings
    return [{
      id: 'default',
      name: this.settings.model || 'default',
      baseUrl: this.settings.baseUrl,
      apiKeyEnv: this.settings.apiKeyEnv,
      provider: this.settings.provider || 'openai-compatible',
      enabled: true,
      priority: 1,
      taskTypes: ['general', 'reasoning', 'coding', 'creative']
    }];
  }

  async _singleRoute(runId, prompt, context, models) {
    const model = models.find(m => m.enabled) || models[0];
    return {
      runId,
      strategy: 'single',
      model: model.name,
      results: null
    };
  }

  async _parallelRoute(runId, prompt, context, models) {
    const enabled = models.filter(m => m.enabled);
    const results = await Promise.allSettled(
      enabled.map(async (model) => {
        // Each model would be called through its adapter
        return { modelId: model.id, modelName: model.name, ok: false, error: 'not implemented' };
      })
    );
    return {
      runId,
      strategy: 'parallel',
      results
    };
  }

  async _fallbackRoute(runId, prompt, context, models) {
    const sorted = models.filter(m => m.enabled).sort((a, b) => a.priority - b.priority);
    const errors = [];

    for (const model of sorted) {
      try {
        // Attempt call through model adapter
        return {
          runId,
          strategy: 'fallback',
          model: model.name,
          attempts: errors.length + 1
        };
      } catch (error) {
        errors.push({ model: model.name, error: error.message });
      }
    }

    return {
      runId,
      strategy: 'fallback',
      ok: false,
      errors
    };
  }

  getModelConfigs() {
    return this._getModelChain();
  }
}

export class ModelCostTracker {
  constructor() {
    this.dailyLimits = {
      'gpt-4o': 100000,
      'gpt-4o-mini': 200000,
      'claude-sonnet': 150000,
      'claude-haiku': 300000,
      'default': 100000
    };
  }

  estimateCost(model, inputTokens, outputTokens) {
    const limits = this.dailyLimits[model] || this.dailyLimits['default'];
    const inputCost = inputTokens * 0.00001;
    const outputCost = outputTokens * 0.00003;
    return { inputCost, outputCost, totalCost: inputCost + outputCost, dailyLimit: limits };
  }

  shouldRouteToCheaper(model, currentSpend) {
    const limit = this.dailyLimits[model] || this.dailyLimits['default'];
    return currentSpend > limit * 0.8;
  }
}
