import type { IssueStatus } from "@paperclipai/shared";

/**
 * What the agent should be asked to do when a CRM card lands in a lane.
 * `null` = signal-only (logged, no agent dispatch). `ARCHIVE` = mark the local
 * mapping archived; no agent work.
 */
export type CrmLaneAction =
  | "RESEARCH_CONTACT"
  | "DRAFT_OUTREACH"
  | "SUMMARIZE_AND_UPDATE"
  | "ARCHIVE"
  | null;

/**
 * Lane → action table. Keyed by the FULL IssueStatus union so a future status
 * addition is a compile error here (forces an explicit decision rather than a
 * silent dispatch). MVP dispatches on in_progress / in_review / done only.
 */
export const LANE_ACTION_TABLE: Record<IssueStatus, CrmLaneAction> = {
  backlog: null,
  todo: null,
  in_progress: "RESEARCH_CONTACT",
  in_review: "DRAFT_OUTREACH",
  done: "SUMMARIZE_AND_UPDATE",
  blocked: null,
  cancelled: "ARCHIVE",
};

/** Human-readable wake prompts the bus-bridge sends to the DenchClaw agent. */
export const ACTION_PROMPTS: Record<Exclude<CrmLaneAction, null | "ARCHIVE">, string> = {
  RESEARCH_CONTACT:
    "Research this CRM contact and surface concise talking points. Read the CRM record via the DenchClaw API; do not invent data.",
  DRAFT_OUTREACH:
    "Draft a personalized outreach email for this CRM contact based on their CRM record. Do not send it.",
  SUMMARIZE_AND_UPDATE:
    "Summarize the latest interaction with this CRM contact and update their CRM notes via the DenchClaw API.",
};

/** Resolve the action for a status, or null when the status is not a dispatch trigger. */
export function actionForStatus(status: IssueStatus): CrmLaneAction {
  return LANE_ACTION_TABLE[status] ?? null;
}
