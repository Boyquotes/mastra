/**
 * Custom OpenTelemetry span that preserves Mastra's trace and span IDs
 */

import { SpanType } from '@mastra/core/observability';
import type { AgentRunAttributes, AnyExportedSpan, MCPToolCallAttributes, ModelGenerationAttributes, ToolCallAttributes, WorkflowRunAttributes } from '@mastra/core/observability';
import { SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import type { SpanContext, SpanStatus, Attributes, Link, HrTime } from '@opentelemetry/api';
import type { InstrumentationScope } from '@opentelemetry/core';
import type { Resource } from '@opentelemetry/resources';
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base';
import { convertMastraMessagesToGenAIMessages } from './gen-ai-messages';

/**
 * A custom ReadableSpan implementation that preserves Mastra's IDs
 */
export class OtelSpan implements ReadableSpan {
  // from ReadableSpan
  readonly name: string;
  readonly kind: SpanKind;
  readonly spanContext: () => SpanContext;
  readonly parentSpanContext?: SpanContext;
  readonly startTime: HrTime;
  readonly endTime: HrTime;
  readonly status: SpanStatus;
  readonly attributes: Attributes;
  readonly links: Link[] = [];
  readonly events: TimedEvent[] = [];
  readonly duration: HrTime;
  readonly ended: boolean;
  readonly resource: Resource;
  readonly instrumentationScope: InstrumentationScope;
  readonly droppedAttributesCount: number = 0;
  readonly droppedEventsCount: number = 0;
  readonly droppedLinksCount: number = 0;

  constructor(params: {
    span: AnyExportedSpan,
    scope: InstrumentationScope,
    parentSpanId?: string,
    resource?: Resource,
  }) {

    const { span, scope, resource } = params;

    this.name = getSpanName(span);
    this.kind = getSpanKind(span.type);
    this.attributes = getAttributes(span);

    // Convert JavaScript Date to hrtime format [seconds, nanoseconds]
    this.startTime = dateToHrTime(span.startTime);
    this.endTime = span.endTime ? dateToHrTime(span.endTime) : this.startTime;
    this.ended = !!span.endTime;

    // Calculate duration
    if (span.endTime) {
      const durationMs = span.endTime.getTime() - span.startTime.getTime();
      this.duration = [Math.floor(durationMs / 1000), (durationMs % 1000) * 1000000];
    } else {
      this.duration = [0, 0];
    }

    // Set status based on error info
    if (span.errorInfo) {
      this.status = {
        code: SpanStatusCode.ERROR,
        message: span.errorInfo.message,
      };

      // Add error as event
      this.events.push({
        name: 'exception',
        attributes: {
          'exception.message': span.errorInfo.message,
          'exception.type': 'Error',
          ...(span.errorInfo.details?.stack && {
            'exception.stacktrace': span.errorInfo.details.stack as string,
          }),
        },
        time: this.startTime,
        droppedAttributesCount: 0,
      });
    } else if (span.endTime) {
      this.status = { code: SpanStatusCode.OK };
    } else {
      this.status = { code: SpanStatusCode.UNSET };
    }

    // Create span context with Mastra's IDs
    this.spanContext = () => ({
      traceId: span.traceId,
      spanId: span.id,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    });

    // Set parent span context if parent span ID is provided
    if (span.parentSpanId) {
      this.parentSpanContext = {
        traceId: span.traceId,
        spanId: span.parentSpanId,
        traceFlags: TraceFlags.SAMPLED,
        isRemote: false,
      };
    }

    // Set resource and instrumentation library
    this.resource = resource || ({} as Resource);
    this.instrumentationScope = scope;
  }
}

/**
 * Get the appropriate Otel SpanKind based on Mastra SpanType.
 *
 * @param type - The Mastra span type
 * @returns The appropriate OTEL SpanKind
 */
export function getSpanKind(type: SpanType): SpanKind {
  switch (type) {
    case SpanType.MODEL_GENERATION:
    case SpanType.MCP_TOOL_CALL:
      return SpanKind.CLIENT;
    default:
      return SpanKind.INTERNAL;
  }
}

/**
 * Convert JavaScript Date to hrtime format
 */
function dateToHrTime(date: Date): HrTime {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms % 1000) * 1000000;
  return [seconds, nanoseconds];
}

