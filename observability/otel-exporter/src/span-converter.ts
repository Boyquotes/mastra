/**
 * Convert Mastra Spans to OpenTelemetry spans
 */

import type { InstrumentationScope } from '@opentelemetry/core';
import type { Resource } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OtelSpan } from './otel-span.js';
import type {
  AnyExportedSpan,
} from '@mastra/core/observability';

import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_TELEMETRY_SDK_LANGUAGE,
  ATTR_TELEMETRY_SDK_NAME,
  ATTR_TELEMETRY_SDK_VERSION,
} from '@opentelemetry/semantic-conventions';

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OtelExporterConfig } from './types.js';

async function getPackageVersion(pkgName: string): Promise<string | undefined> {
  try {
    // Resolve `package.json` for the given package
    const manifestUrl = new URL(
      await import.meta.resolve(`${pkgName}/package.json`)
    );

    const path = fileURLToPath(manifestUrl);
    const pkgJson = JSON.parse(readFileSync(path, "utf8"));
    return pkgJson.version;
  } catch {
    return undefined;
  }
}

export class SpanConverter {
  private resource?: Resource;
  private scope?: InstrumentationScope;
  private initPromise?: Promise<void>;

  constructor(
    private readonly params: {
      packageName: string;
      serviceName?: string;
      config?: OtelExporterConfig;
    },
  ) {
    // no async work here
  }

  /**
   * Lazily initialize resource & scope on first use.
   * Subsequent calls reuse the same promise (no races).
   */
  private async initIfNeeded(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const packageVersion =
        (await getPackageVersion(this.params.packageName)) ?? "unknown";

      const serviceVersion =
        (await getPackageVersion("@mastra/core")) ?? "unknown";

      let resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.params.serviceName || "mastra-service",
        [ATTR_SERVICE_VERSION]: serviceVersion,
        [ATTR_TELEMETRY_SDK_NAME]: this.params.packageName,
        [ATTR_TELEMETRY_SDK_VERSION]: packageVersion,
        [ATTR_TELEMETRY_SDK_LANGUAGE]: "nodejs",
      });

      if (this.params.config?.resourceAttributes) {
        resource = resource.merge(
          // Duplicate attributes from config will override defaults above
          resourceFromAttributes(this.params.config.resourceAttributes),
        );
      }

      this.resource = resource;
      this.scope = {
        name: this.params.packageName,
        version: packageVersion,
      };
    })();

    return this.initPromise;
  }

  /**
   * Convert a Mastra Span to an OpenTelemetry ReadableSpan
   */
  async convertSpan(span: AnyExportedSpan): Promise<OtelSpan> {
    await this.initIfNeeded();

    if (!this.resource || !this.scope) {
      // Should never happen if initIfNeeded() succeeded,
      // but useful as a safety net.
      throw new Error("SpanConverter not initialized correctly");
    }

    return new OtelSpan({
      span,
      resource: this.resource,
      scope: this.scope,
    });
  }

}

