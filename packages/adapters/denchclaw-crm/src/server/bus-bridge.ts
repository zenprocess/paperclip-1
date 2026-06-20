import { parseBillingCode, type ParsedBillingCode } from "./billing-code.js";
import { actionForStatus, ACTION_PROMPTS, type CrmLaneAction } from "./lane-actions.js";
import { ISSUE_STATUSES, type IssueStatus } from "@paperclipai/shared";

/**
 * Structural subset of the host PluginEvent the bridge needs. Kept local so this
 * package does not take a hard dependency on the plugin SDK just for a type; the
 * real PluginEvent (which has these fields) is structurally compatible at the
 * server wiring site.
 */
export interface CrmIssueEvent {
  eventType: string;
  entityType?: string;
  entityId?: string;
  companyId: string;
  payload: unknown;
}

/** What the bridge needs from the host. All injected so the handler is unit-testable. */
export interface CrmBridgePorts {
  /**
   * Authoritative read of the issue's billingCode + projectKey by id+company.
   * Returns null if the issue does not exist or is not visible to this company.
   * billingCode is the trust anchor — the event payload is never trusted for it.
   *
   * SECURITY REQUIREMENT: The host MUST scope this lookup by companyId — the
   * query must be `WHERE id = issueId AND company_id = companyId`. Returning an
   * issue that belongs to a different company breaks tenant isolation and allows
   * one tenant to trigger CRM agent actions on another tenant's cards.
   */
  getIssueBillingInfo(
    companyId: string,
    issueId: string,
  ): Promise<{ billingCode: string | null } | null>;
  /** Dispatch agent work for a CRM card via the denchclaw_crm transport. */
  dispatchAgentWork(input: {
    companyId: string;
    issueId: string;
    action: Exclude<CrmLaneAction, null | "ARCHIVE">;
    prompt: string;
    denchclawEntryId: string;
    object: ParsedBillingCode["object"];
    newStatus: IssueStatus;
  }): Promise<void>;
  /** Optional: archive the local mapping when a CRM card is cancelled. */
  onArchive?(input: {
    companyId: string;
    issueId: string;
    parsed: ParsedBillingCode;
  }): Promise<void>;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
}

interface StatusPayload {
  status?: unknown;
  _previous?: { status?: unknown } | null;
}

function readStatusTransition(
  payload: unknown,
): { next: string; prev: string | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as StatusPayload;
  if (typeof p.status !== "string" || !p.status) return null;
  const prev =
    p._previous && typeof p._previous === "object" && typeof p._previous.status === "string"
      ? p._previous.status
      : null;
  // Only treat as a transition when we can confirm the status actually changed.
  // If no _previous is present we cannot confirm a transition, so we skip rather
  // than dispatch on every unrelated field edit that also emits issue.updated.
  if (prev === null) return null;
  if (prev === p.status) return null;
  return { next: p.status, prev };
}

// Set of valid IssueStatus values for O(1) membership checks at runtime.
const ISSUE_STATUS_SET = new Set<string>(ISSUE_STATUSES);

/**
 * Redacts auth material from an error message before it reaches any log sink.
 *
 * Removes:
 *   - Bearer tokens:  `Bearer <token>`
 *   - Long token-like runs: any [A-Za-z0-9._-]{24,} sequence that survived the
 *     Bearer pattern (covers API keys, JWTs, and similar credential strings).
 */
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer <redacted>")
    .replace(/[A-Za-z0-9._\-]{24,}/g, "<redacted>");
}

/**
 * Build the issue.updated handler. Returns a function safe to hand to
 * PluginEventBus.subscribe("issue.updated", handler) — it never throws out of the
 * bus (a throwing subscriber would break sibling subscribers).
 */
export function createCrmStatusHandler(ports: CrmBridgePorts) {
  const log = ports.logger ?? {};
  return async function handleIssueUpdated(event: CrmIssueEvent): Promise<void> {
    try {
      if (event.eventType !== "issue.updated") return;
      if (event.entityType && event.entityType !== "issue") return;
      const issueId = event.entityId;
      if (!issueId) return;

      const transition = readStatusTransition(event.payload);
      if (!transition) return;

      // Trust anchor: fetch the issue's real billingCode (never from the payload).
      const info = await ports.getIssueBillingInfo(event.companyId, issueId);
      if (!info) return;
      const parsed = parseBillingCode(info.billingCode);
      if (!parsed) return; // not a CRM-managed card

      // Runtime guard: reject unknown status strings before they reach typed code.
      if (!ISSUE_STATUS_SET.has(transition.next)) return;
      const nextStatus = transition.next as IssueStatus;

      const action = actionForStatus(nextStatus);
      if (action === null) return; // signal-only lane
      if (action === "ARCHIVE") {
        await ports.onArchive?.({ companyId: event.companyId, issueId, parsed });
        return;
      }

      await ports.dispatchAgentWork({
        companyId: event.companyId,
        issueId,
        action,
        prompt: ACTION_PROMPTS[action],
        denchclawEntryId: parsed.id,
        object: parsed.object,
        newStatus: nextStatus,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      log.error?.(
        `denchclaw-crm bus-bridge: dispatch failed for issue ${event.entityId}: ${sanitizeErrorMessage(rawMessage)}`,
      );
      // Swallow: never throw out of a bus subscriber.
    }
  };
}