/**
 * Get the operation name based on span type for gen_ai.operation.name
 */
function getOperationName(span: AnyExportedSpan): string {
  switch (span.type) {
    case SpanType.MODEL_GENERATION:
      return 'chat';
    case SpanType.TOOL_CALL:
    case SpanType.MCP_TOOL_CALL:
      return 'execute_tool';
    case SpanType.AGENT_RUN:
      return 'invoke_agent';
    case SpanType.WORKFLOW_RUN:
      return 'invoke_workflow';
    default:
      return span.type.toLowerCase();
  }
}
/**
 * Keep only unicode letters, numbers, dot, underscore, space, dash.
 */
function sanitizeSpanName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "");
}

function getSpanIdentifier(span: AnyExportedSpan): string | null {
  switch (span.type) {
    case SpanType.MODEL_GENERATION: {
      const attrs = span.attributes as ModelGenerationAttributes;
      return attrs?.model ?? "unknown";
    }

    case SpanType.TOOL_CALL:
    case SpanType.MCP_TOOL_CALL: {
      const attrs = span.attributes as ToolCallAttributes | MCPToolCallAttributes;
      return attrs?.toolId ?? "unknown";
    }

    case SpanType.AGENT_RUN: {
      const attrs = span.attributes as AgentRunAttributes;
      return attrs?.agentName ?? attrs?.agentId ?? "unknown";
    }

    case SpanType.WORKFLOW_RUN: {
      const attrs = span.attributes as WorkflowRunAttributes;
      return attrs?.workflowId ?? "unknown";
    }

    default:
      return null;
  }
}

/**
 * Get an OTEL-compliant span name based on span type and attributes
 */
