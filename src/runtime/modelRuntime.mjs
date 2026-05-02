import { readModelApiKey } from '../lib/secrets.mjs';

export async function testModelConnection(settings, timeoutMs = 15000) {
  const secret = readModelApiKey(settings.apiKeyEnv || 'AIAGENT_API_KEY');
  if (!settings.baseUrl) {
    return {
      ok: false,
      status: 'missing_base_url',
      message: 'Base URL 未配置'
    };
  }
  if (!secret.value) {
    return {
      ok: false,
      status: 'missing_api_key',
      message: 'API Key 未配置'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  // Detect provider from baseUrl
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const isMiniMax = baseUrl.includes('minimax.io');

  try {
    let response;
    if (isMiniMax) {
      response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${secret.value}`,
          'x-api-key': secret.value,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.model || 'MiniMax-M2.7',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK.' }]
        })
      });
    } else {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret.value}`
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-5.2',
          messages: [
            {
              role: 'user',
              content: 'Reply with OK.'
            }
          ],
          temperature: 0,
          max_tokens: 16
        })
      });
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        status: 'http_error',
        message: `HTTP ${response.status}: ${detail.slice(0, 240)}`,
        latencyMs
      };
    }

    const payload = await response.json();
    return {
      ok: true,
      status: 'ok',
      message: isMiniMax
        ? (payload?.content?.[0]?.text || 'OK')
        : (payload?.choices?.[0]?.message?.content || 'OK'),
      latencyMs,
      model: payload?.model || settings.model,
      apiKeySource: secret.source
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'timeout' : 'error',
      message: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}
