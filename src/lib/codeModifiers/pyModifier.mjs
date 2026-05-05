/**
 * Python Code Modifier — AST-based code transformation
 *
 * Uses Python's built-in ast module via subprocess for:
 * PATCH: Wraps function bodies with try-except error handling
 * EVOLVE: Applies optimizations based on successful run patterns
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(require('node:child_process').execFile);

/**
 * Run Python code and return output
 */
async function runPython(code) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', code], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * PATCH: Add try-except wrapper around function bodies
 */
export async function patchPython(code, options = {}) {
  const {
    errorHandler = `print(f"[SkillEvolution PATCH] Error: {e}")`,
    targetFunctions = null // null = all functions
  } = options;

  const patcherCode = `
import ast
import sys

original_code = sys.stdin.read()

class FunctionPatcher(ast.NodeTransformer):
    def __init__(self, error_handler, target_functions):
        super().__init__()
        self.error_handler = error_handler
        self.target_functions = target_functions or []

    def visit_FunctionDef(self, node):
        if self.target_functions and node.name not in self.target_functions:
            return node

        # Create try-except wrapper
        try_block = ast.Try(
            body=node.body,
            handlers=[
                ast.ExceptHandler(
                    type=ast.Name(id='Exception', ctx=ast.Load()),
                    name='e',
                    body=[
                        ast.Expr(value=ast.Constant(value=self.error_handler)),
                        ast.Expr(value=ast.Call(
                            func=ast.Attribute(
                                value=ast.Name(id='print', ctx=ast.Load()),
                                attr='flush',
                                ctx=ast.Load()
                            ),
                            args=[],
                            keywords=[]
                        ))
                    ]
                )
            ],
            orelse=[],
            finalbody=[]
        )

        new_node = ast.FunctionDef(
            name=node.name,
            args=node.args,
            body=[try_block],
            decorator_list=node.decorator_list,
            returns=node.returns,
            type_comment=node.type_comment
        )
        return new_node

    def visit_AsyncFunctionDef(self, node):
        if self.target_functions and node.name not in self.target_functions:
            return node

        try_block = ast.Try(
            body=node.body,
            handlers=[
                ast.ExceptHandler(
                    type=ast.Name(id='Exception', ctx=ast.Load()),
                    name='e',
                    body=[
                        ast.Expr(value=ast.Constant(value=self.error_handler))
                    ]
                )
            ],
            orelse=[],
            finalbody=[]
        )

        new_node = ast.AsyncFunctionDef(
            name=node.name,
            args=node.args,
            body=[try_block],
            decorator_list=node.decorator_list,
            returns=node.returns,
            type_comment=node.type_comment
        )
        return new_node

try:
    tree = ast.parse(original_code)
    patcher = FunctionPatcher(${JSON.stringify(errorHandler)}, ${JSON.stringify(targetFunctions)})
    patched_tree = patcher.visit(tree)
    patched_tree = ast.fix_missing_locations(patched_tree)

    # Unparse to code
    import astor
    result = astor.to_source(patched_tree)
    print(result)
except SyntaxError as e:
    print(original_code)
    sys.exit(1)
except ImportError:
    # Fallback if astor not available - use unparse from ast module (Python 3.9+)
    import warnings
    warnings.filterwarnings('ignore')
    result = ast.unparse(patched_tree)
    print(result)
`;

  try {
    const { stdout, stderr, exitCode } = await runPython(patcherCode);

    if (exitCode !== 0) {
      // If patching fails, return original code with warning
      return {
        code: `# [SkillEvolution PATCH] Failed to patch Python code
# Error: ${stderr || 'Unknown error'}
${code}`,
        patched: 0,
        error: stderr || 'Patching failed'
      };
    }

    return {
      code: stdout,
      patched: stdout !== code ? 1 : 0
    };
  } catch (error) {
    return {
      code: `# [SkillEvolution PATCH] Python modifier unavailable
${code}`,
      patched: 0,
      error: error.message
    };
  }
}

/**
 * EVOLVE: Apply optimizations based on successful run patterns
 */
export async function evolvePython(code, optimizationHints = []) {
  let evolvedCode = code;

  for (const hint of optimizationHints) {
    switch (hint.type) {
      case 'add_result_cache':
        evolvedCode = addPythonCache(evolvedCode, hint);
        break;
      case 'optimize_imports':
        evolvedCode = optimizePythonImports(evolvedCode);
        break;
      case 'add_logging':
        evolvedCode = addPythonLogging(evolvedCode, hint);
        break;
    }
  }

  return {
    code: evolvedCode,
    applied: optimizationHints.length
  };
}

function addPythonCache(code, hint) {
  const cacheVar = hint.id ? `_cache_${hint.id}` : '_result_cache';
  const cacheImpl = `
# [SkillEvolution EVOLVE] Result caching added
from functools import lru_cache

${cacheVar} = {}

def get_cached(key, compute_fn):
    if key in ${cacheVar}:
        return ${cacheVar}[key]
    result = compute_fn()
    ${cacheVar}[key] = result
    return result

`;
  return cacheImpl + code;
}

