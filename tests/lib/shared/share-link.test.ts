import { describe, expect, it, jest } from "@jest/globals";
import { absoluteShareUrl, shareLink, type ShareLinkNavigator } from "@/lib/shared/share-link";

/**
 * Règle du bouton « Partager » (`docs/features/SHARE_EMBEDS.md`) : feuille de
 * partage du système d'abord, copie ensuite, résultat pour la notification.
 */

const URL = "https://bluegenji.fr/suivre/tournois/4";

function abortError(): Error {
  const error = new Error("closed");
  error.name = "AbortError";
  return error;
}

describe("shareLink", () => {
  it("shareLink_shareSucceeds_returnsSharedWithTitle", async () => {
    const share = jest.fn<NonNullable<ShareLinkNavigator["share"]>>().mockResolvedValue(undefined);

    const outcome = await shareLink({ share }, URL, "Coupe");

    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledWith({ url: URL, title: "Coupe" });
  });

  it("shareLink_noTitle_sharesUrlOnly", async () => {
    const share = jest.fn<NonNullable<ShareLinkNavigator["share"]>>().mockResolvedValue(undefined);

    await shareLink({ share }, URL);

    expect(share).toHaveBeenCalledWith({ url: URL });
  });

  it("shareLink_sheetClosed_returnsCancelledWithoutCopy", async () => {
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const share = jest.fn<NonNullable<ShareLinkNavigator["share"]>>().mockRejectedValue(abortError());

    const outcome = await shareLink({ share, clipboard: { writeText } }, URL);

    expect(outcome).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shareLink_shareRefused_fallsBackToCopy", async () => {
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const share = jest.fn<NonNullable<ShareLinkNavigator["share"]>>().mockRejectedValue(new Error("NotAllowedError"));

    const outcome = await shareLink({ share, clipboard: { writeText } }, URL);

    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("shareLink_noShareSheet_copies", async () => {
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    expect(await shareLink({ clipboard: { writeText } }, URL)).toBe("copied");
  });

  it("shareLink_noShareNoClipboard_returnsFailed", async () => {
    expect(await shareLink({}, URL)).toBe("failed");
  });

  it("shareLink_noNavigator_returnsFailed", async () => {
    expect(await shareLink(undefined, URL)).toBe("failed");
  });

  it("shareLink_copyRejected_returnsFailed", async () => {
    const writeText = jest.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("denied"));

    expect(await shareLink({ clipboard: { writeText } }, URL)).toBe("failed");
  });
});

describe("absoluteShareUrl", () => {
  it("absoluteShareUrl_french_keepsPathWithoutPrefix", () => {
    expect(absoluteShareUrl("https://bluegenji.fr", "/suivre/tournois/4", "fr")).toBe(URL);
  });

  it("absoluteShareUrl_english_prefixesEn", () => {
    expect(absoluteShareUrl("https://bluegenji.fr", "/suivre/tournois/4", "en")).toBe(
      "https://bluegenji.fr/en/suivre/tournois/4",
    );
  });

  it("absoluteShareUrl_trailingSlashOrigin_noDoubleSlash", () => {
    expect(absoluteShareUrl("https://bluegenji.fr/", "/suivre/tournois/4", "fr")).toBe(URL);
  });
});
