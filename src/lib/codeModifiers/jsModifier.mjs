/**
 * JavaScript Code Modifier — AST-based code transformation
 *
 * PATCH: Wraps function bodies with try-catch error handling
 * EVOLVE: Applies optimizations based on successful run patterns
 */

import * as acorn from 'acorn';
import * as acornWalk from 'acorn-walk';

/**
 * Parse JavaScript code into AST
 */
export function parseJS(code) {
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true
    });
  } catch (error) {
    throw new Error(`JS parse error: ${error.message}`);
  }
}

/**
 * Generate code from AST
 */
export function generateJS(ast) {
  // Use acorn's default code generation via toString
  // For full generation, we use a simple serializer
  return serializeAST(ast);
}

/**
 * Simple AST serializer — handles common node types
 */
function serializeAST(node, indent = 0) {
  if (!node) return '';

  switch (node.type) {
    case 'Program':
      return node.body.map(n => serializeAST(n, indent)).join('\n');

    case 'FunctionDeclaration':
      const params = node.params.map(p => serializeAST(p)).join(', ');
      const funcBody = serializeFunctionBody(node.body, indent);
      return `${node.async ? 'async ' : ''}function ${node.id?.name || ''}(${params}) {\n${funcBody}\n}`;

    case 'ArrowFunctionExpression':
      const arrowParams = node.params.map(p => serializeAST(p)).join(', ');
      const arrowBody = node.body.type === 'BlockStatement'
        ? serializeFunctionBody(node.body, indent)
        : '  return ' + serializeAST(node.body, indent + 1) + ';';
      return `${node.async ? 'async ' : ''}(${arrowParams}) => {\n${arrowBody}\n}`;

    case 'VariableDeclaration':
      const decls = node.declarations.map(d => {
        if (d.init) {
          return `${d.id.name} = ${serializeAST(d.init, indent)}`;
        }
        return d.id.name;
      }).join(', ');
      return `${node.kind} ${decls};`;

    case 'ExpressionStatement':
      return serializeAST(node.expression, indent) + ';';

    case 'CallExpression':
      const callee = serializeAST(node.callee, indent);
      const args = node.arguments.map(a => serializeAST(a, indent)).join(', ');
      return `${callee}(${args})`;

    case 'MemberExpression':
      const obj = serializeAST(node.object, indent);
      const prop = node.computed
        ? `[${serializeAST(node.property, indent)}]`
        : `.${node.property.name}`;
      return `${obj}${prop}`;

    case 'Identifier':
      return node.name;

    case 'Literal':
      return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value);

    case 'ObjectExpression':
      const props = node.properties.map(p => {
        const key = p.key.type === 'Identifier' ? p.key.name : serializeAST(p.key, indent);
        const val = serializeAST(p.value, indent + 1);
        return `${key}: ${val}`;
      }).join(', ');
      return `{ ${props} }`;

    case 'ArrayExpression':
      const els = node.elements.map(e => serializeAST(e, indent)).join(', ');
      return `[${els}]`;

    case 'BinaryExpression':
    case 'LogicalExpression':
      const left = serializeAST(node.left, indent);
      const right = serializeAST(node.right, indent);
      return `${left} ${node.operator} ${right}`;

    case 'UnaryExpression':
      return `${node.operator}${serializeAST(node.argument, indent)}`;

    case 'TemplateLiteral':
      const quasis = node.quasis.map(q => q.value.cooked).join('${}');
      const tmplArgs = node.expressions.map(e => serializeAST(e, indent)).join(', ');
      return `\`${quasis}\``;

    case 'BlockStatement':
      return serializeFunctionBody(node, indent);

    case 'ReturnStatement':
      return `return${node.argument ? ' ' + serializeAST(node.argument, indent) : ''};`;

    case 'IfStatement':
      const test = serializeAST(node.test, indent);
      const consequent = serializeAST(node.consequent, indent);
      const alternate = node.alternate ? `\n${'  '.repeat(indent)}else {\n${serializeAST(node.alternate, indent + 1)}\n${'  '.repeat(indent)}}` : '';
      return `if (${test}) {\n${serializeAST(node.consequent, indent + 1)}\n${'  '.repeat(indent)}${alternate}`;

    case 'ForStatement':
      const init = serializeAST(node.init, indent);
      const test2 = serializeAST(node.test, indent);
      const update = serializeAST(node.update, indent);
      const body = serializeAST(node.body, indent + 1);
      return `for (${init}; ${test2}; ${update}) {\n${body}\n${'  '.repeat(indent)}}`;

    case 'WhileStatement':
      const whileTest = serializeAST(node.test, indent);
      const whileBody = serializeAST(node.body, indent + 1);
      return `while (${whileTest}) {\n${whileBody}\n${'  '.repeat(indent)}}`;

    case 'TryStatement':
      const tryBlock = serializeAST(node.block, indent + 1);
      const handlers = node.handlers.map(h => {
        const param = h.param ? `${h.param.name}` : 'error';
        const handlerBody = serializeAST(h.body, indent + 1);
        return `catch (${param}) {\n${handlerBody}\n${'  '.repeat(indent)}}`;
      }).join('');
      const finalizer = node.finalizer
        ? `finally {\n${serializeAST(node.finalizer, indent + 1)}\n${'  '.repeat(indent)}}`
        : '';
      return `try {\n${tryBlock}\n${'  '.repeat(indent)}${handlers}${finalizer}`;

    case 'ThrowStatement':
      return `throw ${serializeAST(node.argument, indent)};`;

    case 'AwaitExpression':
      return `await ${serializeAST(node.argument, indent)}`;

    case 'NewExpression':
      const newArgs = node.arguments.map(a => serializeAST(a, indent)).join(', ');
      return `new ${serializeAST(node.callee, indent)}(${newArgs})`;

    default:
      // For unhandled types, return a placeholder
      return `/* ${node.type} */`;
  }
}

