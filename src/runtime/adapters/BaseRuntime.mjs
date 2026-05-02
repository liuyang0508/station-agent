export class AgentRuntimeAdapter {
  constructor({ settings, skills, memories }) {
    this.settings = settings;
    this.skills = skills;
    this.memories = memories || [];
  }

  async *runTurn(prompt, context) {
    throw new Error('Not implemented');
  }

  async testConnection() {
    return { ok: false, status: 'not_supported', message: 'Runtime does not support connection testing' };
  }

  getInfo() {
    return { mode: this.constructor.name.replace('Runtime', '').toLowerCase() };
  }
}
