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
