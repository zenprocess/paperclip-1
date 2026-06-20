import { describe, it, expect } from "vitest";
import { cardChecksum, computeSyncPlan } from "./sync-plan.js";
import type { CrmCardInput } from "./card-schema.js";
import type { ExistingCard } from "./sync-plan.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CARD_A: CrmCardInput = {
  title: "Acme Corp",
  description: "**Industry:** SaaS",
  status: "todo",
  priority: "medium",
  billingCode: "dc::company::acme-1",
  projectKey: "crm-companies",
};

const CARD_B: CrmCardInput = {
  title: "Jane Doe",
  description: "**Email:** jane@example.com",
  status: "in_progress",
  priority: "high",
  billingCode: "dc::person::jane-99",
  projectKey: "crm-people",
};

function existingFromCards(
  cards: CrmCardInput[],
  issueIdPrefix = "issue-",
): Map<string, ExistingCard> {
  const map = new Map<string, ExistingCard>();
  cards.forEach((card, idx) => {
    map.set(card.billingCode, {
      issueId: `${issueIdPrefix}${idx + 1}`,
      billingCode: card.billingCode,
      checksum: cardChecksum(card),
    });
  });
  return map;
}

// ---------------------------------------------------------------------------
// cardChecksum
// ---------------------------------------------------------------------------

describe("cardChecksum", () => {
  it("is stable across repeated calls", () => {
    const first = cardChecksum(CARD_A);
    const second = cardChecksum(CARD_A);
    expect(first).toBe(second);
  });

  it("returns an 8-character hex string", () => {
    const cs = cardChecksum(CARD_A);
    expect(cs).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs for cards with different content", () => {
    const modified: CrmCardInput = { ...CARD_A, title: "Acme Corp MODIFIED" };
    expect(cardChecksum(CARD_A)).not.toBe(cardChecksum(modified));
  });

  it("(5) is stable across separate invocations — same input same output", () => {
    // Rebuild the object from scratch to rule out reference identity
    const rebuilt: CrmCardInput = {
      title: "Acme Corp",
      description: "**Industry:** SaaS",
      status: "todo",
      priority: "medium",
      billingCode: "dc::company::acme-1",
      projectKey: "crm-companies",
    };
    expect(cardChecksum(rebuilt)).toBe(cardChecksum(CARD_A));
  });

  it("(4) two cards identical except status produce EQUAL checksums (status excluded)", () => {
    const cardTodo: CrmCardInput = { ...CARD_A, status: "todo" };
    const cardBacklog: CrmCardInput = { ...CARD_A, status: "backlog" };
    const cardInProgress: CrmCardInput = { ...CARD_A, status: "in_progress" };
    expect(cardChecksum(cardTodo)).toBe(cardChecksum(cardBacklog));
    expect(cardChecksum(cardTodo)).toBe(cardChecksum(cardInProgress));
  });

  it("checksum differs when priority changes (priority IS included)", () => {
    const high: CrmCardInput = { ...CARD_A, priority: "high" };
    const medium: CrmCardInput = { ...CARD_A, priority: "medium" };
    expect(cardChecksum(high)).not.toBe(cardChecksum(medium));
  });

  it("checksum differs when billingCode changes (billingCode IS included)", () => {
    const altCode: CrmCardInput = { ...CARD_A, billingCode: "dc::company::acme-2" };
    expect(cardChecksum(CARD_A)).not.toBe(cardChecksum(altCode));
  });
});

// ---------------------------------------------------------------------------
// computeSyncPlan
// ---------------------------------------------------------------------------

describe("computeSyncPlan — empty existing", () => {
  it("(1) all cards become creates when existing is empty", () => {
    const plan = computeSyncPlan([CARD_A, CARD_B], new Map());
    expect(plan.creates).toHaveLength(2);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.creates.map((a) => a.card.billingCode)).toEqual([
      CARD_A.billingCode,
      CARD_B.billingCode,
    ]);
    plan.creates.forEach((action) => {
      expect(action.kind).toBe("create");
      expect(action).not.toHaveProperty("issueId");
    });
  });

  it("create actions carry the correct checksum", () => {
    const plan = computeSyncPlan([CARD_A], new Map());
    expect(plan.creates[0].checksum).toBe(cardChecksum(CARD_A));
  });
});

