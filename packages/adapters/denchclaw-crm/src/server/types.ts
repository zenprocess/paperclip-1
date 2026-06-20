/**
 * DenchClaw CRM record shapes.
 *
 * ASSUMPTION (unverified): the live DenchClaw CRM API (crm.zp.digital) returned
 * empty collections during design, so the exact field naming is not pinned. These
 * types are therefore intentionally permissive: a stable `id` plus an open `fields`
 * map (DenchClaw is EAV — entries + entry_fields keyed by human labels) plus a few
 * optional flattened accessors. The card-schema reader tolerates multiple likely
 * key spellings rather than hard-coding one. Confirm field names against a populated
 * workspace before tightening these.
 */

export interface DenchClawPerson {
  id: string;
  /** EAV field map keyed by human label (e.g. "Full Name", "Job Title"). */
  fields?: Record<string, unknown>;
  /** Optional flattened accessors some API shapes provide. */
  fullName?: string;
  jobTitle?: string;
  company?: string;
  email?: string;
  strengthScore?: number;
  [key: string]: unknown;
}

export interface DenchClawCompany {
  id: string;
  fields?: Record<string, unknown>;
  name?: string;
  industry?: string;
  type?: string;
  domain?: string;
  notes?: string;
  strengthScore?: number;
  strengthLabel?: string;
  [key: string]: unknown;
}

/** Shape of the list endpoints, e.g. GET /api/crm/people -> { people: [...] }. */
export interface DenchClawPeopleListResponse {
  people: DenchClawPerson[];
}
