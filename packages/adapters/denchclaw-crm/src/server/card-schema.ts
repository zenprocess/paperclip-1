import type { IssueStatus, IssuePriority } from "@paperclipai/shared";
import { formatBillingCode } from "./billing-code.js";
import type { DenchClawPerson, DenchClawCompany } from "./types.js";

/**
 * The subset of an issue (card) that the deterministic sync layer produces from a
 * DenchClaw record. Kept decoupled from the server's internal IssueCreateInput so
 * card-schema stays unit-testable without server internals; the sync layer adapts
 * this to issueService.create()/update().
 */
export interface CrmCardInput {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  /** Stable card↔entry link; the sync layer keys idempotency off this. */
  billingCode: string;
  /** Stable per-tenant project key the card belongs to (e.g. "crm-people"). */
  projectKey: string;
}

/** Read a value by trying several likely keys, on the record top-level and in `fields`. */
function pick(record: Record<string, unknown>, keys: string[]): unknown {
  const fields = (record.fields as Record<string, unknown> | undefined) ?? {};
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key];
    if (fields[key] != null && fields[key] !== "") return fields[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function asScore(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** strength_score → lane. ≥80 in_progress, <40 backlog, otherwise todo. Unknown → todo. */
export function statusFromStrengthScore(score: number | undefined): IssueStatus {
  if (score == null) return "todo";
  if (score >= 80) return "in_progress";
  if (score < 40) return "backlog";
  return "todo";
}

/** strength_score → priority. ≥80 high, otherwise medium. */
export function priorityFromStrengthScore(score: number | undefined): IssuePriority {
  return score != null && score >= 80 ? "high" : "medium";
}

function descriptionLines(pairs: Array<[string, string | undefined]>): string {
  return pairs
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => `**${label}:** ${value}`)
    .join("\n");
}

export const CRM_PEOPLE_PROJECT_KEY = "crm-people";
export const CRM_COMPANIES_PROJECT_KEY = "crm-companies";

export function personToCard(person: DenchClawPerson): CrmCardInput {
  const score = asScore(pick(person, ["strengthScore", "Strength Score", "strength_score"]));
  const title =
    asString(pick(person, ["Full Name", "fullName", "full_name", "name", "Name"])) ??
    "(unnamed contact)";
  const description = descriptionLines([
    ["Job Title", asString(pick(person, ["Job Title", "jobTitle", "job_title", "title"]))],
    ["Company", asString(pick(person, ["Company", "company", "company_name"]))],
    ["Email", asString(pick(person, ["Email Address", "email", "Email", "email_address"]))],
  ]);
  return {
    title,
    description,
    status: statusFromStrengthScore(score),
    priority: priorityFromStrengthScore(score),
    billingCode: formatBillingCode("person", person.id),
    projectKey: CRM_PEOPLE_PROJECT_KEY,
  };
}

export function companyToCard(company: DenchClawCompany): CrmCardInput {
  const score = asScore(pick(company, ["strengthScore", "Strength Score", "strength_score"]));
  const label = asString(
    pick(company, ["strengthLabel", "Strength Label", "strength_label"]),
  )?.toLowerCase();
  const title =
    asString(pick(company, ["Company Name", "name", "company_name", "Name"])) ??
    "(unnamed company)";
  const description = descriptionLines([
    ["Industry", asString(pick(company, ["Industry", "industry"]))],
    ["Type", asString(pick(company, ["Type", "type"]))],
    ["Domain", asString(pick(company, ["Domain", "domain", "website"]))],
    ["Notes", asString(pick(company, ["Notes", "notes"]))],
  ]);
  // Company lane prefers the explicit strength_label when present, else the score.
  const status: IssueStatus =
    label === "strong" ? "in_progress" : statusFromStrengthScore(score);
  return {
    title,
    description,
    status,
    priority: priorityFromStrengthScore(score),
    billingCode: formatBillingCode("company", company.id),
    projectKey: CRM_COMPANIES_PROJECT_KEY,
  };
}
