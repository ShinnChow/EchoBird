import { describe, it, expect } from 'vitest';
import { getModelIcon } from './ModelCard';

describe('getModelIcon', () => {
  it('maps OpenCode Zen / Go provider rows to the opencode icon', () => {
    // Provider/directory rows pass modelId='' — the vendor name must win.
    expect(getModelIcon('OpenCode Zen', '')).toBe('./icons/models/opencode.svg');
    expect(getModelIcon('OpenCode Go', '')).toBe('./icons/models/opencode.svg');
  });

  it('keeps the model brand winning over the OpenCode gateway for real ids', () => {
    // A model configured through OpenCode Zen still shows its own brand logo,
    // because the id identifies the actual model (claude/gpt/deepseek), not
    // the gateway. The opencode rule sits below the model-brand rules.
    expect(getModelIcon('', 'claude-sonnet-5')).toBe('./icons/models/claude.svg');
    expect(getModelIcon('', 'deepseek-v4-pro')).toBe('./icons/models/deepseek.svg');
    expect(getModelIcon('', 'gpt-5.5')).toBe('./icons/models/chatgpt.svg');
  });
});
