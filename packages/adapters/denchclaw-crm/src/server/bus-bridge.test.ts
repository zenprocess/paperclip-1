import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCrmStatusHandler, type CrmBridgePorts, type CrmIssueEvent } from "./bus-bridge.js";
import { formatBillingCode } from "./billing-code.js";
import { ACTION_PROMPTS } from "./lane-actions.js";

const COMPANY = "co-1";
const ISSUE = "issue-1";
const CRM_CODE = formatBillingCode("person", "p-77"); // dc::person::p-77

/** Build a fully-spied ports object; tests override individual ports as needed. */
function makePorts(overrides: Partial<CrmBridgePorts> = {}): {
  ports: CrmBridgePorts;
  getIssueBillingInfo: ReturnType<typeof vi.fn>;
  dispatchAgentWork: ReturnType<typeof vi.fn>;
  onArchive: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const getIssueBillingInfo = vi.fn().mockResolvedValue({ billingCode: CRM_CODE });
  const dispatchAgentWork = vi.fn().mockResolvedValue(undefined);
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const error = vi.fn();
  const ports: CrmBridgePorts = {
    getIssueBillingInfo,
    dispatchAgentWork,
    onArchive,
    logger: { error },
    ...overrides,
  };
  return { ports, getIssueBillingInfo, dispatchAgentWork, onArchive, error };
}

/** A well-formed issue.updated event with a real status transition. */
function transitionEvent(
  next: string,
  prev: string | null = "todo",
  extraPayload: Record<string, unknown> = {},
): CrmIssueEvent {
  return {
    eventType: "issue.updated",
    entityType: "issue",
    entityId: ISSUE,
    companyId: COMPANY,
    payload: {
      status: next,
      _previous: prev === null ? null : { status: prev },
      ...extraPayload,
    },
  };
}

