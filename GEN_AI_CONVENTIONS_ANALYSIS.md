# OpenTelemetry Gen_AI Conventions - Gap Analysis

## Executive Summary

The Mastra `otel-exporter` package currently implements a partial subset of the OpenTelemetry GenAI semantic conventions. This document identifies gaps and provides recommendations for achieving full compliance with the spec.

**Status**: ~60% compliant with core conventions, missing several required and recommended attributes.

## Current Implementation Review

### Location
Primary implementation: `observability/otel-exporter/src/span-converter.ts`

### What's Working Well ✓

The current implementation correctly handles:

1. **Model Span Attributes**:
   - ✓ `gen_ai.operation.name` (line 131)
   - ✓ `gen_ai.request.model` (line 180)
   - ✓ Token usage metrics: `gen_ai.usage.{input_tokens,output_tokens,total_tokens}` (lines 194-200)
   - ✓ Request parameters: `gen_ai.request.{temperature,max_tokens,top_p,top_k,presence_penalty,frequency_penalty}` (lines 214-234)
   - ✓ `gen_ai.response.finish_reasons` (line 239)

2. **Tool Attributes**:
   - ✓ `gen_ai.tool.name` (line 249)
   - ✓ `gen_ai.tool.success` (line 269)

3. **Agent Attributes**:
   - ✓ `gen_ai.agent.id` (line 278)

4. **Span Naming**:
   - ✓ Model spans: `{operation} {model}` format (lines 88-91)

## Gap Analysis

### 1. Required Attributes (CRITICAL)

#### Missing: `gen_ai.provider.name`
- **Current**: Using non-standard `gen_ai.system` (line 184)
- **Spec**: Must use `gen_ai.provider.name`
- **Values**: `openai`, `aws.bedrock`, `gcp.vertex_ai`, `anthropic`, etc.
- **Impact**: HIGH - Required attribute for proper provider identification

**Location**: `span-converter.ts:184`
```typescript
// Current (non-compliant)
if (modelAttrs.provider) {
  attributes['gen_ai.system'] = modelAttrs.provider;
}

// Should be
if (modelAttrs.provider) {
  attributes['gen_ai.provider.name'] = modelAttrs.provider;
}
```

#### Missing: `error.type` (conditionally required)
- **Current**: Using custom error attributes `error.type`, `error.message` (lines 302-303)
- **Spec**: `error.type` is required when operation fails
- **Status**: PARTIAL - attribute exists but may not follow spec format
- **Impact**: MEDIUM - Required for error reporting

**Recommendation**: Verify error.type values follow the spec's enumeration or use error class names.

### 2. Recommended Attributes (HIGH PRIORITY)

#### Missing: `gen_ai.response.model`
- **Current**: Only capturing request model
- **Spec**: The actual model used in the response (may differ from request)
- **Impact**: MEDIUM - Important for tracking model routing/aliasing

**Required changes**:
1. Add `responseModel` field to `ModelGenerationAttributes` in `packages/core/src/observability/types/tracing.ts`
2. Capture actual model from LLM response
3. Add to span attributes as `gen_ai.response.model`

