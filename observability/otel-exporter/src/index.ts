export { OtelExporter } from './tracing.js';
export { SpanConverter } from './span-converter.js';
export { OtelSpan, getSpanKind } from './otel-span.js';
export type {
  OtelExporterConfig,
  ProviderConfig,
  Dash0Config,
  SignozConfig,
  NewRelicConfig,
  TraceloopConfig,
  LaminarConfig,
  CustomConfig,
  ExportProtocol,
} from './types.js';
