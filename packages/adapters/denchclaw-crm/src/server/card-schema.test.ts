import { describe, it, expect } from "vitest";
import {
  personToCard,
  companyToCard,
  statusFromStrengthScore,
  priorityFromStrengthScore,
  CRM_PEOPLE_PROJECT_KEY,
  CRM_COMPANIES_PROJECT_KEY,
} from "./card-schema.js";
import { parseBillingCode } from "./billing-code.js";

describe("strength score boundaries", () => {
  it.each([
    [0, "backlog"],
    [39, "backlog"],
    [40, "todo"],
    [79, "todo"],
    [80, "in_progress"],
    [100, "in_progress"],
  ])("score %i -> status %s", (score, expected) => {
    expect(statusFromStrengthScore(score)).toBe(expected);
  });

  it("unknown score defaults to todo", () => {
    expect(statusFromStrengthScore(undefined)).toBe("todo");
  });

  it.each([
    [0, "medium"],
    [79, "medium"],
    [80, "high"],
    [100, "high"],
  ])("score %i -> priority %s", (score, expected) => {
    expect(priorityFromStrengthScore(score)).toBe(expected);
  });
});

describe("personToCard", () => {
  it("maps a full record (flattened keys)", () => {
    const card = personToCard({
      id: "p1",
      fullName: "Ada Lovelace",
      jobTitle: "Engineer",
      company: "Analytical Co",
      email: "ada@example.com",
      strengthScore: 90,
    });
    expect(card.title).toBe("Ada Lovelace");
    expect(card.status).toBe("in_progress");
    expect(card.priority).toBe("high");
    expect(card.projectKey).toBe(CRM_PEOPLE_PROJECT_KEY);
    expect(parseBillingCode(card.billingCode)).toEqual({ object: "person", id: "p1" });
    expect(card.description).toContain("Engineer");
    expect(card.description).toContain("ada@example.com");
  });

  it("reads from the EAV fields map with human labels", () => {
    const card = personToCard({
      id: "p2",
      fields: { "Full Name": "Grace Hopper", "Strength Score": "35" },
    });
    expect(card.title).toBe("Grace Hopper");
    expect(card.status).toBe("backlog");
  });

  it("falls back to a placeholder title and empty description when fields are missing", () => {
    const card = personToCard({ id: "p3" });
    expect(card.title).toBe("(unnamed contact)");
    expect(card.description).toBe("");
    expect(card.status).toBe("todo");
    expect(card.priority).toBe("medium");
  });
});

describe("companyToCard", () => {
  it("prefers an explicit strong strength_label over the score", () => {
    const card = companyToCard({
      id: "c1",
      name: "Acme",
      industry: "Widgets",
      strengthLabel: "strong",
      strengthScore: 10,
    });
    expect(card.title).toBe("Acme");
    expect(card.status).toBe("in_progress");
    expect(card.projectKey).toBe(CRM_COMPANIES_PROJECT_KEY);
    expect(parseBillingCode(card.billingCode)).toEqual({ object: "company", id: "c1" });
  });

  it("falls back to score-based status without a label", () => {
    const card = companyToCard({ id: "c2", name: "Beta", strengthScore: 85 });
    expect(card.status).toBe("in_progress");
    expect(card.priority).toBe("high");
  });
});

describe("prototype-pollution hardening", () => {
  it("__proto__ key in fields does not pollute Object.prototype", () => {
    // Capture a baseline property that should never exist on plain objects
    const before = ({} as Record<string, unknown>).polluted;

    // Construct the record so that `fields` contains a key named "__proto__"
    // with a value that would pollute if assigned via bracket notation.
    const fields: Record<string, unknown> = {};
    // Use Object.defineProperty to set a key literally named "__proto__"
    // as an own property without triggering the language setter.
    Object.defineProperty(fields, "__proto__", {
      value: { polluted: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    const card = personToCard({ id: "sec1", fields });

    // Object.prototype must not have been polluted.
    expect(({} as Record<string, unknown>).polluted).toBe(before);
    // The dangerous key must not appear in the card description or title.
    expect(card.title).toBe("(unnamed contact)");
  });

  it("constructor key in fields is not surfaced as a field value", () => {
    // If "constructor" were read without an own-property guard, it would return
    // the Object constructor function and potentially confuse downstream code.
    const fields: Record<string, unknown> = {};
    Object.defineProperty(fields, "constructor", {
      value: { isLeaked: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // personToCard looks for "Full Name" in fields; "constructor" is only
    // dangerous if the pick helper were to use it as a data key.
    // We pass it explicitly in the keys list via a person whose id encodes the
    // scenario — the card must still render without error and must not
    // incorporate the constructor value.
    const card = personToCard({ id: "sec2", fields });
    expect(card.title).toBe("(unnamed contact)");
    // description must not contain anything from the poisoned constructor value
    expect(card.description).not.toContain("isLeaked");
  });

  it("a key only on the prototype chain (not an own property) is not picked", () => {
    // Create a fields object whose prototype has a "Full Name" property,
    // but the own object does not.
    const proto = { "Full Name": "Prototype Ghost" };
    const fields = Object.create(proto) as Record<string, unknown>;

    // Confirm the inherited property is accessible via bracket notation
    // (this is the vulnerability we are guarding against).
    expect(fields["Full Name"]).toBe("Prototype Ghost");

    // pick must NOT surface the inherited value.
    const card = personToCard({ id: "sec3", fields });
    expect(card.title).toBe("(unnamed contact)");
    expect(card.description).not.toContain("Prototype Ghost");
  });

  it("normal own-property field reads are unaffected by the guard", () => {
    // Regression: ensure the hasOwnProperty guard does not accidentally
    // block legitimate own-property reads.
    const card = personToCard({
      id: "sec4",
      fields: { "Full Name": "Normal User", "Strength Score": "85" },
    });
    expect(card.title).toBe("Normal User");
    expect(card.status).toBe("in_progress");
    expect(card.priority).toBe("high");
  });
});