#### Missing: `gen_ai.response.id`
- **Current**: Not captured
- **Spec**: Unique identifier for the response (e.g., OpenAI's `response.id`)
- **Impact**: MEDIUM - Useful for debugging and correlation

#### Missing: `server.address` and `server.port`
- **Current**: Not captured
- **Spec**: Server address and port for the model endpoint
- **Impact**: LOW - Helpful for debugging multi-region/multi-endpoint scenarios

### 3. Agent Span Improvements

#### Missing: `gen_ai.agent.name`
- **Current**: Only have `gen_ai.agent.id` and `agent.id`
- **Spec**: Human-readable agent name (recommended)
- **Impact**: MEDIUM - Improves observability UX

**Required changes**:
1. Add `agentName` to `AgentRunAttributes` in tracing types
2. Map to `gen_ai.agent.name` attribute

**Location**: `span-converter.ts:274-286`
```typescript
// Add this
if (agentAttrs.agentName) {
  attributes['gen_ai.agent.name'] = agentAttrs.agentName;
}
```

#### Missing: `gen_ai.conversation.id`
- **Current**: Not captured
- **Spec**: Session/conversation/thread identifier
- **Impact**: HIGH - Critical for multi-turn conversation tracking

**Required changes**:
1. Add conversation/thread tracking to agent context
2. Add `conversationId` or `threadId` to `AgentRunAttributes`
3. Map to `gen_ai.conversation.id` in span converter

### 4. Span Naming Improvements

#### Agent Spans
- **Current**: `agent.{agentId}` (line 104)
- **Spec**: `invoke_agent {gen_ai.agent.name}` or `create_agent {gen_ai.agent.name}`
- **Impact**: MEDIUM - Better semantic clarity

**Recommendation**:
```typescript
// Current
return `agent.${agentId}`;

// Should be (when agent name is available)
const agentName = agentAttrs?.agentName || agentId;
return `invoke_agent ${agentName}`;
```

#### Operation Names
- **Current**: 'chat', 'tool_selection' (line 350)
- **Spec**: 'chat', 'generate_content', 'text_completion'
- **Status**: PARTIAL - 'chat' is correct, 'tool_selection' is Mastra-specific
- **Impact**: LOW - Current naming is descriptive and useful

**Recommendation**: Keep current operation names, they provide useful distinction.

### 5. Opt-In Content Attributes (PRIVACY SENSITIVE)

These attributes contain potentially sensitive information and should be opt-in only:

#### Missing: `gen_ai.input.messages`
- **Spec**: Structured message history in specific JSON format
- **Current**: Partial implementation exists in `observability/arize/src/gen-ai.ts`
- **Impact**: HIGH - Critical for debugging and replay
- **Status**: Foundation exists but not integrated into otel-exporter

**Found**: `convertMastraMessagesToGenAIMessages` function already exists in Arize exporter!

**Location**: `observability/arize/src/gen-ai.ts:89-162`

**Recommendation**:
1. Extract this conversion utility to a shared location
2. Add opt-in flag to `OtelExporterConfig`:
   ```typescript
   interface OtelExporterConfig {
     // ... existing config
     includeContentAttributes?: boolean; // or more granular options
   }
   ```
3. Apply conversion when flag is enabled

#### Missing: `gen_ai.output.messages`
- **Spec**: Structured output messages
- **Current**: Using generic `output` and `gen_ai.completion` fields
- **Impact**: HIGH - Important for conversation tracking
- **Status**: Can reuse same converter as input.messages

#### Missing: `gen_ai.system_instructions`
- **Current**: Not captured
- **Available**: Agent has `instructions` field in `AgentRunAttributes` (line 68)
- **Impact**: MEDIUM - Useful for debugging prompt engineering
- **Status**: Data available, needs mapping

**Location**: Add to `span-converter.ts` around line 280:
```typescript
if (agentAttrs.instructions) {
  attributes['gen_ai.system_instructions'] = agentAttrs.instructions;
}
```

#### Missing: `gen_ai.tool.definitions`
- **Current**: Have `agent.available_tools` as JSON array of names (line 284)
- **Spec**: Full tool schema definitions in structured format
- **Impact**: MEDIUM - Useful for tool-use analysis
- **Status**: Would require significant data capture changes

### 6. Additional Token Metrics

#### Well Supported ✓
The implementation already handles extended token metrics:
- ✓ `gen_ai.usage.reasoning_tokens` (line 204)
- ✓ `gen_ai.usage.cached_input_tokens` (line 208)

**Note**: These aren't in the base spec yet but are useful extensions.

## Recommendations

### Priority 1: Critical Compliance (Required Attributes)
1. **Rename `gen_ai.system` → `gen_ai.provider.name`** ⚠️ BREAKING
   - Simple find-replace in span-converter.ts
   - Update documentation
   - Add migration guide if users query this attribute

2. **Verify `error.type` compliance**
   - Ensure values follow spec format
   - Map Mastra error types to standard error classes

### Priority 2: High-Value Improvements
3. **Add conversation/thread tracking**
   - Add `gen_ai.conversation.id` support
   - Most impactful for multi-turn agent conversations

4. **Implement opt-in message content attributes**
   - Reuse `convertMastraMessagesToGenAIMessages` from Arize
   - Add `includeContentAttributes` config flag
   - Support both `gen_ai.input.messages` and `gen_ai.output.messages`

5. **Add agent name support**
   - Capture `gen_ai.agent.name`
   - Update span naming to use agent name

### Priority 3: Enhanced Observability
6. **Capture response metadata**
   - `gen_ai.response.model` - actual model used
   - `gen_ai.response.id` - unique response identifier

7. **Add server endpoint tracking**
   - `server.address` and `server.port`
   - Useful for multi-region deployments

8. **Add system instructions**
   - Map agent `instructions` to `gen_ai.system_instructions`
   - Simple addition, data already available

### Priority 4: Nice-to-Have
9. **Tool definitions**
   - Capture full tool schemas in `gen_ai.tool.definitions`
   - Requires upstream data collection changes

10. **Update span naming**
    - Use `invoke_agent {name}` format for agents
    - Low priority as current naming is descriptive

## Implementation Strategy

### Phase 1: Non-Breaking Additions (Week 1)
- Add missing recommended attributes (response.model, response.id, server.*, agent.name)
- Add conversation.id support
- Add system_instructions mapping
- Add opt-in content attributes flag

### Phase 2: Breaking Change (Week 2)
- Rename `gen_ai.system` → `gen_ai.provider.name`
- Update documentation
- Release as minor version with migration guide
- Keep backward compatibility for one version if possible

### Phase 3: Enhanced Features (Week 3+)
- Implement message content conversion
- Update span naming conventions
- Add tool definitions support

## Testing Requirements

1. **Unit Tests**: Verify all new attributes are correctly mapped
2. **Integration Tests**: Test with real providers (OpenAI, Anthropic, etc.)
3. **Backward Compatibility**: Ensure existing traces still work
4. **Privacy Tests**: Verify opt-in content attributes respect flags

## Documentation Updates

1. **README.md**: Update attribute list with new gen_ai.* attributes
2. **Migration Guide**: For gen_ai.system → gen_ai.provider.name change
3. **Privacy Guide**: Document opt-in content attributes and privacy implications
4. **Examples**: Add examples showing conversation tracking and agent naming

## References

- [OpenTelemetry GenAI Overview](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [GenAI Model Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- Current Implementation: `observability/otel-exporter/src/span-converter.ts`
- Message Converter: `observability/arize/src/gen-ai.ts`

## Appendix: Complete Attribute Mapping

### Model Generation Spans

| Attribute | Status | Priority | Notes |
|-----------|--------|----------|-------|
| `gen_ai.operation.name` | ✓ Implemented | Required | ✓ |
| `gen_ai.provider.name` | ✗ Using wrong name | Required | ⚠️ BREAKING |
| `gen_ai.request.model` | ✓ Implemented | Conditional | ✓ |
| `gen_ai.response.model` | ✗ Missing | Recommended | Add |
| `gen_ai.response.id` | ✗ Missing | Recommended | Add |
| `gen_ai.response.finish_reasons` | ✓ Implemented | Recommended | ✓ |
| `gen_ai.usage.*` | ✓ Implemented | Recommended | ✓ |
| `gen_ai.request.*` (params) | ✓ Implemented | Recommended | ✓ |
| `gen_ai.input.messages` | ✗ Missing | Optional (opt-in) | Add with flag |
| `gen_ai.output.messages` | ✗ Missing | Optional (opt-in) | Add with flag |
| `gen_ai.system_instructions` | ✗ Missing | Optional (opt-in) | Data available |
| `server.address` | ✗ Missing | Recommended | Add |
| `server.port` | ✗ Missing | Conditional | Add |
| `error.type` | ~ Partial | Conditional | Verify |

### Agent Spans

| Attribute | Status | Priority | Notes |
|-----------|--------|----------|-------|
| `gen_ai.operation.name` | ✓ Implemented | Required | ✓ |
| `gen_ai.provider.name` | ✗ Using wrong name | Required | ⚠️ BREAKING |
| `gen_ai.agent.id` | ✓ Implemented | Conditional | ✓ |
| `gen_ai.agent.name` | ✗ Missing | Recommended | Add |
| `gen_ai.conversation.id` | ✗ Missing | Recommended | Add (high value) |
| `gen_ai.request.model` | ~ Inherited | Conditional | Context-dependent |
| `gen_ai.system_instructions` | ✗ Missing | Optional (opt-in) | Data available |
| `gen_ai.tool.definitions` | ✗ Missing | Optional (opt-in) | Complex |
| `error.type` | ~ Partial | Conditional | Verify |

### Tool Spans

| Attribute | Status | Priority | Notes |
|-----------|--------|----------|-------|
| `gen_ai.tool.name` | ✓ Implemented | Recommended | ✓ |
| `gen_ai.tool.description` | ✓ Implemented | Optional | ✓ |
| `gen_ai.tool.input` | ✓ Implemented | Optional | ✓ |
| `gen_ai.tool.output` | ✓ Implemented | Optional | ✓ |
| `gen_ai.tool.success` | ✓ Implemented | Optional | ✓ |

**Legend**: ✓ Implemented | ✗ Missing | ~ Partial

---

*Analysis Date: 2025-11-19*
*Spec Version: OpenTelemetry GenAI Semantic Conventions (Development)*
*Implementation Version: @mastra/otel-exporter current*