describe("computeSyncPlan — idempotent (second run)", () => {
  it("(2) rebuilding existing from first run checksums → second run is all unchanged", () => {
    const cards = [CARD_A, CARD_B];
    // Simulate what a caller would store after the first sync
    const existing = existingFromCards(cards);
    const plan = computeSyncPlan(cards, existing);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(2);
    plan.unchanged.forEach((action) => {
      expect(action.kind).toBe("unchanged");
      expect(action).toHaveProperty("issueId");
    });
  });
});

describe("computeSyncPlan — one changed title", () => {
  it("(3) exactly one update when one card's title changes, other is unchanged", () => {
    const cards = [CARD_A, CARD_B];
    const existing = existingFromCards(cards);

    // Mutate CARD_A's title
    const updatedA: CrmCardInput = { ...CARD_A, title: "Acme Corp Renamed" };
    const plan = computeSyncPlan([updatedA, CARD_B], existing);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.unchanged).toHaveLength(1);

    const update = plan.updates[0];
    expect(update.kind).toBe("update");
    expect(update.card.billingCode).toBe(CARD_A.billingCode);
    expect(update.card.title).toBe("Acme Corp Renamed");
    expect(update.issueId).toBe("issue-1");
    expect(update.checksum).toBe(cardChecksum(updatedA));

    expect(plan.unchanged[0].card.billingCode).toBe(CARD_B.billingCode);
  });

  it("update carries the issueId from existing", () => {
    const existing: Map<string, ExistingCard> = new Map([
      [
        CARD_A.billingCode,
        {
          issueId: "paperclip-issue-42",
          billingCode: CARD_A.billingCode,
          checksum: "00000000", // deliberately stale
        },
      ],
    ]);
    const plan = computeSyncPlan([CARD_A], existing);
    expect(plan.updates[0].issueId).toBe("paperclip-issue-42");
  });
});

describe("computeSyncPlan — status change alone never triggers update", () => {
  it("(4) only status differs → unchanged (lane is user-owned)", () => {
    const cards = [CARD_A];
    const existing = existingFromCards(cards);

    // Simulate user moving the card to a different lane in Paperclip
    // and the next CRM sync arriving with a different status value
    const differentStatus: CrmCardInput = { ...CARD_A, status: "backlog" };
    const plan = computeSyncPlan([differentStatus], existing);

    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.creates).toHaveLength(0);
  });
});

describe("computeSyncPlan — mixed create/update/unchanged", () => {
  it("correctly partitions a mixed batch", () => {
    // CARD_A is known and stale, CARD_B is known and current, a new card is unknown
    const newCard: CrmCardInput = {
      title: "New Lead",
      description: "",
      status: "todo",
      priority: "medium",
      billingCode: "dc::person::new-1",
      projectKey: "crm-people",
    };

    const staleChecksum = "deadbeef";
    const existing: Map<string, ExistingCard> = new Map([
      [
        CARD_A.billingCode,
        { issueId: "iss-a", billingCode: CARD_A.billingCode, checksum: staleChecksum },
      ],
      [
        CARD_B.billingCode,
        {
          issueId: "iss-b",
          billingCode: CARD_B.billingCode,
          checksum: cardChecksum(CARD_B),
        },
      ],
    ]);

    const plan = computeSyncPlan([CARD_A, CARD_B, newCard], existing);

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].card.billingCode).toBe(newCard.billingCode);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].card.billingCode).toBe(CARD_A.billingCode);
    expect(plan.updates[0].issueId).toBe("iss-a");

    expect(plan.unchanged).toHaveLength(1);
    expect(plan.unchanged[0].card.billingCode).toBe(CARD_B.billingCode);
    expect(plan.unchanged[0].issueId).toBe("iss-b");
  });
});