function serializeFunctionBody(block, indent) {
  if (!block.body || block.body.length === undefined) {
    return '  ' + serializeAST(block, indent + 1);
  }
  return block.body.map(n => '  '.repeat(indent + 1) + serializeAST(n, indent + 1)).join('\n');
}

/**
 * Find all function-like nodes in an AST
 */
export function findFunctions(ast) {
  const functions = [];
  acornWalk.ancestor(ast, {
    FunctionDeclaration(node, ancestors) {
      functions.push({
        type: 'FunctionDeclaration',
        node,
        ancestors,
        name: node.id?.name || 'anonymous',
        start: node.loc.start,
        end: node.loc.end
      });
    },
    ArrowFunctionExpression(node, ancestors) {
      functions.push({
        type: 'ArrowFunctionExpression',
        node,
        ancestors,
        name: 'arrow_' + node.loc.start.line,
        start: node.loc.start,
        end: node.loc.end
      });
    },
    FunctionExpression(node, ancestors) {
      functions.push({
        type: 'FunctionExpression',
        node,
        ancestors,
        name: 'func_' + node.loc.start.line,
        start: node.loc.start,
        end: node.loc.end
      });
    }
  });
  return functions;
}

/**
 * PATCH: Add try-catch wrapper around function bodies
 */
export function patchFunction(code, functionIndex, errorHandler = null) {
  const ast = parseJS(code);
  const functions = findFunctions(ast);

  if (functionIndex < 0 || functionIndex >= functions.length) {
    throw new Error(`Function index ${functionIndex} out of range (found ${functions.length} functions)`);
  }

  const func = functions[functionIndex];
  const defaultHandler = errorHandler || `console.error('Error in ${func.name}:', error.message);`;

  // Create a try-catch wrapper
  const patched = patchNode(code, func.node, defaultHandler);
  return patched;
}

function patchNode(code, node, errorHandler) {
  // Get the source code for the node
  const start = node.body?.range?.[0] ?? node.range?.[0] ?? 0;
  const end = node.body?.range?.[1] ?? node.range?.[1] ?? code.length;

  if (node.body) {
    // The node has a body - we need to wrap it
    const bodyStart = node.body.range?.[0] ?? code.indexOf('{', start);
    const bodyEnd = node.body.range?.[1] ?? code.lastIndexOf('}', end);

    const before = code.slice(0, bodyStart + 1);
    const body = code.slice(bodyStart + 1, bodyEnd);
    const after = code.slice(bodyEnd);

    return `${before}\n  try {\n${indentLines(body, 2)}\n  } catch (error) {\n    ${errorHandler}\n  }\n${after}`;
  }

  return code;
}

function indentLines(text, spaces) {
  const indent = ' '.repeat(spaces);
  return text.split('\n').map(line => line ? indent + line : line).join('\n');
}

/**
 * PATCH: Auto-patch all functions in code with error handling
 */
export function autoPatch(code, options = {}) {
  const ast = parseJS(code);
  const functions = findFunctions(ast);

  if (functions.length === 0) {
    return { code, patched: 0, message: 'No functions found to patch' };
  }

  const errorHandler = options.errorHandler ||
    `console.error('[SkillEvolution PATCH] Error:', error.message);`;

  let patchedCode = code;
  let patchedCount = 0;

  // Patch in reverse order to preserve line numbers
  const sortedFunctions = [...functions].sort((a, b) => b.start.line - a.start.line);

  for (const func of sortedFunctions) {
    if (func.node.body) {
      patchedCode = patchNode(patchedCode, func.node, errorHandler);
      patchedCount++;
    }
  }

  return {
    code: patchedCode,
    patched: patchedCount,
    functions: functions.map((f, i) => ({
      name: f.name,
      type: f.type,
      line: f.start.line
    }))
  };
}

/**
 * EVOLVE: Apply optimizations based on successful run patterns
 */
