import { describe, expect, it } from 'vitest';
import {
  CoreError,
  DirectModeUnsupportedError,
  EmptyInferenceResponseError,
  InferenceError,
  InferenceTimeoutError,
  RouterAuthError,
  RouterBalanceError,
  RouterClientError,
  RouterServerError,
  ToolError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
} from '../src/errors.js';

describe('errors', () => {
  it('all errors extend CoreError', () => {
    const samples: CoreError[] = [
      new RouterAuthError(),
      new RouterBalanceError('https://example.com'),
      new RouterClientError(400, 'bad'),
      new RouterServerError(500, 'fail'),
      new InferenceTimeoutError(1000),
      new EmptyInferenceResponseError('{}'),
      new DirectModeUnsupportedError('providerAddress'),
      new ToolValidationError('t', []),
      new ToolExecutionError('t', new Error('boom')),
      new ToolTimeoutError('t', 100),
    ];

    for (const error of samples) {
      expect(error).toBeInstanceOf(CoreError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
    }
  });

  it('inference errors share the InferenceError base', () => {
    expect(new RouterAuthError()).toBeInstanceOf(InferenceError);
    expect(new RouterBalanceError('x')).toBeInstanceOf(InferenceError);
    expect(new InferenceTimeoutError(1)).toBeInstanceOf(InferenceError);
  });

  it('tool errors share the ToolError base', () => {
    expect(new ToolValidationError('t', [])).toBeInstanceOf(ToolError);
    expect(new ToolExecutionError('t', new Error())).toBeInstanceOf(ToolError);
    expect(new ToolTimeoutError('t', 100)).toBeInstanceOf(ToolError);
  });

  it('RouterBalanceError surfaces the deposit URL', () => {
    const error = new RouterBalanceError('https://pc.testnet.0g.ai');
    expect(error.depositUrl).toBe('https://pc.testnet.0g.ai');
    expect(error.message).toContain('https://pc.testnet.0g.ai');
  });

  it('RouterClientError preserves status and body', () => {
    const error = new RouterClientError(404, 'model not found');
    expect(error.status).toBe(404);
    expect(error.body).toBe('model not found');
  });

  it('ToolExecutionError carries the underlying cause', () => {
    const root = new Error('root');
    const error = new ToolExecutionError('mytool', root);
    expect(error.cause).toBe(root);
    expect(error.toolName).toBe('mytool');
  });
});
