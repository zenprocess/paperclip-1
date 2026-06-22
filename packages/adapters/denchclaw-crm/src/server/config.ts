import { z } from "zod";

/**
 * Per-tenant binding: a Paperclip companyId mapped to a DenchClaw workspace.
 * Optional per-tenant overrides fall back to the global base URL / service token.
 */
const tenantSchema = z.object({
  companyId: z.string().min(1),
  denchclawBaseUrl: z.string().url().optional(),
  serviceToken: z.string().min(1).optional(),
});

export type CrmTenant = z.infer<typeof tenantSchema>;

export interface CrmConfig {
  /** Master switch. Default OFF — the sync/bus-bridge are inert unless explicitly enabled. */
  syncEnabled: boolean;
  /** Global DenchClaw CRM base URL (per-tenant overrides win). */
  baseUrl: string;
  /** Global service token (per-tenant overrides win). Never logged. */
  serviceToken: string | null;
  /** Poll interval for the deterministic sync, in ms. */
  syncIntervalMs: number;
  /** Tenants to sync. Empty when none configured. */
  tenants: CrmTenant[];
}

const DEFAULT_BASE_URL = "https://crm.zp.digital";
const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const MIN_INTERVAL_MS = 30_000; // floor to avoid hammering the DenchClaw API

/**
 * RFC-1918 and special-use IPv4 blocks that must never be targets for outbound
 * HTTP requests originating from config-supplied URLs (SSRF guard).
 *
 * Ranges checked:
 *   10.0.0.0/8        private
 *   172.16.0.0/12     private
 *   192.168.0.0/16    private
 *   127.0.0.0/8       loopback
 *   169.254.0.0/16    link-local / AWS metadata
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<{ base: number; mask: number }> = [
  { base: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8
  { base: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12
  { base: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16
  { base: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8
  { base: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16
];

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = Number(part);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    // Keep n as an unsigned 32-bit value throughout: each shift+OR is re-coerced
    // via >>> 0 so that subsequent shifts don't sign-extend incorrectly.
    n = ((n << 8) | byte) >>> 0;
  }
  return n;
}

function isBlockedIpv4(host: string): boolean {
  const uint32 = ipv4ToUint32(host);
  if (uint32 === null) return false;
  // Use >>> 0 on both sides of the comparison to force unsigned 32-bit semantics;
  // JS bitwise AND returns a signed int, so high-bit addresses (>= 0x80000000)
  // would compare incorrectly against unsigned literal bases without this coercion.
  return BLOCKED_IPV4_RANGES.some(({ base, mask }) => ((uint32 & mask) >>> 0) === (base >>> 0));
}

// Non-numeric names that must be rejected; numeric addresses are handled by
// BLOCKED_IPV4_RANGES so they must NOT appear here (to get the right error message).
const LOCALHOST_NAMES = new Set(["localhost", "::1", "0.0.0.0"]);

/**
 * Guard a URL against SSRF via a malicious/misconfigured base URL.
 *
 * Rules:
 *  - scheme MUST be https
 *  - host MUST NOT be localhost or a blocked IP range
 *  - hostname MUST end with one of the allowed suffixes (default: [".zp.digital"])
 *
 * Throws on violation so the caller fails loud.
 */
export function assertSafeUrl(rawUrl: string, allowedSuffixes: ReadonlyArray<string>): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF guard: not a valid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `SSRF guard: URL scheme must be https, got "${parsed.protocol}" in "${rawUrl}"`,
    );
  }

  const host = parsed.hostname.toLowerCase();

  if (LOCALHOST_NAMES.has(host)) {
    throw new Error(`SSRF guard: localhost is not an allowed host in "${rawUrl}"`);
  }

  if (isBlockedIpv4(host)) {
    throw new Error(`SSRF guard: private/link-local IP address not allowed in "${rawUrl}"`);
  }

  const matchesSuffix = allowedSuffixes.some((suffix) => host.endsWith(suffix.toLowerCase()));
  if (!matchesSuffix) {
    throw new Error(
      `SSRF guard: host "${host}" does not match any allowed suffix [${allowedSuffixes.join(", ")}] in "${rawUrl}"`,
    );
  }
}

function parseAllowedSuffixes(raw: string | undefined): ReadonlyArray<string> {
  if (!raw?.trim()) return [".zp.digital"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseBool(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * Load CRM config from the environment. Fails LOUD on malformed tenant JSON (a
 * silent bad tenant map would sync into the wrong company). Fails SAFE (disabled,
 * empty tenants) when nothing is configured.
 *
 * Security: all base URLs (global and per-tenant) are validated against an SSRF
 * guard before the config is returned. Override the allowlist via the env var
 * DENCHCLAW_CRM_ALLOWED_HOST_SUFFIXES (comma-separated, e.g. ".zp.digital,.example.com").
 */
export function loadCrmConfig(env: NodeJS.ProcessEnv = process.env): CrmConfig {
  const allowedSuffixes = parseAllowedSuffixes(env.DENCHCLAW_CRM_ALLOWED_HOST_SUFFIXES);

  const baseUrl = env.DENCHCLAW_CRM_BASE_URL?.trim() || DEFAULT_BASE_URL;
  assertSafeUrl(baseUrl, allowedSuffixes);

  const serviceToken = env.DENCHCLAW_CRM_SERVICE_TOKEN?.trim() || null;

  let intervalMs = DEFAULT_INTERVAL_MS;
  const rawInterval = env.DENCHCLAW_CRM_SYNC_INTERVAL_MS?.trim();
  if (rawInterval) {
    const n = Number(rawInterval);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`DENCHCLAW_CRM_SYNC_INTERVAL_MS must be a positive number, got "${rawInterval}"`);
    }
    intervalMs = Math.max(MIN_INTERVAL_MS, n);
  }

  let tenants: CrmTenant[] = [];
  const rawTenants = env.DENCHCLAW_CRM_TENANTS?.trim();
  if (rawTenants) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawTenants);
    } catch (err) {
      throw new Error(
        `DENCHCLAW_CRM_TENANTS is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    tenants = z.array(tenantSchema).parse(parsed);
    const seen = new Set<string>();
    for (const t of tenants) {
      if (seen.has(t.companyId)) {
        throw new Error(`DENCHCLAW_CRM_TENANTS has a duplicate companyId: ${t.companyId}`);
      }
      seen.add(t.companyId);
      // Validate per-tenant URL override against the same SSRF guard.
      if (t.denchclawBaseUrl !== undefined) {
        assertSafeUrl(t.denchclawBaseUrl, allowedSuffixes);
      }
    }
  }

  return {
    syncEnabled: parseBool(env.DENCHCLAW_CRM_SYNC_ENABLED),
    baseUrl,
    serviceToken,
    syncIntervalMs: intervalMs,
    tenants,
  };
}

/** Resolve the effective base URL + token for a tenant (per-tenant overrides win). */
export function resolveTenantEndpoint(
  config: CrmConfig,
  tenant: CrmTenant,
): { baseUrl: string; serviceToken: string | null } {
  return {
    baseUrl: tenant.denchclawBaseUrl ?? config.baseUrl,
    serviceToken: tenant.serviceToken ?? config.serviceToken,
  };
}
