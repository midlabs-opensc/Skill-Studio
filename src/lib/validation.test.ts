import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, validateProjectPath, validateSlug } from './validation';
describe('validation', () => {
  it('accepts safe slugs', () => expect(validateSlug('support-triage-2')).toBe('support-triage-2'));
  it.each(['../escape', 'Upper', 'two--parts', ''])('rejects unsafe slug %s', value => expect(() => validateSlug(value)).toThrow());
  it('requires a project path', () => expect(() => validateProjectPath('  ')).toThrow());
  it('restricts Ollama to localhost', () => expect(() => normalizeBaseUrl('http://example.com:11434', 'ollama')).toThrow());
  it('requires HTTPS remotely', () => expect(() => normalizeBaseUrl('http://openrouter.ai/api/v1', 'openai-compatible')).toThrow());
  it('normalizes compatible URLs', () => expect(normalizeBaseUrl('https://openrouter.ai/api/v1/', 'openai-compatible')).toBe('https://openrouter.ai/api/v1'));
});
