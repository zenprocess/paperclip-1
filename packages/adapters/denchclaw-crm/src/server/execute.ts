import { execute as openclawGatewayExecute } from "@paperclipai/adapter-openclaw-gateway/server";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";

/**
 * Enrich the adapter config with CRM-friendly defaults WITHOUT mutating the
 * caller's object or clobbering operator-provided values. Returns a new object.
 * - sessionKeyStrategy defaults to "issue" (one agent session per CRM card)
 * - a `crm: true` marker is merged into payloadTemplate so the agent run is
 *   identifiable downstream; an existing payloadTemplate is preserved.
 */
export function enrichCrmConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const existingTemplate =
    config.payloadTemplate && typeof config.payloadTemplate === "object"
      ? (config.payloadTemplate as Record<string, unknown>)
      : {};
  return {
    ...config,
    sessionKeyStrategy:
      typeof config.sessionKeyStrategy === "string" && config.sessionKeyStrategy
        ? config.sessionKeyStrategy
        : "issue",
    payloadTemplate: {
      ...existingTemplate,
      crm: existingTemplate.crm ?? true,
    },
  };
}

/**
 * denchclaw_crm.execute — config-enrichment wrapper that delegates transport to
 * openclaw_gateway. Contains zero CRM logic and never mutates the inbound ctx.
 */
export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const enriched = enrichCrmConfig(ctx.config);
  return openclawGatewayExecute({ ...ctx, config: enriched });
}