function getSpanName(span: AnyExportedSpan): string {
  const identifier = getSpanIdentifier(span);

  if (identifier) {
    const operation = getOperationName(span);
    return `${operation} ${identifier}`;
  }

  // For other types, use a simplified version of the original name
  return sanitizeSpanName(span.name);
}

  /**
   * Gets OpenTelemetry attributes from Mastra Span
   * Following OTEL Semantic Conventions for GenAI
   */
  function getAttributes(span: AnyExportedSpan): Attributes {
    const attributes: Attributes = {};
    const spanType = span.type.toLowerCase();

    // Add gen_ai.operation.name based on span type
    attributes['gen_ai.operation.name'] = getOperationName(span);

    // Add span type for better visibility
    attributes['mastra.span.type'] = span.type;

    // Handle input/output based on span type
    // Always add input/output for Laminar compatibility
    if (span.input !== undefined) {
      const inputStr = typeof span.input === 'string' ? span.input : JSON.stringify(span.input);
      // Add specific attributes based on span type
      if (span.type === SpanType.MODEL_GENERATION) {
        attributes['gen_ai.input.messages'] =  convertMastraMessagesToGenAIMessages(inputStr);
      } else if (span.type === SpanType.TOOL_CALL || span.type === SpanType.MCP_TOOL_CALL) {
        attributes['gen_ai.tool.call.arguments'] = inputStr;
      } else {
        attributes[`mastra.${spanType}.input`] = inputStr;
      }
    }

    if (span.output !== undefined) {
      const outputStr = typeof span.output === 'string' ? span.output : JSON.stringify(span.output);
      // Add specific attributes based on span type
      if (span.type === SpanType.MODEL_GENERATION) {
        attributes['gen_ai.output.messages'] = convertMastraMessagesToGenAIMessages(outputStr);
        // TODO
        // attributes['gen_ai.output.type'] = image/json/speech/text/<other>
      } else if (span.type === SpanType.TOOL_CALL || span.type === SpanType.MCP_TOOL_CALL) {
        attributes['gen_ai.tool.call.result'] = outputStr;
      } else {
        attributes[`mastra.${spanType}.output`] = outputStr;
      }
    }

    // Add model-specific attributes using OTEL semantic conventions
    if (span.type === SpanType.MODEL_GENERATION && span.attributes) {
      const modelAttrs = span.attributes as ModelGenerationAttributes;

      // Model and provider
      if (modelAttrs.model) {
        attributes['gen_ai.request.model'] = modelAttrs.model;
      }

      if (modelAttrs.provider) {
        attributes['gen_ai.provider.name'] = normalizeProvider(modelAttrs.provider);
      }

      // Token usage - use OTEL standard naming
      if (modelAttrs.usage) {
        const inputTokens = modelAttrs.usage.inputTokens ?? modelAttrs.usage.promptTokens;
        const outputTokens = modelAttrs.usage.outputTokens ?? modelAttrs.usage.completionTokens;

        if (inputTokens !== undefined) {
          attributes['gen_ai.usage.input_tokens'] = inputTokens;
        }
        if (outputTokens !== undefined) {
          attributes['gen_ai.usage.output_tokens'] = outputTokens;
        }
        // Add other token metrics if present
        if (modelAttrs.usage.reasoningTokens !== undefined) {
          attributes['gen_ai.usage.reasoning_tokens'] = modelAttrs.usage.reasoningTokens;
        }
        if (modelAttrs.usage.cachedInputTokens !== undefined) {
          attributes['gen_ai.usage.cached_input_tokens'] = modelAttrs.usage.cachedInputTokens;
        }
      }

      // Parameters using OTEL conventions
      if (modelAttrs.parameters) {
        if (modelAttrs.parameters.temperature !== undefined) {
          attributes['gen_ai.request.temperature'] = modelAttrs.parameters.temperature;
        }
        if (modelAttrs.parameters.maxOutputTokens !== undefined) {
          attributes['gen_ai.request.max_tokens'] = modelAttrs.parameters.maxOutputTokens;
        }
        if (modelAttrs.parameters.topP !== undefined) {
          attributes['gen_ai.request.top_p'] = modelAttrs.parameters.topP;
        }
        if (modelAttrs.parameters.topK !== undefined) {
          attributes['gen_ai.request.top_k'] = modelAttrs.parameters.topK;
        }
        if (modelAttrs.parameters.presencePenalty !== undefined) {
          attributes['gen_ai.request.presence_penalty'] = modelAttrs.parameters.presencePenalty;
        }
        if (modelAttrs.parameters.frequencyPenalty !== undefined) {
          attributes['gen_ai.request.frequency_penalty'] = modelAttrs.parameters.frequencyPenalty;
        }
        if (modelAttrs.parameters.stopSequences) {
          attributes['gen_ai.request.stop_sequences'] = JSON.stringify(modelAttrs.parameters.stopSequences);
        }
        if (modelAttrs.parameters.seed) {
          attributes['gen_ai.request.seed'] = modelAttrs.parameters.seed
        }
      }

      // Response attributes
      if (modelAttrs.finishReason) {
        attributes['gen_ai.response.finish_reasons'] = JSON.stringify([modelAttrs.finishReason]);
      }
      if (modelAttrs.responseModel) {
        attributes['gen_ai.response.model'] = modelAttrs.responseModel;
      }
      if (modelAttrs.responseId) {
        attributes['gen_ai.response.id'] = modelAttrs.responseId;
      }

      // Server attributes
      if (modelAttrs.serverAddress) {
        attributes['server.address'] = modelAttrs.serverAddress;
      }
      if (modelAttrs.serverPort !== undefined) {
        attributes['server.port'] = modelAttrs.serverPort;
      }
    }

    // Add tool-specific attributes using OTEL conventions
    if ((span.type === SpanType.TOOL_CALL || span.type === SpanType.MCP_TOOL_CALL) && span.attributes) {
      const toolAttrs = span.attributes as ToolCallAttributes | MCPToolCallAttributes;

      // Tool identification
      if (toolAttrs.toolId) {
        attributes['gen_ai.tool.name'] = toolAttrs.toolId;
      }

      //TODO:
      // attributes['gen_ai.tool.call.id'] = call_mszuSIzqtI65i1wAUOE8w5H4
      // attributes['gen_ai.tool.type'] = function; extension; datastore

      // MCP-specific attributes
      if (span.type === SpanType.MCP_TOOL_CALL) {
        const mcpAttrs = toolAttrs as MCPToolCallAttributes;
        if (mcpAttrs.mcpServer) {
          attributes['server.address'] = mcpAttrs.mcpServer;
        }
      } else {
        if ((toolAttrs as ToolCallAttributes).toolDescription) {
          attributes['gen_ai.tool.description'] = (toolAttrs as ToolCallAttributes).toolDescription;
        }
      }
    }

    // Add agent-specific attributes
    if (span.type === SpanType.AGENT_RUN && span.attributes) {
      const agentAttrs = span.attributes as AgentRunAttributes;
      if (agentAttrs.agentId) {
        attributes['gen_ai.agent.id'] = agentAttrs.agentId;
      }
      if (agentAttrs.agentName) {
        attributes['gen_ai.agent.name'] = agentAttrs.agentName;
      }
      if (agentAttrs.conversationId) {
        attributes['gen_ai.conversation.id'] = agentAttrs.conversationId;
      }
      if (agentAttrs.maxSteps) {
        attributes[`mastra.${spanType}.max_steps`] = agentAttrs.maxSteps;
      }
      if (agentAttrs.availableTools) {
        attributes[`gen_ai.tool.definitions`] = JSON.stringify(agentAttrs.availableTools);
      }
      //TODO:
      // attributes['gen_ai.agent.description'] = agentAttrs.description;
      // attributes['gen_ai.request.model'] = agentAttrs.model.name;

      attributes['gen_ai.system_instructions'] = agentAttrs.instructions;
    }

    // Add error information if present
    if (span.errorInfo) {
      attributes['error.type'] = span.errorInfo.id || 'unknown';
      attributes['error.message'] = span.errorInfo.message;
      if (span.errorInfo.domain) {
        attributes['error.domain'] = span.errorInfo.domain;
      }
      if (span.errorInfo.category) {
        attributes['error.category'] = span.errorInfo.category;
      }
    }

    // Add metadata as custom attributes with proper typing
    if (span.metadata) {
      Object.entries(span.metadata).forEach(([k, v]) => {
        // Skip if attribute already exists
        if (!attributes[k]) {
          // Ensure value is a valid OTEL attribute type
          if (v === null || v === undefined) {
            return;
          }
          const value = typeof v === 'object' ? JSON.stringify(v) : v;
          const key = `mastra.metadata.${k}`;
          attributes[value] = key;
        }
      });
    }

    return attributes;
  }

