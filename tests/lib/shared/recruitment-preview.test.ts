import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_BODY_PREVIEW_MAX,
  RECRUITMENT_HIGHLIGHT_SHORT_LABELS,
  RECRUITMENT_HIGHLIGHTS,
  buildRecruitmentPreview,
  formatRecruitmentBody,
  parseRecruitmentAdAnchor,
  recruitmentAdAnchor,
  resolveHighlightStates,
  selectHighlightedAd,
  type RecruitmentHighlight,
} from "@/lib/shared/recruitment";

describe("buildRecruitmentPreview", () => {
  it("returns an empty, untruncated preview for a missing description", () => {
    for (const value of [null, undefined, "", "   \n\t  "]) {
      expect(buildRecruitmentPreview(value)).toEqual({ text: "", truncated: false });
    }
  });

  it("ignores non-string input (defensive against untyped API payloads)", () => {
    expect(buildRecruitmentPreview(42 as unknown as string)).toEqual({ text: "", truncated: false });
  });

  it("keeps a short description whole and flags it as untruncated", () => {
    expect(buildRecruitmentPreview("On cherche un arbitre.")).toEqual({
      text: "On cherche un arbitre.",
      truncated: false,
    });
  });

  it("collapses newlines, bullets and repeated spaces into a single flowing line", () => {
    const body = "Intro.\n\n\nEn quoi consiste le rôle :\n\n-  Arbitrer\n\n-  Gérer   les litiges";
    expect(buildRecruitmentPreview(body)).toEqual({
      text: "Intro. En quoi consiste le rôle : - Arbitrer - Gérer les litiges",
      truncated: false,
    });
  });

  it("truncates on a word boundary and appends an ellipsis", () => {
    const body = `${"mot ".repeat(200)}fin`;
    const preview = buildRecruitmentPreview(body, 20);
    expect(preview.truncated).toBe(true);
    expect(preview.text).toBe("mot mot mot mot mot…");
    // Jamais de mot coupé en deux, jamais d'espace avant l'ellipse.
    expect(preview.text).not.toMatch(/\s…$/u);
  });

  it("never returns more than `max` characters plus the ellipsis", () => {
    const body = "a".repeat(50) + " " + "b".repeat(500);
    const preview = buildRecruitmentPreview(body, 60);
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(61);
  });

  it("hard-cuts a single word longer than half the limit rather than returning a stub", () => {
    // Une URL sans espace : reculer jusqu'à la dernière espace donnerait « a… ».
    const preview = buildRecruitmentPreview(`a ${"x".repeat(300)}`, 40);
    expect(preview.truncated).toBe(true);
    expect(preview.text).toBe(`a ${"x".repeat(38)}…`);
  });

  it("strips trailing punctuation before the ellipsis", () => {
    const preview = buildRecruitmentPreview("Bonjour, tout le monde ici présent", 8);
    expect(preview.text).toBe("Bonjour…");
  });

  it("treats an exactly-at-the-limit description as untruncated", () => {
    const body = "a".repeat(30);
    expect(buildRecruitmentPreview(body, 30)).toEqual({ text: body, truncated: false });
    expect(buildRecruitmentPreview(`${body}b`, 30).truncated).toBe(true);
  });

  it("clamps a nonsensical limit instead of producing an empty preview", () => {
    for (const max of [0, -10, 0.4]) {
      const preview = buildRecruitmentPreview("Une longue description ici", max);
      expect(preview.truncated).toBe(true);
      expect(preview.text.length).toBeGreaterThan(0);
    }
  });

  it("defaults to the shared preview length", () => {
    const body = "z".repeat(RECRUITMENT_BODY_PREVIEW_MAX + 50);
    expect(buildRecruitmentPreview(body)).toEqual(
      buildRecruitmentPreview(body, RECRUITMENT_BODY_PREVIEW_MAX),
    );
  });
});

