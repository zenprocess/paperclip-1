import { describe, it, expect } from "vitest";
import {
  formatBillingCode,
  parseBillingCode,
  isCrmBillingCode,
  type CrmObject,
} from "./billing-code.js";

const OBJECTS: CrmObject[] = ["person", "company", "email_thread", "calendar_event"];

describe("billing-code roundtrip", () => {
  it("roundtrips every object type", () => {
    for (const object of OBJECTS) {
      const code = formatBillingCode(object, "abc-123");
      const parsed = parseBillingCode(code);
      expect(parsed).toEqual({ object, id: "abc-123" });
    }
  });

  it("preserves ids containing hyphens, uuids, and unicode", () => {
    const ids = [
      "550e8400-e29b-41d4-a716-446655440000",
      "person.with.dots",
      "café-ünïcode",
    ];
    for (const id of ids) {
      const parsed = parseBillingCode(formatBillingCode("person", id));
      expect(parsed?.id).toBe(id);
    }
  });

  it("trims surrounding whitespace on format and parse", () => {
    expect(formatBillingCode("company", "  x9  ")).toBe("dc::company::x9");
    expect(parseBillingCode("  dc::company::x9  ")).toEqual({
      object: "company",
      id: "x9",
    });
  });
});

describe("billing-code rejects non-CRM / malformed input", () => {
  it("returns null for plain issue codes and noise", () => {
    for (const bad of ["PROJ-123", "", "   ", "dcx::1", "abc", "::::", "dc:single"]) {
      expect(parseBillingCode(bad)).toBeNull();
      expect(isCrmBillingCode(bad)).toBe(false);
    }
  });

  it("returns null for non-string input", () => {
    expect(parseBillingCode(null)).toBeNull();
    expect(parseBillingCode(undefined)).toBeNull();
    // @ts-expect-error — defensive against runtime callers passing the wrong type
    expect(parseBillingCode(42)).toBeNull();
  });

  it("returns null when the id segment is empty", () => {
    expect(parseBillingCode("dc::person::")).toBeNull();
    expect(parseBillingCode("dc::")).toBeNull();
  });
});

describe("billing-code legacy + unknown-token handling", () => {
  it("parses legacy untyped dc::<id> as a coarse entry", () => {
    expect(parseBillingCode("dc::entry-77")).toEqual({ object: "entry", id: "entry-77" });
    expect(isCrmBillingCode("dc::entry-77")).toBe(true);
  });

  it("treats an unknown token as a legacy id rather than misrouting", () => {
    const parsed = parseBillingCode("dc::widget::42");
    expect(parsed).toEqual({ object: "entry", id: "widget::42" });
  });
});

describe("formatBillingCode guards", () => {
  it("throws on empty/whitespace id (a silent empty link is a bug)", () => {
    expect(() => formatBillingCode("person", "")).toThrow();
    expect(() => formatBillingCode("person", "   ")).toThrow();
  });
});