function optimizePythonImports(code) {
  // Sort and deduplicate imports
  const lines = code.split('\n');
  const imports = [];
  const others = [];

  for (const line of lines) {
    if (/^(import|from)\s+/.test(line.trim())) {
      imports.push(line.trim());
    } else {
      others.push(line);
    }
  }

  // Deduplicate and sort
  const uniqueImports = [...new Set(imports)].sort();

  return `# [SkillEvolution EVOLVE] Optimized imports
${uniqueImports.join('\n')}

${others.join('\n')}`;
}

function addPythonLogging(code, hint) {
  const level = hint.level || 'INFO';
  const loggingImport = `
# [SkillEvolution EVOLVE] Logging added
import logging
logging.basicConfig(level=logging.${level})
logger = logging.getLogger('${hint.skillName || 'skill'}')

`;

  // Add try-except wrapper at module level would be complex
  // Just add the import for now
  return loggingImport + code;
}

/**
 * CREATE: Generate a new Python skill from a workflow definition
 */
export function generatePythonSkill(workflow) {
  const {
    name = 'auto-generated-skill',
    description = '',
    steps = [],
    inputs = [],
    outputs = []
  } = workflow;

  const stepFunctions = steps.map((step, index) => {
    const stepName = step.name || `step_${index}`;
    return `
async def ${stepName}(input_data):
    """${step.description || 'No description'}"""
    # ${step.code || 'return input_data'}
    return input_data
`;
  }).join('\n');

  const stepCalls = steps.map((step, index) => {
    const stepName = step.name || `step_${index}`;
    return `    result = await ${stepName}(result)`;
  }).join('\n');

  const script = `#!/usr/bin/env python3
"""
Auto-Generated Skill: ${name}
Created by SkillEvolution on ${new Date().toISOString()}
Description: ${description}

Inputs: ${inputs.join(', ') || 'none'}
Outputs: ${outputs.join(', ') || 'none'}
"""

import sys
import json
import asyncio
from datetime import datetime

# Error tracking
errors = []
start_time = datetime.now()

def log(level, message, **data):
    """Simple logging function"""
    timestamp = datetime.now().isoformat()
    entry = {
        'timestamp': timestamp,
        'level': level,
        'message': message,
        **data
    }
    print(json.dumps(entry), file=sys.stderr if level == 'error' else sys.stdout)

async def with_error_handling(fn, step_name):
    """Wrapper that adds error handling to a step"""
    async def wrapper(*args, **kwargs):
        try:
            log('INFO', f'Executing {step_name}', args=str(args)[:100])
            result = await fn(*args, **kwargs)
            log('INFO', f'{step_name} completed')
            return result
        except Exception as e:
            log('ERROR', f'{step_name} failed', error=str(e))
            errors.append({'step': step_name, 'error': str(e), 'time': datetime.now().isoformat()})
            raise
    return wrapper

# Step definitions
${stepFunctions}

async def run_pipeline(input_data):
    """Main execution pipeline"""
    log('INFO', 'Pipeline started', skill='${name}')
    result = input_data

    steps = [
        ${steps.map((s, i) => `with_error_handling(${s.name || `step_${i}`}, '${s.name || `step_${i}`}')`).join(',\n        ')}
    ]

    for step in steps:
        result = await step(result)

    duration = (datetime.now() - start_time).total_seconds() * 1000
    log('INFO', 'Pipeline completed', duration_ms=duration, error_count=len(errors))

    return result

async def main():
    """Entry point"""
    try:
        # Parse input from command line or use default
        if len(sys.argv) > 1:
            input_data = json.loads(sys.argv[1])
        else:
            input_data = {}

        result = await run_pipeline(input_data)

        output = {
            'ok': True,
            'result': result,
            'errors': errors,
            'duration_ms': (datetime.now() - start_time).total_seconds() * 1000
        }

        print(json.dumps(output))
        sys.exit(0)

    except Exception as e:
        output = {
            'ok': False,
            'error': str(e),
            'errors': errors
        }
        print(json.dumps(output))
        sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main())
`;

  return script;
}

/**
 * Analyze Python code structure
 */
export async function analyzePython(code) {
  const analyzerCode = `
import ast
import sys

code = sys.stdin.read()
try:
    tree = ast.parse(code)

    functions = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({
                'name': node.name,
                'type': 'async' if isinstance(node, ast.AsyncFunctionDef) else 'sync',
                'line': node.lineno
            })

    print(json.dumps({
        'valid': True,
        'functions': functions,
        'functionCount': len(functions),
        'lines': len(code.split('\\n'))
    }))
except SyntaxError as e:
    print(json.dumps({'valid': False, 'error': str(e)}))
`;

  try {
    const { stdout, exitCode } = await runPython(analyzerCode);
    if (exitCode === 0) {
      return JSON.parse(stdout);
    }
    return { valid: false, error: stdout };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
