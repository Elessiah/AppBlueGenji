import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { requestHosts } from "@/lib/server/request-origin";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("requestHosts", () => {
  // Les sources `script-src` du dev Turbopack ne nomment que la page servie.
  it("requestHosts_appUrlSet_excludesAppUrlHost", () => {
    jest.replaceProperty(process, "env", { ...process.env, APP_URL: "https://public.example" });

    const actual = requestHosts(new Request("http://localhost:3000/tournois", { headers: { host: "localhost:3000" } }));

    expect(actual).not.toContain("public.example");
  });

  it("requestHosts_forwardedHostList_splitsAndTrims", () => {
    const actual = requestHosts(
      new Request("http://localhost:3000/tournois", { headers: { "x-forwarded-host": "a.test, b.test" } })
    );

    expect(actual).toEqual(expect.arrayContaining(["a.test", "b.test"]));
  });
});
