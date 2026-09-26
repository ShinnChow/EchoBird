import { describe, expect, it } from 'vitest';
import { selectAgentProtocol } from './MotherAgentProvider';

describe('Mother Agent protocol selection', () => {
  it('prefers the OpenAI endpoint when a model provides both endpoints', () => {
    expect(selectAgentProtocol('https://api.x.ai/v1', 'https://api.x.ai')).toEqual({
      provider: 'openai',
      anthropicUrl: undefined,
    });
  });

  it('uses Anthropic only for Anthropic-only models', () => {
    expect(selectAgentProtocol('', 'https://api.anthropic.com')).toEqual({
      provider: 'anthropic',
      anthropicUrl: 'https://api.anthropic.com',
    });
  });
});
