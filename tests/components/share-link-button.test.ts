/**
 * Geste « Partager » (`docs/features/SHARE_EMBEDS.md`) : le crochet garde la
 * même fonction d'un rendu à l'autre — la carte d'un match se redessine à
 * chaque mise à jour du flux. Le dépôt n'a pas de DOM de test : la source est lue.
 */
import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

const SOURCE = readSource("components/share/ShareLinkButton.tsx");

describe("useShareLink", () => {
  it("useShareLink_rerender_sameFunctionWhileTextAndToastsUnchanged", () => {
    expect(SOURCE).toMatch(/return useCallback\(\s*async \(path: string, title\?: string\) =>/);
    expect(SOURCE).toMatch(/\[t, locale, showError, showSuccess\],\s*\);\s*\}/);
  });

  it("ShareLinkButton_click_usesTheSharedHook", () => {
    expect(SOURCE).toMatch(/const share = useShareLink\(\);[\s\S]*onClick=\{\(\) => void share\(path, title\)\}/);
  });
});
