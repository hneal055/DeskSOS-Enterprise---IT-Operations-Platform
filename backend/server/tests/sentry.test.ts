import { scrubEvent, SENTRY_ENABLED } from "../src/instrument";

// Sentry error tracking (plan task 3.5)
describe("Sentry", () => {
  it("is off in tests and whenever SENTRY_DSN isn't set", () => {
    expect(SENTRY_ENABLED).toBe(false);
  });

  it("removes credentials, API keys, cookies and bodies before sending", () => {
    const event: any = {
      exception: { values: [{ type: "Error", value: "boom" }] },
      request: {
        method: "POST",
        url: "https://FORD-DC01:5543/api/ingest/incidents",
        headers: {
          Authorization: "Bearer eyJhbGciOi.secret",
          "X-API-Key": "ingest-secret",
          Cookie: "a=b",
          "content-type": "application/json",
          "user-agent": "desksos-bridge",
        },
        cookies: { a: "b" },
        data: { title: "Incident", password: "hunter2" },
        query_string: "token=abc",
      },
    };
    const out = scrubEvent(event);
    const json = JSON.stringify(out);
    for (const secret of ["eyJhbGciOi", "ingest-secret", "a=b", "hunter2", "Incident", "token=abc"]) {
      expect(json).not.toContain(secret);
    }
    // What helps debugging is kept
    expect(out.request?.headers).toEqual({ "content-type": "application/json", "user-agent": "desksos-bridge" });
    expect(out.request?.method).toBe("POST");
    expect(out.exception?.values?.[0].value).toBe("boom");
  });

  it("keeps harmless query strings and copes with events without a request", () => {
    const withQuery: any = { request: { query_string: "page=2" } };
    expect(scrubEvent(withQuery).request?.query_string).toBe("page=2");
    const bare: any = { message: "no request" };
    expect(scrubEvent(bare)).toEqual({ message: "no request" });
  });
});