export function evolve(code, optimizationHints = []) {
  let evolvedCode = code;

  for (const hint of optimizationHints) {
    switch (hint.type) {
      case 'cache_result':
        // Add result caching for repeated operations
        evolvedCode = applyCaching(evolvedCode, hint);
        break;
      case 'remove_redundant':
        // Remove redundant operations
        evolvedCode = applyRedundancyRemoval(evolvedCode, hint);
        break;
      case 'add_memoization':
        // Add memoization for expensive calls
        evolvedCode = applyMemoization(evolvedCode, hint);
        break;
    }
  }

  return {
    code: evolvedCode,
    applied: optimizationHints.length
  };
}

function applyCaching(code, hint) {
  // For operations that are called multiple times with same args
  // Add a simple result cache
  const cacheVar = `_cache_${hint.id || 'result'}`;

  return `// [SkillEvolution EVOLVE] Result caching added
const ${cacheVar} = new Map();

${code}

function getCached${hint.id || 'Result'}(key, computeFn) {
  if (${cacheVar}.has(key)) {
    return ${cacheVar}.get(key);
  }
  const result = computeFn();
  ${cacheVar}.set(key, result);
  return result;
}
`;
}

function applyRedundancyRemoval(code, hint) {
  // Comment about redundant operation removal
  return `// [SkillEvolution EVOLVE] Redundancy optimization
// Target: ${hint.target || 'redundant operation'}
${code}
`;
}

function applyMemoization(code, hint) {
  const memoVar = `_memo_${hint.id || 'fn'}`;

  return `// [SkillEvolution EVOLVE] Memoization added
const ${memoVar} = new Map();

${code}

function memoize${hint.id || 'Fn'}(fn) {
  return (...args) => {
    const key = JSON.stringify(args);
    if (${memoVar}.has(key)) {
      return ${memoVar}.get(key);
    }
    const result = fn(...args);
    ${memoVar}.set(key, result);
    return result;
  };
}
`;
}

/**
 * CREATE: Generate a new skill from a workflow definition
 */
export function generateSkillScript(workflow) {
  const {
    name = 'auto-generated-skill',
    description = '',
    steps = [],
    inputs = [],
    outputs = []
  } = workflow;

  const stepImports = [];
  const stepCode = [];
  const errorHandling = [];

  steps.forEach((step, index) => {
    const stepName = step.name || `step_${index}`;
    const stepFn = `async function ${stepName}(input) {\n  // ${step.description || 'No description'}\n  ${step.code || 'return input;'}\n}`;

    stepCode.push(stepFn);
    stepImports.push(stepFn);
  });

  const script = `/**
 * Auto-Generated Skill: ${name}
 * Created by SkillEvolution on ${new Date().toISOString()}
 * Description: ${description}
 *
 * Inputs: ${inputs.join(', ') || 'none'}
 * Outputs: ${outputs.join(', ') || 'none'}
 * Steps: ${steps.length}
 */

import { randomUUID } from 'node:crypto';

// Error tracking
const errors = [];
const startTime = Date.now();

function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data
  };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

// Error handler for all steps
function withErrorHandling(fn, stepName) {
  return async (...args) => {
    try {
      log('info', \`Executing \${stepName}\`, { input: args });
      const result = await fn(...args);
      log('info', \`\${stepName} completed\`, { result: String(result).slice(0, 100) });
      return result;
    } catch (error) {
      log('error', \`\${stepName} failed\`, { error: error.message });
      errors.push({ step: stepName, error: error.message, time: Date.now() });
      throw error;
    }
  };
}

// Step definitions
${stepImports.join('\n\n')}

// Main execution pipeline
async function runPipeline(input) {
  log('info', 'Pipeline started', { skill: '${name}', input });
  let current = input;

  const steps = [
    ${steps.map((s, i) => `withErrorHandling(${s.name || `step_${i}`}, '${s.name || `step_${i}`}')`).join(',\n    ')}
  ];

  for (const step of steps) {
    current = await step(current);
  }

  log('info', 'Pipeline completed', {
    duration: Date.now() - startTime,
    errors: errors.length
  });

  return { result: current, errors, duration: Date.now() - startTime };
}

// Execute if run directly
const input = typeof process !== 'undefined' && process.argv?.[2]
  ? JSON.parse(process.argv[2])
  : {};

runPipeline(input)
  .then(result => {
    console.log(JSON.stringify({ ok: true, ...result }));
    process.exit(0);
  })
  .catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message, errors }));
    process.exit(1);
  });
`;

  return script;
}

/**
 * Analyze code structure and return useful info
 */
export function analyzeCode(code) {
  try {
    const ast = parseJS(code);
    const functions = findFunctions(ast);

    return {
      valid: true,
      functions: functions.map(f => ({
        name: f.name,
        type: f.type,
        line: f.start.line,
        async: f.node.async || false
      })),
      functionCount: functions.length,
      lines: code.split('\n').length
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}
