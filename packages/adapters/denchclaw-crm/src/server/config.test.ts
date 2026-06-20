import { describe, it, expect } from "vitest";
import { loadCrmConfig, resolveTenantEndpoint, assertSafeUrl } from "./config.js";

describe("loadCrmConfig defaults (fail-safe)", () => {
  it("is disabled with sensible defaults when nothing is set", () => {
    const cfg = loadCrmConfig({});
    expect(cfg.syncEnabled).toBe(false);
    expect(cfg.baseUrl).toBe("https://crm.zp.digital");
    expect(cfg.serviceToken).toBeNull();
    expect(cfg.tenants).toEqual([]);
    expect(cfg.syncIntervalMs).toBe(300_000);
  });

  it("parses the enable flag and overrides", () => {
    const cfg = loadCrmConfig({
      DENCHCLAW_CRM_SYNC_ENABLED: "1",
      DENCHCLAW_CRM_BASE_URL: "https://api.zp.digital",
      DENCHCLAW_CRM_SERVICE_TOKEN: "tok",
    });
    expect(cfg.syncEnabled).toBe(true);
    expect(cfg.baseUrl).toBe("https://api.zp.digital");
    expect(cfg.serviceToken).toBe("tok");
  });

  it("floors the sync interval to 30s", () => {
    expect(loadCrmConfig({ DENCHCLAW_CRM_SYNC_INTERVAL_MS: "1000" }).syncIntervalMs).toBe(30_000);
    expect(loadCrmConfig({ DENCHCLAW_CRM_SYNC_INTERVAL_MS: "600000" }).syncIntervalMs).toBe(600_000);
  });
});

describe("loadCrmConfig fail-loud", () => {
  it("throws on malformed tenant JSON", () => {
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_TENANTS: "{not json" })).toThrow(/not valid JSON/);
  });

  it("throws on a tenant missing companyId", () => {
    expect(() =>
      loadCrmConfig({
        DENCHCLAW_CRM_TENANTS: '[{"denchclawBaseUrl":"https://crm.zp.digital"}]',
      }),
    ).toThrow();
  });

  it("throws on a non-positive interval", () => {
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_SYNC_INTERVAL_MS: "-5" })).toThrow();
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_SYNC_INTERVAL_MS: "abc" })).toThrow();
  });

  it("throws on duplicate tenant companyIds", () => {
    const dup = JSON.stringify([{ companyId: "a" }, { companyId: "a" }]);
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_TENANTS: dup })).toThrow(/duplicate/);
  });
});

describe("resolveTenantEndpoint", () => {
  it("prefers per-tenant overrides over globals", () => {
    const cfg = loadCrmConfig({
      DENCHCLAW_CRM_BASE_URL: "https://global.zp.digital",
      DENCHCLAW_CRM_SERVICE_TOKEN: "global-tok",
    });
    const ep = resolveTenantEndpoint(cfg, {
      companyId: "c1",
      denchclawBaseUrl: "https://tenant.zp.digital",
      serviceToken: "tenant-tok",
    });
    expect(ep).toEqual({ baseUrl: "https://tenant.zp.digital", serviceToken: "tenant-tok" });
  });

  it("falls back to globals when the tenant has no overrides", () => {
    const cfg = loadCrmConfig({
      DENCHCLAW_CRM_BASE_URL: "https://global.zp.digital",
      DENCHCLAW_CRM_SERVICE_TOKEN: "global-tok",
    });
    const ep = resolveTenantEndpoint(cfg, { companyId: "c1" });
    expect(ep).toEqual({ baseUrl: "https://global.zp.digital", serviceToken: "global-tok" });
  });
});

describe("assertSafeUrl — SSRF guard", () => {
  const defaultSuffixes = [".zp.digital"];

  it("allows https://*.zp.digital", () => {
    expect(() => assertSafeUrl("https://crm.zp.digital", defaultSuffixes)).not.toThrow();
    expect(() => assertSafeUrl("https://api.zp.digital/v1", defaultSuffixes)).not.toThrow();
    expect(() => assertSafeUrl("https://tenant1.crm.zp.digital", defaultSuffixes)).not.toThrow();
  });

  it("rejects http:// scheme", () => {
    expect(() => assertSafeUrl("http://crm.zp.digital", defaultSuffixes)).toThrow(/scheme must be https/);
  });

  it("rejects http://169.254.169.254 (AWS metadata)", () => {
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data", defaultSuffixes)).toThrow(
      /scheme must be https/,
    );
  });

  it("rejects https://169.254.169.254 (link-local even over https)", () => {
    expect(() => assertSafeUrl("https://169.254.169.254", defaultSuffixes)).toThrow(
      /private\/link-local IP address/,
    );
  });

  it("rejects https://evil.com (not in allowlist)", () => {
    expect(() => assertSafeUrl("https://evil.com", defaultSuffixes)).toThrow(/does not match any allowed suffix/);
  });

  it("rejects https://localhost", () => {
    expect(() => assertSafeUrl("https://localhost", defaultSuffixes)).toThrow(/localhost is not an allowed host/);
  });

  it("rejects https://127.0.0.1", () => {
    expect(() => assertSafeUrl("https://127.0.0.1", defaultSuffixes)).toThrow(/private\/link-local IP address/);
  });

  it("rejects RFC-1918 ranges", () => {
    expect(() => assertSafeUrl("https://10.0.0.1", defaultSuffixes)).toThrow(/private\/link-local IP address/);
    expect(() => assertSafeUrl("https://172.16.0.1", defaultSuffixes)).toThrow(/private\/link-local IP address/);
    expect(() => assertSafeUrl("https://192.168.1.1", defaultSuffixes)).toThrow(/private\/link-local IP address/);
  });

  it("honours DENCHCLAW_CRM_ALLOWED_HOST_SUFFIXES to extend the allowlist", () => {
    const cfg = loadCrmConfig({
      DENCHCLAW_CRM_BASE_URL: "https://crm.example.com",
      DENCHCLAW_CRM_ALLOWED_HOST_SUFFIXES: ".zp.digital,.example.com",
    });
    expect(cfg.baseUrl).toBe("https://crm.example.com");
  });
});

describe("loadCrmConfig SSRF guard integration", () => {
  it("throws on an http global baseUrl", () => {
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_BASE_URL: "http://crm.zp.digital" })).toThrow(
      /scheme must be https/,
    );
  });

  it("throws when a tenant denchclawBaseUrl is disallowed", () => {
    const tenants = JSON.stringify([{ companyId: "t1", denchclawBaseUrl: "https://evil.com" }]);
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_TENANTS: tenants })).toThrow(/does not match any allowed suffix/);
  });

  it("throws when a tenant denchclawBaseUrl uses http", () => {
    const tenants = JSON.stringify([{ companyId: "t1", denchclawBaseUrl: "http://crm.zp.digital" }]);
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_TENANTS: tenants })).toThrow(/scheme must be https/);
  });

  it("throws when a tenant denchclawBaseUrl is a link-local address", () => {
    const tenants = JSON.stringify([{ companyId: "t1", denchclawBaseUrl: "https://169.254.169.254" }]);
    expect(() => loadCrmConfig({ DENCHCLAW_CRM_TENANTS: tenants })).toThrow(/private\/link-local IP address/);
  });
});