/**
 * Canonical OTel provider keys mapped to a list of possible fuzzy aliases.
 */
const PROVIDER_ALIASES: Record<string, string[]> = {
  "anthropic": ["anthropic", "claude"],
  "aws.bedrock": ["awsbedrock", "bedrock", "amazonbedrock"],
  "azure.ai.inference": ["azureaiinference", "azureinference"],
  "azure.ai.openai": ["azureaiopenai", "azureopenai", "msopenai", "microsoftopenai"],
  "cohere": ["cohere"],
  "deepseek": ["deepseek"],
  "gcp.gemini": ["gcpgemini", "gemini"],
  "gcp.gen_ai": ["gcpgenai", "googlegenai", "googlegenai", "googleai"],
  "gcp.vertex_ai": ["gcpvertexai", "vertexai"],
  "groq": ["groq"],
  "ibm.watsonx.ai": ["ibmwatsonxai", "watsonx", "watsonxai"],
  "mistral_ai": ["mistral", "mistralai"],
  "openai": ["openai", "oai"],
  "perplexity": ["perplexity", "pplx"],
  "x_ai": ["xai", "x-ai", "x_ai", "x.com ai"],
};

/**
 * Normalize a provider input string into a matchable token.
 * Keep only alphanumerics and lowercase the result.
 */
function normalizeProviderString(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Attempts to map a providerName to one of the canonical OTel provider names.
 * If no match is found, returns the original providerName unchanged.
 */
function normalizeProvider(providerName: string): string {
  const normalized = normalizeProviderString(providerName);

  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    for (const alias of aliases) {
      if (normalized === alias) {
        return canonical;
      }
    }
  }

  // No match → return the raw input in lowercase
  return providerName.toLowerCase();
}
