export function validateSlug(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) throw new Error('Slug must be 1-64 lowercase letters, numbers, or single hyphens.');
  return value;
}

export function validateProjectPath(value: string): string {
  const path = value.trim();
  if (!path || path.includes('\0')) throw new Error('A valid project path is required.');
  return path;
}

export function normalizeBaseUrl(value: string, kind: 'ollama' | 'openai-compatible'): string {
  const url = new URL(value);
  if (kind === 'ollama' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Ollama is restricted to localhost.');
  if (kind === 'openai-compatible' && url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Remote endpoints must use HTTPS.');
  return url.toString().replace(/\/$/, '');
}
