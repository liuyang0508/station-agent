import { execFileSync } from 'node:child_process';

const SERVICE = 'AIAgent Client';
const MODEL_KEY_ACCOUNT = 'model-api-key';

function runSecurity(args) {
  return execFileSync('/usr/bin/security', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

export function readModelApiKey(envName = 'AIAGENT_API_KEY') {
  if (envName && process.env[envName]) {
    return {
      value: process.env[envName],
      source: 'env'
    };
  }

  if (process.platform !== 'darwin') {
    return { value: '', source: 'none' };
  }

  try {
    return {
      value: runSecurity([
        'find-generic-password',
        '-s',
        SERVICE,
        '-a',
        MODEL_KEY_ACCOUNT,
        '-w'
      ]),
      source: 'keychain'
    };
  } catch {
    return { value: '', source: 'none' };
  }
}

export function writeModelApiKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) {
    throw new Error('API Key 不能为空');
  }

  if (process.platform !== 'darwin') {
    throw new Error('当前只支持 macOS Keychain 保存 API Key');
  }

  try {
    runSecurity(['delete-generic-password', '-s', SERVICE, '-a', MODEL_KEY_ACCOUNT]);
  } catch {
    // Ignore missing keychain item.
  }

  runSecurity([
    'add-generic-password',
    '-U',
    '-s',
    SERVICE,
    '-a',
    MODEL_KEY_ACCOUNT,
    '-w',
    value
  ]);

  return { source: 'keychain' };
}

export function deleteModelApiKey() {
  if (process.platform !== 'darwin') {
    return { deleted: false };
  }

  try {
    runSecurity(['delete-generic-password', '-s', SERVICE, '-a', MODEL_KEY_ACCOUNT]);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}
