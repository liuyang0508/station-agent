import { randomUUID } from 'node:crypto';

export class WorkflowStep {
  constructor({ id, name, description, inputs, outputs, errorHandling, status = 'pending' }) {
    this.id = id || randomUUID();
    this.name = name;
    this.description = description || '';
    this.inputs = inputs || {};
    this.outputs = outputs || [];
    this.errorHandling = errorHandling || [];
    this.status = status;
    this.result = null;
    this.error = null;
    this.startedAt = null;
    this.completedAt = null;
  }

  async execute(context, tools) {
    this.status = 'running';
    this.startedAt = new Date().toISOString();
    try {
      const inputMap = this._resolveInputs(this.inputs, context);
      const toolName = inputMap._tool;
      const toolArgs = { ...inputMap };
      delete toolArgs._tool;

      let result;
      if (tools && tools.has(toolName)) {
        result = tools.run(toolName, toolArgs);
      } else {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      this.result = result;
      this.status = 'completed';
      this.completedAt = new Date().toISOString();
      return { ok: true, result };
    } catch (error) {
      this.error = error.message;
      this.status = 'failed';
      this.completedAt = new Date().toISOString();
      return this._handleError(error, context);
    }
  }

  _resolveInputs(inputs, context) {
    const resolved = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        const ref = value.slice(1);
        resolved[key] = this._getNested(context, ref);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  _getNested(obj, path) {
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
  }

  _handleError(error, context) {
    const strategy = this.errorHandling.find(e => e.type === error.constructor.name || e.type === 'generic');
    if (!strategy) return { ok: false, error: error.message };

    if (strategy.action === 'retry') {
      const delay = strategy.delay || 1000;
      return { ok: false, error: error.message, retryScheduled: delay };
    } else if (strategy.action === 'fallback') {
      return { ok: false, error: error.message, fallbackTriggered: true };
    } else if (strategy.action === 'skip') {
      return { ok: false, error: error.message, skipped: true };
    }
    return { ok: false, error: error.message };
  }
}

export class WorkflowEngine {
  constructor({ maxParallel = 3 } = {}) {
    this.maxParallel = maxParallel;
  }

  buildWorkflow(agentDef, context) {
    const steps = (agentDef.capabilities || []).map(cap => {
      return new WorkflowStep({
        name: cap.name || cap.action || 'unnamed-step',
        description: cap.description || '',
        inputs: cap.inputs || {},
        outputs: cap.outputs || [],
        errorHandling: agentDef.error_handling || []
      });
    });
    return steps;
  }

  async *execute(workflow, context, tools) {
    const pending = [...workflow];
    const running = [];
    const completed = [];
    const results = [];

    while (pending.length > 0 || running.length > 0) {
      // Fill running queue up to maxParallel
      while (running.length < this.maxParallel && pending.length > 0) {
        const step = pending.shift();
        running.push(step);
        yield {
          type: 'step.started',
          stepId: step.id,
          stepName: step.name,
          status: 'running',
          detail: `开始执行: ${step.name}`
        };
        step.execute(context, tools).then(result => {
          step.status = result.ok ? 'completed' : 'failed';
          step.result = result.result;
          step.error = result.error;
          step.completedAt = new Date().toISOString();
          completed.push(step);
          const idx = running.findIndex(s => s.id === step.id);
          if (idx >= 0) running.splice(idx, 1);
        }).catch(err => {
          step.status = 'failed';
          step.error = err.message;
          step.completedAt = new Date().toISOString();
          completed.push(step);
          const idx = running.findIndex(s => s.id === step.id);
          if (idx >= 0) running.splice(idx, 1);
        });
      }

      // Small delay to prevent busy loop
      await new Promise(r => setTimeout(r, 50));

      // Yield status of completed steps
      for (const step of completed) {
        if (!step._yielded) {
          step._yielded = true;
          results.push(step);
          yield {
            type: 'step.completed',
            stepId: step.id,
            stepName: step.name,
            status: step.status,
            result: step.result,
            error: step.error,
            detail: step.status === 'completed'
              ? `完成: ${step.name}`
              : `失败: ${step.name} — ${step.error}`
          };
        }
      }
    }

    yield {
      type: 'workflow.done',
      steps: results.length,
      completed: results.filter(s => s.status === 'completed').length,
      failed: results.filter(s => s.status === 'failed').length
    };
  }

  async executeParallel(steps, context, tools) {
    const promises = steps.map(step => step.execute(context, tools));
    const results = await Promise.allSettled(promises);
    return results.map((r, i) => ({
      stepId: steps[i].id,
      stepName: steps[i].name,
      ...(r.status === 'fulfilled' ? { ok: true, result: r.value } : { ok: false, error: r.reason.message })
    }));
  }
}

export function parseAgentWorkflow(agentDef) {
  const capabilities = (agentDef.capabilities || []).map(cap => ({
    name: cap.name,
    description: cap.description,
    inputs: cap.inputs,
    outputs: cap.outputs,
    parallel: cap.parallel || false
  }));

  return {
    name: agentDef.name,
    description: agentDef.description,
    capabilities,
    inputs: agentDef.inputs || [],
    outputs: agentDef.outputs || [],
    errorHandling: agentDef.error_handling || [],
    version: agentDef.version || '1.0.0'
  };
}
