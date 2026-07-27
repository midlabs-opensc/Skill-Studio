import type { ProviderSettings, Skill, TestCase } from '../types';
import { aiProvider } from './ai';

function evaluateOutput(test: TestCase, output: string): { passed: boolean; expectation: string } {
  const assertion = test.assertion ?? 'contains';
  const expected = test.expected.trim();
  const actualText = test.caseSensitive ? output : output.toLowerCase();
  const expectedText = test.caseSensitive ? expected : expected.toLowerCase();
  const number = Number(expected);
  switch (assertion) {
    case 'not-contains': return { passed: !actualText.includes(expectedText), expectation: `not contain: ${expected}` };
    case 'equals': return { passed: actualText.trim() === expectedText, expectation: `equal: ${expected}` };
    case 'not-equals': return { passed: actualText.trim() !== expectedText, expectation: `not equal: ${expected}` };
    case 'starts-with': return { passed: actualText.trimStart().startsWith(expectedText), expectation: `start with: ${expected}` };
    case 'ends-with': return { passed: actualText.trimEnd().endsWith(expectedText), expectation: `end with: ${expected}` };
    case 'regex': {
      try { return { passed: new RegExp(expected, test.caseSensitive ? '' : 'i').test(output), expectation: `match regex: ${expected}` }; }
      catch { return { passed: false, expectation: `use a valid regex: ${expected}` }; }
    }
    case 'length-greater': return { passed: Number.isFinite(number) && output.length > number, expectation: `have more than ${expected} characters` };
    case 'length-less': return { passed: Number.isFinite(number) && output.length < number, expectation: `have fewer than ${expected} characters` };
    case 'word-count-greater': return { passed: Number.isFinite(number) && output.trim().split(/\s+/).filter(Boolean).length > number, expectation: `have more than ${expected} words` };
    case 'word-count-less': return { passed: Number.isFinite(number) && output.trim().split(/\s+/).filter(Boolean).length < number, expectation: `have fewer than ${expected} words` };
    case 'valid-json': {
      try { JSON.parse(output); return { passed: true, expectation: 'be valid JSON' }; }
      catch { return { passed: false, expectation: 'be valid JSON' }; }
    }
    default: return { passed: expected ? actualText.includes(expectedText) : Boolean(output.trim()), expectation: expected ? `contain: ${expected}` : 'be non-empty' };
  }
}

export async function executeTests(cases: TestCase[], provider: ProviderSettings, skills: Skill[], apiKey?: string): Promise<TestCase[]> {
  return Promise.all(cases.map(async (test) => { const started = Date.now(); try { const skill = skills.find((item) => item.id === test.skillId); if (!skill) throw new Error('Selected skill no longer exists.'); const result = await aiProvider.chat({ provider, apiKey, messages: [{ role: 'system', content: skill.content || skill.description }, { role: 'user', content: test.input }] }); const evaluation = evaluateOutput(test, result.content); return { ...test, status: evaluation.passed ? 'passed' : 'failed', score: evaluation.passed ? 100 : 0, duration: `${result.durationMs}ms`, lastRunAt: new Date().toISOString(), error: evaluation.passed ? undefined : `Expected output to ${evaluation.expectation}.` }; } catch (error) { return { ...test, status: 'failed', score: 0, duration: `${Date.now() - started}ms`, lastRunAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }; } }));
}
