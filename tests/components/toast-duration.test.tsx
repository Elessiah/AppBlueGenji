import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TOAST_DURATION_MS, ToastItem } from "@/components/ui/toast";
import { fetchProfilelessIds } from "@/components/profileless-players";

const noop = () => undefined;

describe("ToastItem — durée", () => {
  it("ToastItem_noDuration_usesDefault", () => {
    const html = renderToStaticMarkup(<ToastItem toast={{ id: 1, message: "ok", type: "success" }} onDismiss={noop} />);
    expect(html).toContain(`animation-duration:${TOAST_DURATION_MS}ms`);
  });

  it("ToastItem_customDuration_drainsOverThatDuration", () => {
    const html = renderToStaticMarkup(
      <ToastItem toast={{ id: 1, message: "long", type: "error", durationMs: 10000 }} onDismiss={noop} />,
    );
    expect(html).toContain("animation-duration:10000ms");
  });
});

describe("fetchProfilelessIds", () => {
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("fetchProfilelessIds_nonOk_returnsNull", async () => {
    expect(await fetchProfilelessIds(respond(500, {}))).toBeNull();
  });

  it("fetchProfilelessIds_networkError_returnsNull", async () => {
    const failing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await fetchProfilelessIds(failing)).toBeNull();
  });

  it("fetchProfilelessIds_badBody_returnsNull", async () => {
    expect(await fetchProfilelessIds(respond(200, { nope: true }))).toBeNull();
  });
});
