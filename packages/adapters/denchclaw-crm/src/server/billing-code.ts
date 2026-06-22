/**
 * billingCode is the ONLY stable link between a Paperclip card (issue) and a
 * DenchClaw CRM entry. It is encoded into the issue's optional `billingCode`
 * field so the link survives across syncs without a separate mapping table.
 *
 * Format (typed, unambiguous):  dc::<token>::<id>
 *   person          -> dc::person::<entryId>
 *   company         -> dc::company::<entryId>
 *   email_thread    -> dc::thread::<threadId>
 *   calendar_event  -> dc::event::<eventId>
 *
 * Legacy form `dc::<id>` (no token) is still parseable and resolves to the
 * coarse object `"entry"` — callers that need the precise object must consult
 * the issue's project, never trust the code alone for routing decisions.
 */

export type CrmObject = "person" | "company" | "email_thread" | "calendar_event";

const PREFIX = "dc";

const TOKEN_BY_OBJECT: Record<CrmObject, string> = {
  person: "person",
  company: "company",
  email_thread: "thread",
  calendar_event: "event",
};

const OBJECT_BY_TOKEN: Record<string, CrmObject> = {
  person: "person",
  company: "company",
  thread: "email_thread",
  event: "calendar_event",
};

export interface ParsedBillingCode {
  /** Coarse object kind; `"entry"` when the code used the legacy untyped form. */
  object: CrmObject | "entry";
  /** The DenchClaw entry / thread / event id. */
  id: string;
}

/** Encode a stable card↔entry link. Throws on empty id (a silent empty link is a bug). */
export function formatBillingCode(object: CrmObject, id: string): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) {
    throw new Error(`formatBillingCode: id is required for object "${object}"`);
  }
  return `${PREFIX}::${TOKEN_BY_OBJECT[object]}::${trimmed}`;
}

/**
 * Parse a billingCode back to its object + id. Returns null for anything that is
 * not a CRM-owned code (plain issue codes like "PROJ-123", empty, or non-string)
 * so non-CRM cards are never mistaken for CRM cards.
 */
export function parseBillingCode(code: string | null | undefined): ParsedBillingCode | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed.startsWith(`${PREFIX}::`)) return null;

  const rest = trimmed.slice(PREFIX.length + 2); // strip leading "dc::"
  if (!rest) return null;

  const sep = rest.indexOf("::");
  if (sep === -1) {
    // Legacy untyped form: dc::<id>
    return { object: "entry", id: rest };
  }

  const token = rest.slice(0, sep);
  const id = rest.slice(sep + 2);
  if (!id) return null;

  const object = OBJECT_BY_TOKEN[token];
  if (!object) {
    // Unknown token — treat the remainder as a legacy id rather than misroute it.
    return { object: "entry", id: rest };
  }
  return { object, id };
}

/** True only for CRM-owned billing codes (the `dc::` namespace). */
export function isCrmBillingCode(code: string | null | undefined): boolean {
  return parseBillingCode(code) !== null;
}
