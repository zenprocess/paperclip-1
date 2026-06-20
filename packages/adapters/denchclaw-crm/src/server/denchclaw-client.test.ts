import { describe, it, expect } from "vitest";
import { DenchClawClient, DenchClawApiError } from "./denchclaw-client.js";

/** A single recorded fetch call: the url and the init we can assert against. */
interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Build a fake fetch that returns a scripted Response and records every call.
 * The Response uses a real Headers instance so the client's
 * `res.headers.get("content-type")` behaves exactly as it would in production.
 */
function makeFetch(
  response: {
    status?: number;
    ok?: boolean;
    contentType?: string | null;
    body?: unknown;
    /** raw text returned by .json() — overrides body if set */
    json?: () => Promise<unknown>;
  } = {},
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  const contentType =
    response.contentType === undefined ? "application/json" : response.contentType;

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    const headers = new Headers();
    if (contentType !== null) headers.set("content-type", contentType);
    return {
      ok,
      status,
      headers,
      json: response.json ?? (async () => response.body),
    } as unknown as Response;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

describe("DenchClawClient.listPeople", () => {
  it("parses { people: [...] } into the array", async () => {
    const { fetchImpl } = makeFetch({
      body: { people: [{ id: "p1" }, { id: "p2" }] },
    });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    const people = await client.listPeople();

    expect(people).toEqual([{ id: "p1" }, { id: "p2" }]);
  });

  it("returns [] when people is missing", async () => {
    const { fetchImpl } = makeFetch({ body: {} });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    expect(await client.listPeople()).toEqual([]);
  });

  it("returns [] when people is not an array", async () => {
    const { fetchImpl } = makeFetch({ body: { people: "nope" } });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    expect(await client.listPeople()).toEqual([]);
  });
});

describe("DenchClawClient.getCompany error mapping", () => {
  it("returns null on 404", async () => {
    const { fetchImpl } = makeFetch({ status: 404, ok: false });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    expect(await client.getCompany("missing")).toBeNull();
  });

  it("throws DenchClawApiError carrying the status on 5xx", async () => {
    const { fetchImpl } = makeFetch({ status: 503, ok: false });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.getCompany("x")).rejects.toThrow(DenchClawApiError);
    await expect(client.getCompany("x")).rejects.toMatchObject({ status: 503 });
  });
});

describe("DenchClawClient.getCompany shape validation", () => {
  it("returns the company when the 200 body has a string id", async () => {
    const { fetchImpl } = makeFetch({ body: { id: "c1", name: "Acme" } });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    const company = await client.getCompany("c1");

    expect(company).toEqual({ id: "c1", name: "Acme" });
  });

  it("throws DenchClawApiError when the 200 body is {} (missing id)", async () => {
    const { fetchImpl } = makeFetch({ body: {} });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.getCompany("c1")).rejects.toThrow(DenchClawApiError);
    await expect(client.getCompany("c1")).rejects.toMatchObject({
      message: expect.stringContaining("missing id"),
    });
  });

  it("throws DenchClawApiError when the 200 body has a numeric id", async () => {
    const { fetchImpl } = makeFetch({ body: { id: 123 } });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.getCompany("c1")).rejects.toThrow(DenchClawApiError);
  });

  it("throws DenchClawApiError when the 200 body is a JSON array", async () => {
    const { fetchImpl } = makeFetch({ body: [{ id: "c1" }] });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.getCompany("c1")).rejects.toThrow(DenchClawApiError);
    await expect(client.getCompany("c1")).rejects.toMatchObject({
      message: expect.stringContaining("expected object"),
    });
  });

  it("throws DenchClawApiError when the 200 body is JSON null", async () => {
    const { fetchImpl } = makeFetch({ body: null });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.getCompany("c1")).rejects.toThrow(DenchClawApiError);
    await expect(client.getCompany("c1")).rejects.toMatchObject({
      message: expect.stringContaining("expected object"),
    });
  });
});

describe("DenchClawClient non-JSON guard (the HTML trap)", () => {
  it("throws DenchClawApiError instead of silently parsing an HTML body", async () => {
    // A 200 OK that returns the Next.js HTML shell, not JSON. If .json() were
    // called it would reject with a SyntaxError; the content-type guard must
    // short-circuit before that and raise a typed error.
    const { fetchImpl } = makeFetch({
      status: 200,
      ok: true,
      contentType: "text/html; charset=utf-8",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.listPeople()).rejects.toThrow(DenchClawApiError);
  });

  it("throws DenchClawApiError when content-type header is absent", async () => {
    const { fetchImpl } = makeFetch({ status: 200, ok: true, contentType: null });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.listPeople()).rejects.toThrow(DenchClawApiError);
  });
});

describe("DenchClawClient Authorization header", () => {
  it("sends Bearer <token> when serviceToken is set", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { people: [] } });
    const client = new DenchClawClient({
      baseUrl: "https://crm.zp.digital",
      serviceToken: "s3cr3t",
      fetchImpl,
    });

    await client.listPeople();

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer s3cr3t");
  });

  it("omits the Authorization header when no serviceToken is set", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { people: [] } });
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await client.listPeople();

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
  });

  it("omits the Authorization header when serviceToken is null", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { people: [] } });
    const client = new DenchClawClient({
      baseUrl: "https://crm.zp.digital",
      serviceToken: null,
      fetchImpl,
    });

    await client.listPeople();

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
  });
});

describe("DenchClawClient base URL normalization", () => {
  it("strips trailing slashes so the request URL has no double slash", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { people: [] } });
    const client = new DenchClawClient({
      baseUrl: "https://crm.zp.digital///",
      fetchImpl,
    });

    await client.listPeople(50);

    const url = calls[0]?.url ?? "";
    expect(url).toBe("https://crm.zp.digital/api/crm/people?limit=50");
    // No "//" except the one in the protocol.
    expect(url.replace("https://", "")).not.toContain("//");
  });
});

describe("DenchClawClient timeout / abort propagation", () => {
  it("propagates an AbortError from fetch as a rejection (no hang)", async () => {
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    const fetchImpl = (async () => {
      throw abortErr;
    }) as typeof fetch;
    const client = new DenchClawClient({ baseUrl: "https://crm.zp.digital", fetchImpl });

    await expect(client.listPeople()).rejects.toThrow(/abort/i);
  });
});
