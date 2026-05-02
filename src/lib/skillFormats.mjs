/**
 * Skill Format Parsers — SOUL.md, AGENT.md, MEMORY.md
 */

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentValue = null;

  for (const line of lines) {
    const keyMatch = line.match(/^(\w+(?:_\w+)*):\s*/);
    if (keyMatch) {
      if (currentKey) frontmatter[currentKey] = currentValue;
      currentKey = keyMatch[1];
      currentValue = line.slice(keyMatch[0].length).trim();
    } else if (line.match(/^\s+-/) && currentKey) {
      const value = line.replace(/^\s+-\s*/, '').trim();
      if (Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey].push(value);
      } else {
        frontmatter[currentKey] = [value];
      }
    }
  }
  if (currentKey) frontmatter[currentKey] = currentValue;

  return {
    frontmatter,
    body: content.slice(match[0].length).trim()
  };
}

function parseEvolutionHistory(body) {
  const lines = body.split('\n');
  const history = [];
  let inTable = false;

  for (const line of lines) {
    if (line.includes('| 时间 |')) {
      inTable = true;
      continue;
    }
    if (inTable && line.includes('|')) {
      const cells = line.split('|').filter(c => c.trim());
      if (cells.length >= 3) {
        history.push({
          date: cells[0].trim(),
          change: cells[1].trim(),
          reason: cells[2].trim()
        });
      }
    }
  }

  return history;
}

export function parseSoulMarkdown(content) {
  const { frontmatter, body } = parseYamlFrontmatter(content);

  return {
    name: frontmatter.name || '',
    version: frontmatter.version || '1.0.0',
    type: frontmatter.type || 'soul',
    description: frontmatter.description || '',
    trigger: frontmatter.trigger || [],
    evolution: {
      enabled: frontmatter.evolution?.enabled !== false,
      triggers: (frontmatter.evolution?.triggers || []).map(t => {
        if (typeof t === 'string') {
          const [type, threshold] = t.split(':');
          return { type, threshold: parseInt(threshold) || 1 };
        }
        return t;
      })
    },
    body,
    history: parseEvolutionHistory(body),
    raw: content
  };
}

export function parseAgentMarkdown(content) {
  const { frontmatter, body } = parseYamlFrontmatter(content);

  return {
    name: frontmatter.name || '',
    version: frontmatter.version || '1.0.0',
    type: 'agent',
    description: frontmatter.description || '',
    entrypoint: frontmatter.entrypoint || '',
    capabilities: frontmatter.capabilities || [],
    inputs: frontmatter.inputs || [],
    outputs: frontmatter.outputs || [],
    error_handling: frontmatter.error_handling || [],
    body,
    raw: content
  };
}

export function parseMemoryMarkdown(content) {
  const { frontmatter, body } = parseYamlFrontmatter(content);

  return {
    name: frontmatter.name || '',
    version: frontmatter.version || '1.0.0',
    type: 'memory',
    description: frontmatter.description || '',
    scope: {
      workspace: frontmatter.scope?.workspace || '',
      context: frontmatter.scope?.context || []
    },
    retrieval: {
      method: frontmatter.retrieval?.method || 'vector',
      top_k: parseInt(frontmatter.retrieval?.top_k) || 5,
      min_similarity: parseFloat(frontmatter.retrieval?.min_similarity) || 0.7
    },
    update_policy: frontmatter.update_policy || [],
    body,
    raw: content
  };
}

export function detectSkillFormat(content) {
  const { frontmatter } = parseYamlFrontmatter(content);
  const type = frontmatter.type;

  if (type === 'agent') return 'AGENT.md';
  if (type === 'memory') return 'MEMORY.md';
  if (type === 'soul') return 'SOUL.md';

  // Fallback detection based on content patterns
  if (content.includes('retrieval:') && content.includes('update_policy:')) {
    return 'MEMORY.md';
  }
  if (content.includes('entrypoint:') && content.includes('capabilities:')) {
    return 'AGENT.md';
  }
  if (content.includes('trigger:') && content.includes('evolution:')) {
    return 'SOUL.md';
  }

  return 'SOUL.md'; // default
}

export function parseSkillMarkdown(content) {
  const format = detectSkillFormat(content);

  switch (format) {
    case 'AGENT.md': return parseAgentMarkdown(content);
    case 'MEMORY.md': return parseMemoryMarkdown(content);
    case 'SOUL.md':
    default:
      return parseSoulMarkdown(content);
  }
}

export function buildSkillFromSoul(soul, context = {}) {
  return {
    name: soul.name,
    description: soul.description,
    type: soul.type,
    version: soul.version,
    source: context.source || 'soul-evolved',
    entrypoint: soul.entrypoint || '',
    command: soul.command || '',
    evolution: soul.evolution,
    metadata: {
      format: 'SOUL.md',
      triggers: soul.trigger,
      history: soul.history,
      evolvedAt: new Date().toISOString()
    }
  };
}

export function buildEvolutionEntry(skillId, trigger, delta, result) {
  return {
    id: crypto.randomUUID(),
    skillId,
    trigger,
    delta,
    result,
    applied: false,
    createdAt: new Date().toISOString()
  };
}