describe("createCrmStatusHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (1) CRM card → in_progress fires dispatchAgentWork exactly once with correct fields.
  it("dispatches exactly once with the correct action/prompt/entryId for a CRM card moving to in_progress", async () => {
    const { ports, dispatchAgentWork, onArchive } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("in_progress"));

    expect(dispatchAgentWork).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
    expect(dispatchAgentWork).toHaveBeenCalledWith({
      companyId: COMPANY,
      issueId: ISSUE,
      action: "RESEARCH_CONTACT",
      prompt: ACTION_PROMPTS.RESEARCH_CONTACT,
      denchclawEntryId: "p-77",
      object: "person",
      newStatus: "in_progress",
    });
  });

  // (2) Non-CRM billingCode ("PROJ-1") → zero dispatch.
  it("does not dispatch when the authoritative billingCode is a non-CRM code", async () => {
    const { ports, dispatchAgentWork, onArchive } = makePorts({
      getIssueBillingInfo: vi.fn().mockResolvedValue({ billingCode: "PROJ-1" }),
    });
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("in_progress"));

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });

  // (3a) No status transition: missing _previous → zero.
  it("does not dispatch when _previous is absent (transition unconfirmable)", async () => {
    const { ports, dispatchAgentWork, getIssueBillingInfo } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler({
      eventType: "issue.updated",
      entityType: "issue",
      entityId: ISSUE,
      companyId: COMPANY,
      payload: { status: "in_progress" }, // no _previous
    });

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    // Cheap-exit before the trust-anchor lookup.
    expect(getIssueBillingInfo).not.toHaveBeenCalled();
  });

  // (3b) No status transition: prev === next → zero.
  it("does not dispatch when the status did not actually change (prev === next)", async () => {
    const { ports, dispatchAgentWork, getIssueBillingInfo } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("in_progress", "in_progress"));

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(getIssueBillingInfo).not.toHaveBeenCalled();
  });

  // (4a) eventType not "issue.updated" → zero.
  it("does not dispatch for a non issue.updated eventType", async () => {
    const { ports, dispatchAgentWork, getIssueBillingInfo } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler({ ...transitionEvent("in_progress"), eventType: "issue.created" });

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(getIssueBillingInfo).not.toHaveBeenCalled();
  });

  // (4b) entityType not "issue" → zero.
  it("does not dispatch when entityType is not issue", async () => {
    const { ports, dispatchAgentWork, getIssueBillingInfo } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler({ ...transitionEvent("in_progress"), entityType: "comment" });

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(getIssueBillingInfo).not.toHaveBeenCalled();
  });

  // (5) Spoofed payload billingCode but authoritative lookup is null/non-CRM → zero.
  it("trusts the issue lookup, not the event payload, for the billingCode", async () => {
    // Authoritative lookup returns a non-CRM code even though the payload spoofs a CRM one.
    const { ports, dispatchAgentWork } = makePorts({
      getIssueBillingInfo: vi.fn().mockResolvedValue({ billingCode: "PROJ-9" }),
    });
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("in_progress", "todo", { billingCode: CRM_CODE }));

    expect(dispatchAgentWork).not.toHaveBeenCalled();

    // And again when the authoritative billingCode is explicitly null.
    const { ports: ports2, dispatchAgentWork: dispatch2 } = makePorts({
      getIssueBillingInfo: vi.fn().mockResolvedValue({ billingCode: null }),
    });
    const handler2 = createCrmStatusHandler(ports2);

    await handler2(transitionEvent("in_progress", "todo", { billingCode: CRM_CODE }));

    expect(dispatch2).not.toHaveBeenCalled();
  });

  // (6) Cancelled → calls onArchive, not dispatch.
  it("archives (not dispatches) when a CRM card is cancelled", async () => {
    const { ports, dispatchAgentWork, onArchive } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("cancelled", "in_progress"));

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({
      companyId: COMPANY,
      issueId: ISSUE,
      parsed: { object: "person", id: "p-77" },
    });
  });

  // (7) Signal-only lanes (blocked / backlog / todo) → zero dispatch and zero archive.
  it.each(["blocked", "backlog", "todo"])(
    "does not dispatch or archive for the signal-only lane %s",
    async (status) => {
      const { ports, dispatchAgentWork, onArchive } = makePorts();
      const handler = createCrmStatusHandler(ports);

      await handler(transitionEvent(status, "in_progress"));

      expect(dispatchAgentWork).not.toHaveBeenCalled();
      expect(onArchive).not.toHaveBeenCalled();
    },
  );

  // (8) dispatchAgentWork throws → handler does NOT throw and logger.error is called.
  it("swallows a dispatchAgentWork failure and logs it via logger.error", async () => {
    const boom = new Error("transport down");
    const throwingDispatch = vi.fn().mockRejectedValue(boom);
    const { ports, error } = makePorts({ dispatchAgentWork: throwingDispatch });
    const handler = createCrmStatusHandler(ports);

    await expect(handler(transitionEvent("in_progress"))).resolves.toBeUndefined();

    expect(throwingDispatch).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("transport down");
    expect(error.mock.calls[0][0]).toContain(ISSUE);
  });

  // (8b) SECURITY: error message containing auth material is redacted before logging.
  it("redacts bearer tokens from error messages before logging", async () => {
    const boom = new Error("transport error: Bearer sk-secret123 rejected by gateway");
    const throwingDispatch = vi.fn().mockRejectedValue(boom);
    const { ports, error } = makePorts({ dispatchAgentWork: throwingDispatch });
    const handler = createCrmStatusHandler(ports);

    await expect(handler(transitionEvent("in_progress"))).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    const logged: string = error.mock.calls[0][0];
    expect(logged).not.toContain("sk-secret123");
    expect(logged).toContain("Bearer <redacted>");
    expect(logged).toContain(ISSUE);
  });

  // (8c) TYPE-SAFETY: unknown status string → zero dispatch (no unsafe cast).
  it("does not dispatch when transition.next is not a valid IssueStatus", async () => {
    const { ports, dispatchAgentWork, getIssueBillingInfo } = makePorts();
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("totally_unknown_status", "todo"));

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    // getIssueBillingInfo should still have been called (unknown-status guard runs after billing lookup).
    // Depending on implementation order, it may or may not be called; we only assert no dispatch.
  });

  // (9) getIssueBillingInfo null → zero dispatch.
  it("does not dispatch when getIssueBillingInfo returns null (issue not found/visible)", async () => {
    const { ports, dispatchAgentWork, onArchive } = makePorts({
      getIssueBillingInfo: vi.fn().mockResolvedValue(null),
    });
    const handler = createCrmStatusHandler(ports);

    await handler(transitionEvent("in_progress"));

    expect(dispatchAgentWork).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });
});
