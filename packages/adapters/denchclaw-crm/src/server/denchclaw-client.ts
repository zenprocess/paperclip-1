import type {
  DenchClawPerson,
  DenchClawCompany,
  DenchClawPeopleListResponse,
} from "./types.js";

export class DenchClawApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "DenchClawApiError";
  }
}

export interface DenchClawClientOptions {
  baseUrl: string;
  /** Bearer service token; never logged. */
  serviceToken?: string | null;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Read-only typed client for the DenchClaw CRM REST API. NEVER opens the DenchClaw
 * workspace DuckDB file directly (DenchClaw holds the lock) — all reads go through
 * the HTTP API.
 */
export class DenchClawClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DenchClawClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.serviceToken = opts.serviceToken ?? null;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.serviceToken) headers.authorization = `Bearer ${this.serviceToken}`;
      const res = await this.fetchImpl(url, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new DenchClawApiError(
          `DenchClaw GET ${path} failed: ${res.status}`,
          res.status,
          url,
        );
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        // The companies-list path returns the Next.js HTML shell, not JSON — guard it.
        throw new DenchClawApiError(
          `DenchClaw GET ${path} returned non-JSON (content-type: ${ct || "none"})`,
          res.status,
          url,
        );
      }
      const parsed = await res.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new DenchClawApiError(
          `DenchClaw GET ${path} malformed response: expected object`,
          res.status,
          url,
        );
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET /api/crm/people — list contacts with safe pagination.
   *
   * Paginates via `limit` + `offset` until one of the following stop conditions:
   * - a page returns fewer rows than pageSize (last page)
   * - a page yields zero new ids (guards against APIs that ignore `offset`)
   * - maxPages is reached
   *
   * Results are deduplicated by `person.id`.
   */
  async listPeople(opts?: {
    pageSize?: number;
    maxPages?: number;
  }): Promise<DenchClawPerson[]> {
    const pageSize = opts?.pageSize ?? 200;
    const maxPages = opts?.maxPages ?? 50;

    const accumulated: DenchClawPerson[] = [];
    const seenIds = new Set<string>();

    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      const data = await this.get<DenchClawPeopleListResponse>(
        `/api/crm/people?limit=${encodeURIComponent(String(pageSize))}&offset=${encodeURIComponent(String(offset))}`,
      );
      const people = Array.isArray(data?.people) ? data.people : [];

      let newIdsThisPage = 0;
      for (const person of people) {
        if (!seenIds.has(person.id)) {
          seenIds.add(person.id);
          accumulated.push(person);
          newIdsThisPage++;
        }
      }

      // Stop when this page yielded zero new ids (e.g. API ignores offset)
      if (newIdsThisPage === 0) break;

      // Stop when page is smaller than pageSize (last page)
      if (people.length < pageSize) break;
    }

    return accumulated;
  }

  /** GET /api/crm/companies/:id — returns null on 404. */
  async getCompany(id: string): Promise<DenchClawCompany | null> {
    const path = `/api/crm/companies/${encodeURIComponent(id)}`;
    try {
      const data = await this.get<Record<string, unknown>>(path);
      if (typeof (data as Record<string, unknown>).id !== "string") {
        const url = `${this.baseUrl}${path}`;
        throw new DenchClawApiError(
          "DenchClaw GET company malformed company response: missing id",
          200,
          url,
        );
      }
      return data as unknown as DenchClawCompany;
    } catch (err) {
      if (err instanceof DenchClawApiError && err.status === 404) return null;
      throw err;
    }
  }
}
