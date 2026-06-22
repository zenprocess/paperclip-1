import type { CrmCardInput } from "./card-schema.js";

/**
 * Deterministic, dependency-free checksum for a CrmCardInput.
 *
 * Fields included (FIXED order): title, description, priority, billingCode, projectKey.
 * Field excluded: `status` — the Paperclip lane is user-owned and must never be
 * overwritten by the sync layer.
 *
 * Algorithm: FNV-1a 64-bit over the canonical UTF-16 code units of the JSON string.
 * Returns a 16-character lowercase hex string.
 */
export function cardChecksum(card: CrmCardInput): string {
  const canonical = JSON.stringify({
    title: card.title,
    description: card.description,
    priority: card.priority,
    billingCode: card.billingCode,
    projectKey: card.projectKey,
  });

  // FNV-1a 64-bit (BigInt)
  const FNV_OFFSET = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK64 = 0xFFFFFFFFFFFFFFFFn;

  let hash = FNV_OFFSET;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** A card that already exists in Paperclip, keyed by billingCode. */
export interface ExistingCard {
  /** Paperclip issue id. */
  issueId: string;
  /** The CRM billing code that links this issue to a CRM record. */
  billingCode: string;
  /** The checksum stored at last sync (used to detect content drift). */
  checksum: string;
}

export type SyncAction =
  | { kind: "create"; card: CrmCardInput; checksum: string }
  | { kind: "update"; card: CrmCardInput; checksum: string; issueId: string }
  | { kind: "unchanged"; card: CrmCardInput; checksum: string; issueId: string };

export interface SyncPlan {
  creates: Extract<SyncAction, { kind: "create" }>[];
  updates: Extract<SyncAction, { kind: "update" }>[];
  unchanged: Extract<SyncAction, { kind: "unchanged" }>[];
}

/**
 * Compute a sync plan by diffing incoming CRM cards against existing Paperclip issues.
 *
 * Keying is by `billingCode`:
 * - absent in existing  → create
 * - present, checksum differs → update (carry issueId)
 * - present, checksum equal  → unchanged
 *
 * `status` is intentionally excluded from the checksum so user-managed lane
 * changes in Paperclip never trigger spurious updates.
 */
export function computeSyncPlan(
  cards: CrmCardInput[],
  existing: Map<string, ExistingCard>,
): SyncPlan {
  const creates: Extract<SyncAction, { kind: "create" }>[] = [];
  const updates: Extract<SyncAction, { kind: "update" }>[] = [];
  const unchanged: Extract<SyncAction, { kind: "unchanged" }>[] = [];

  for (const card of cards) {
    const checksum = cardChecksum(card);
    const prior = existing.get(card.billingCode);

    if (prior === undefined) {
      creates.push({ kind: "create", card, checksum });
    } else if (prior.checksum !== checksum) {
      updates.push({ kind: "update", card, checksum, issueId: prior.issueId });
    } else {
      unchanged.push({ kind: "unchanged", card, checksum, issueId: prior.issueId });
    }
  }

  return { creates, updates, unchanged };
}
