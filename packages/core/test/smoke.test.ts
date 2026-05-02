import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@sovereignclaw/core', () => {
  it('exposes a version constant', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