describe("formatRecruitmentBody", () => {
  it("returns no block for an empty description", () => {
    for (const value of [null, undefined, "", "  \n  "]) {
      expect(formatRecruitmentBody(value)).toEqual([]);
    }
  });

  it("turns a short line ending with a colon into a heading, without the colon", () => {
    expect(formatRecruitmentBody("Ce que nous offrons:")).toEqual([
      { kind: "heading", text: "Ce que nous offrons" },
    ]);
    expect(formatRecruitmentBody("Ce que nous offrons :")).toEqual([
      { kind: "heading", text: "Ce que nous offrons" },
    ]);
  });

  it("keeps a long line ending with a colon as a paragraph", () => {
    const long = `${"mot ".repeat(30)}:`;
    const blocks = formatRecruitmentBody(long);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
  });

  it("groups bullet lines into one list, even when separated by blank lines", () => {
    const body = "- Arbitrer\n\n- Gérer les litiges\n\n- Faire les check-ins";
    expect(formatRecruitmentBody(body)).toEqual([
      { kind: "list", items: ["Arbitrer", "Gérer les litiges", "Faire les check-ins"] },
    ]);
  });

  it("accepts every bullet marker used by the ads", () => {
    const body = "- tiret\n– demi-cadratin\n— cadratin\n• point\n* étoile";
    expect(formatRecruitmentBody(body)).toEqual([
      { kind: "list", items: ["tiret", "demi-cadratin", "cadratin", "point", "étoile"] },
    ]);
  });

  it("ignores an empty bullet", () => {
    expect(formatRecruitmentBody("- \n- Vrai item")).toEqual([
      { kind: "list", items: ["Vrai item"] },
    ]);
  });

  it("does not mistake a hyphenated word for a bullet", () => {
    // Un tiret collé au mot n'est pas une puce : il faut une espace après.
    expect(formatRecruitmentBody("-immédiat")).toEqual([
      { kind: "paragraph", text: "-immédiat" },
    ]);
  });

  it("joins consecutive plain lines into a single paragraph, keeping the line breaks", () => {
    expect(formatRecruitmentBody("Ligne une\nLigne deux")).toEqual([
      { kind: "paragraph", text: "Ligne une\nLigne deux" },
    ]);
  });

  it("splits paragraphs on blank lines", () => {
    expect(formatRecruitmentBody("Premier\n\nSecond")).toEqual([
      { kind: "paragraph", text: "Premier" },
      { kind: "paragraph", text: "Second" },
    ]);
  });

  it("closes a list when a plain line follows", () => {
    expect(formatRecruitmentBody("- item\nSuite du texte")).toEqual([
      { kind: "list", items: ["item"] },
      { kind: "paragraph", text: "Suite du texte" },
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(formatRecruitmentBody("Titre:\r\n- item\r\n")).toEqual([
      { kind: "heading", text: "Titre" },
      { kind: "list", items: ["item"] },
    ]);
  });

  it("reproduces the shape of a real ad", () => {
    const body = [
      "Suite à une pause, nous recherchons de nouvelles têtes.",
      "",
      "Ce que nous offrons:",
      "Une structure claire et un encadrement professionnel.",
      "",
      "En quoi consiste le rôle:",
      "",
      "- Surveiller les salons textuels.",
      "",
      "- Répondre aux signalements.",
      "",
      "Les outils à disposition:",
      "Trois serveurs Discord.",
    ].join("\n");

    expect(formatRecruitmentBody(body)).toEqual([
      { kind: "paragraph", text: "Suite à une pause, nous recherchons de nouvelles têtes." },
      { kind: "heading", text: "Ce que nous offrons" },
      { kind: "paragraph", text: "Une structure claire et un encadrement professionnel." },
      { kind: "heading", text: "En quoi consiste le rôle" },
      {
        kind: "list",
        items: ["Surveiller les salons textuels.", "Répondre aux signalements."],
      },
      { kind: "heading", text: "Les outils à disposition" },
      { kind: "paragraph", text: "Trois serveurs Discord." },
    ]);
  });
});

/** Fabrique minimale : seuls les champs lus par la résolution comptent. */
function ad(id: number, highlight: RecruitmentHighlight, active = true) {
  return { id, highlight, active };
}

describe("selectHighlightedAd", () => {
  it("returns null when no ad asks to be highlighted", () => {
    expect(selectHighlightedAd([ad(1, "NONE"), ad(2, "NONE")])).toBeNull();
    expect(selectHighlightedAd([])).toBeNull();
  });

  it("returns the first highlighted ad in display order", () => {
    const ads = [ad(1, "NONE"), ad(2, "MODAL"), ad(3, "BANNER")];
    expect(selectHighlightedAd(ads)).toBe(ads[1]);
  });

  it("skips inactive ads: a draft never takes the site-wide slot", () => {
    const ads = [ad(1, "MODAL", false), ad(2, "BANNER")];
    expect(selectHighlightedAd(ads)).toBe(ads[1]);
  });

  it("serves a single ad even when several ask for a modal", () => {
    const ads = [ad(1, "MODAL"), ad(2, "MODAL"), ad(3, "MODAL")];
    expect(selectHighlightedAd(ads)).toBe(ads[0]);
  });

  it("does not privilege one mode over another — order decides", () => {
    expect(selectHighlightedAd([ad(1, "BANNER"), ad(2, "MODAL")])?.id).toBe(1);
    expect(selectHighlightedAd([ad(2, "MODAL"), ad(1, "BANNER")])?.id).toBe(2);
  });
});

describe("resolveHighlightStates", () => {
  it("marks every ad as NONE when none asks for a highlight", () => {
    const states = resolveHighlightStates([ad(1, "NONE"), ad(2, "NONE")]);
    expect(states.get(1)).toBe("NONE");
    expect(states.get(2)).toBe("NONE");
  });

  it("returns an empty map for an empty list", () => {
    expect(resolveHighlightStates([]).size).toBe(0);
  });

  it("puts the winner LIVE and every other highlighted ad QUEUED", () => {
    const states = resolveHighlightStates([
      ad(1, "BANNER"),
      ad(2, "MODAL"),
      ad(3, "NONE"),
      ad(4, "MODAL"),
    ]);
    expect(states.get(1)).toBe("LIVE");
    expect(states.get(2)).toBe("QUEUED");
    expect(states.get(3)).toBe("NONE");
    expect(states.get(4)).toBe("QUEUED");
  });

  it("answers the 'several arrival modals' case: one LIVE, the rest QUEUED", () => {
    const states = resolveHighlightStates([ad(1, "MODAL"), ad(2, "MODAL"), ad(3, "MODAL")]);
    expect([...states.values()]).toEqual(["LIVE", "QUEUED", "QUEUED"]);
  });

  it("marks a highlighted draft as DRAFT, never LIVE nor QUEUED", () => {
    const states = resolveHighlightStates([ad(1, "MODAL", false), ad(2, "BANNER")]);
    expect(states.get(1)).toBe("DRAFT");
    // Le brouillon ne prend pas la place : l'annonce suivante est bien en ligne.
    expect(states.get(2)).toBe("LIVE");
  });

  it("keeps a lone highlighted ad LIVE", () => {
    expect(resolveHighlightStates([ad(1, "MODAL"), ad(2, "NONE")]).get(1)).toBe("LIVE");
  });

  it("swaps LIVE and QUEUED when the ads are reordered", () => {
    const first = ad(1, "BANNER");
    const second = ad(2, "MODAL");
    expect(resolveHighlightStates([first, second]).get(2)).toBe("QUEUED");
    expect(resolveHighlightStates([second, first]).get(2)).toBe("LIVE");
  });

  it("resolves duplicate ids by their first occurrence, like the display does", () => {
    const states = resolveHighlightStates([ad(1, "MODAL"), ad(1, "NONE")]);
    expect(states.size).toBe(1);
    expect(states.get(1)).toBe("LIVE");
  });
});

describe("RECRUITMENT_HIGHLIGHT_SHORT_LABELS", () => {
  it("labels every highlight mode", () => {
    for (const mode of RECRUITMENT_HIGHLIGHTS) {
      expect(RECRUITMENT_HIGHLIGHT_SHORT_LABELS[mode]).toBeTruthy();
    }
  });
});

describe("recruitmentAdAnchor / parseRecruitmentAdAnchor", () => {
  it("round-trips an ad id through its anchor", () => {
    expect(recruitmentAdAnchor(42)).toBe("annonce-42");
    expect(parseRecruitmentAdAnchor(`#${recruitmentAdAnchor(42)}`)).toBe(42);
  });

  it("accepts the fragment with or without its leading hash", () => {
    expect(parseRecruitmentAdAnchor("annonce-7")).toBe(7);
    expect(parseRecruitmentAdAnchor("#annonce-7")).toBe(7);
    expect(parseRecruitmentAdAnchor("  #annonce-7  ")).toBe(7);
  });

  it("rejects anything that does not designate an ad", () => {
    for (const hash of [
      null,
      undefined,
      "",
      "#",
      "#annonce",
      "#annonce-",
      "#annonce-abc",
      "#annonce-1.5",
      "#annonce--1",
      "#annonce-1 extra",
      "#autre-1",
      "#annonce-1#annonce-2",
    ]) {
      expect(parseRecruitmentAdAnchor(hash)).toBeNull();
    }
  });

  it("rejects a zero or oversized id rather than opening 'ad NaN'", () => {
    expect(parseRecruitmentAdAnchor("#annonce-0")).toBeNull();
    expect(parseRecruitmentAdAnchor(`#annonce-${"9".repeat(30)}`)).toBeNull();
  });

  it("ignores a non-string fragment", () => {
    expect(parseRecruitmentAdAnchor(12 as unknown as string)).toBeNull();
  });
});
