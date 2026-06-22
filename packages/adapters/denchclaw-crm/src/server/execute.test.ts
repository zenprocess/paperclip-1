import { describe, it, expect } from "vitest";
import { enrichCrmConfig } from "./execute.js";

describe("enrichCrmConfig", () => {
  it("defaults sessionKeyStrategy to 'issue' and marks payloadTemplate.crm", () => {
    const out = enrichCrmConfig({ url: "wss://x" });
    expect(out.sessionKeyStrategy).toBe("issue");
    expect(out.payloadTemplate).toEqual({ crm: true });
    expect(out.url).toBe("wss://x");
  });

  it("does not clobber an operator-provided sessionKeyStrategy", () => {
    const out = enrichCrmConfig({ sessionKeyStrategy: "fixed" });
    expect(out.sessionKeyStrategy).toBe("fixed");
  });

  it("preserves an existing payloadTemplate and its crm flag", () => {
    const out = enrichCrmConfig({ payloadTemplate: { crm: false, extra: 1 } });
    expect(out.payloadTemplate).toEqual({ crm: false, extra: 1 });
  });

  it("does not mutate the caller's config object", () => {
    const input = { url: "wss://x" };
    const snapshot = JSON.stringify(input);
    enrichCrmConfig(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
