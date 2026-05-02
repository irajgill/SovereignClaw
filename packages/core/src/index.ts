/**
 * @sovereignclaw/core - agent runtime, inference adapter, tool runtime.
 *
 * Public exports as of Step 1.3 turn B:
 *   - Agent class and lifecycle hook context types
 *   - sealed0GInference adapter
 *   - Tool interface, defineTool, executeTool
 *   - httpRequestTool built-in
 *   - Typed event emitter
 *   - All typed errors
 */
export const VERSION = '0.0.0';

export {
  Agent,
  AgentClosedError,
  type AgentConfig,
  type BeforeRunContext,
  type AfterRunContext,
  type OnErrorContext,
} from './agent.js';

export { type AgentEvents, type AgentEventName, type AgentEventHandler } from './events.js';

export {
  sealed0GInference,
  type ChatMessage,
  type InferenceOptions,
  type InferenceAdapter,
  type InferenceResult,
  type Attestation,
  type BillingInfo,
} from './inference.js';

export {
  defineTool,
  executeTool,
  httpRequestTool,
  type Tool,
  type HttpRequestOptions,
} from './tools.js';

export {
  CoreError,
  InferenceError,
  RouterAuthError,
  RouterBalanceError,
  RouterClientError,
  RouterServerError,
  InferenceTimeoutError,
  EmptyInferenceResponseError,
  DirectModeUnsupportedError,
  ToolError,
  ToolValidationError,
  ToolExecutionError,
  ToolTimeoutError,
} from './errors.js';
