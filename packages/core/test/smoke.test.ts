import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('@sovereignclaw/core barrel', () => {
  it('exposes VERSION', () => {
    expect(core.VERSION).toBe('0.0.0');
  });

  it('exposes Agent', () => {
    expect(typeof core.Agent).toBe('function');
    expect(core.AgentClosedError.prototype).toBeInstanceOf(core.CoreError);
  });

  it('exposes inference', () => {
    expect(typeof core.sealed0GInference).toBe('function');
  });

  it('exposes tools', () => {
    expect(typeof core.defineTool).toBe('function');
    expect(typeof core.executeTool).toBe('function');
    expect(typeof core.httpRequestTool).toBe('function');
  });

  it('exposes typed error classes', () => {
    expect(core.CoreError.prototype).toBeInstanceOf(Error);
    expect(core.InferenceError.prototype).toBeInstanceOf(core.CoreError);
    expect(core.RouterAuthError.prototype).toBeInstanceOf(core.InferenceError);
    expect(core.RouterBalanceError.prototype).toBeInstanceOf(core.InferenceError);
    expect(core.ToolError.prototype).toBeInstanceOf(core.CoreError);
    expect(core.ToolValidationError.prototype).toBeInstanceOf(core.ToolError);
  });
});
