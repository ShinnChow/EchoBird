import { describe, expect, it } from 'vitest';
import catalog from './freeModels.json';
import publicCatalog from '../../docs/api/free-models/index.json';

describe('free model catalog', () => {
  it('contains unique, directly configurable model entries', () => {
    expect(catalog.models.length).toBeGreaterThan(20);
    expect(new Set(catalog.models.map((model) => model.id)).size).toBe(catalog.models.length);

    for (const model of catalog.models) {
      expect(model.modelId).not.toBe('');
      expect(model.baseUrl.startsWith('https://')).toBe(true);
      expect(model.baseUrl).not.toContain('{');
      expect(model.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps the bundled fallback synchronized with the public directory', () => {
    expect(catalog).toEqual(publicCatalog);
    expect(catalog).not.toHaveProperty('source');
  });
});
