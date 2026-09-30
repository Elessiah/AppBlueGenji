import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_SUSPENDED,
  SUSPENSION_DURATION_PRESETS,
  SUSPENSION_GROUNDS,
  SUSPENSION_GROUND_DEFINITIONS,
  SUSPENSION_MAX_DAYS,
  SUSPENSION_REASON_MAX_LENGTH,
  cleanModerationReason,
  encodeSuspensionNotice,
  formatSuspensionEnd,
  formatSuspensionLiftedLog,
  formatSuspensionLiftedNotice,
  formatSuspensionLog,
  formatSuspensionNotice,
  isSuspensionActive,
  isSuspensionGround,
  parseSuspensionNotice,
  suspendedLoginMessage,
  suspensionErrorMessage,
  suspensionReference,
  suspensionSpan,
  toSuspensionNotice,
  validateSuspensionInput,
} from "@/lib/shared/account-suspension";
import { TERMS_SECTIONS } from "@/lib/shared/terms-of-use";
import { PRIVACY_DM_MAX_LENGTH } from "@/lib/shared/privacy-changes";

const REASON = "Propos haineux répétés pendant un match du tournoi";

describe("validateSuspensionInput", () => {
  it("accepte une suspension à terme et une suspension indéterminée", () => {
    expect(validateSuspensionInput({ reason: REASON, ground: "BEHAVIOR", durationDays: 7 })).toEqual({
      ok: true,
      value: { reason: REASON, ground: "BEHAVIOR", durationDays: 7 },
    });
    expect(validateSuspensionInput({ reason: REASON, ground: "CONTENT", durationDays: null })).toEqual({
      ok: true,
      value: { reason: REASON, ground: "CONTENT", durationDays: null },
    });
  });

  it("met le motif sur une ligne, espaces en trop retirés", () => {
    const result = validateSuspensionInput({ reason: "  Triche\n\n avérée   en finale  ", ground: "BEHAVIOR", durationDays: 1 });
    expect(result).toEqual({ ok: true, value: { reason: "Triche avérée en finale", ground: "BEHAVIOR", durationDays: 1 } });
  });

  it.each<[string, unknown, string]>([
    ["corps absent", undefined, "SUSPENSION_REASON_REQUIRED"],
    ["motif absent", { ground: "BEHAVIOR", durationDays: 1 }, "SUSPENSION_REASON_REQUIRED"],
    ["motif trop court", { reason: "abus", ground: "BEHAVIOR", durationDays: 1 }, "SUSPENSION_REASON_REQUIRED"],
    ["motif fait d'espaces", { reason: "            ", ground: "BEHAVIOR", durationDays: 1 }, "SUSPENSION_REASON_REQUIRED"],
    ["motif trop long", { reason: "x".repeat(SUSPENSION_REASON_MAX_LENGTH + 1), ground: "BEHAVIOR", durationDays: 1 }, "SUSPENSION_REASON_TOO_LONG"],
    ["clause inconnue", { reason: REASON, ground: "OTHER", durationDays: 1 }, "SUSPENSION_INVALID_GROUND"],
    ["clause absente", { reason: REASON, durationDays: 1 }, "SUSPENSION_INVALID_GROUND"],
    ["durée absente", { reason: REASON, ground: "BEHAVIOR" }, "SUSPENSION_DURATION_REQUIRED"],
    ["durée nulle", { reason: REASON, ground: "BEHAVIOR", durationDays: 0 }, "SUSPENSION_INVALID_DURATION"],
    ["durée fractionnaire", { reason: REASON, ground: "BEHAVIOR", durationDays: 1.5 }, "SUSPENSION_INVALID_DURATION"],
    ["durée en texte", { reason: REASON, ground: "BEHAVIOR", durationDays: "7" }, "SUSPENSION_INVALID_DURATION"],
    ["durée au-delà du plafond", { reason: REASON, ground: "BEHAVIOR", durationDays: SUSPENSION_MAX_DAYS + 1 }, "SUSPENSION_INVALID_DURATION"],
  ])("refuse : %s", (_label, input, error) => {
    expect(validateSuspensionInput(input)).toEqual({ ok: false, error });
  });

  it("accepte les bornes exactes du motif et de la durée", () => {
    expect(validateSuspensionInput({ reason: "x".repeat(10), ground: "ACCOUNT", durationDays: SUSPENSION_MAX_DAYS }).ok).toBe(true);
    expect(validateSuspensionInput({ reason: "x".repeat(SUSPENSION_REASON_MAX_LENGTH), ground: "ACCOUNT", durationDays: 1 }).ok).toBe(true);
  });

  it("propose des durées toutes valides, dont l'indéterminée", () => {
    for (const durationDays of SUSPENSION_DURATION_PRESETS) {
      expect(validateSuspensionInput({ reason: REASON, ground: "BEHAVIOR", durationDays }).ok).toBe(true);
    }
    expect(SUSPENSION_DURATION_PRESETS).toContain(null);
  });
});

describe("clauses des conditions", () => {
  it("désigne chacune une section existante des conditions d'utilisation", () => {
    const anchors = TERMS_SECTIONS.map((section) => section.id);
    for (const ground of SUSPENSION_GROUNDS) {
      const definition = SUSPENSION_GROUND_DEFINITIONS[ground];
      expect(anchors).toContain(definition.anchor);
      expect(TERMS_SECTIONS.find((section) => section.id === definition.anchor)?.title).toBe(definition.clause);
    }
  });

  it("reconnaît les seules clauses connues", () => {
    expect(isSuspensionGround("BEHAVIOR")).toBe(true);
    expect(isSuspensionGround("behavior")).toBe(false);
    expect(isSuspensionGround(null)).toBe(false);
  });
});

describe("isSuspensionActive", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const base = { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-20T00:00:00Z", liftedAt: null };

  it("court entre le début et l'échéance", () => {
    expect(isSuspensionActive(base, now)).toBe(true);
  });

  it("court sans échéance tant qu'elle n'est pas levée", () => {
    expect(isSuspensionActive({ ...base, endsAt: null }, now)).toBe(true);
  });

  it("ne court plus une fois levée, échue ou pas encore commencée", () => {
    expect(isSuspensionActive({ ...base, liftedAt: "2026-10-05T00:00:00Z" }, now)).toBe(false);
    expect(isSuspensionActive({ ...base, endsAt: "2026-10-10T12:00:00Z" }, now)).toBe(false);
    expect(isSuspensionActive({ ...base, startsAt: "2026-10-11T00:00:00Z" }, now)).toBe(false);
  });
});

describe("dates et références", () => {
  it("écrit l'échéance en heure de Paris, heure comprise", () => {
    // 22 h UTC le 14 octobre = minuit le 15 à Paris (heure d'été).
    expect(formatSuspensionEnd("2026-10-14T22:00:00.000Z")).toBe("15 octobre 2026 à 00:00 (heure de Paris)");
  });

  it("dit une durée indéterminée plutôt qu'une date inventée", () => {
    expect(suspensionSpan(null)).toBe("pour une durée indéterminée");
    expect(suspensionSpan("2026-10-14T22:00:00.000Z")).toBe("jusqu'au 15 octobre 2026 à 00:00 (heure de Paris)");
  });

  it("nomme une décision par une référence à citer", () => {
    expect(suspensionReference(42)).toBe("S-42");
  });
});

describe("exposé des motifs au joueur (DSA art. 17)", () => {
  const notice = formatSuspensionNotice({
    id: 9,
    reason: REASON,
    ground: "BEHAVIOR",
    endsAt: "2026-10-14T22:00:00.000Z",
    termsUrl: "https://site.test/conditions-utilisation#comportement",
  });

  it("dit la décision, sa durée, ses faits, son mode et son fondement", () => {
    expect(notice).toContain("suspendu jusqu'au 15 octobre 2026");
    expect(notice).toContain("décision S-9");
    expect(notice).toContain(`Faits retenus : ${REASON}.`);
    expect(notice).toContain("sans traitement automatisé");
    expect(notice).toContain("« Comportement » — https://site.test/conditions-utilisation#comportement");
  });

  it("donne le recours interne puis le juge, sans compte", () => {
    expect(notice).toContain("« Signaler un problème »");
    expect(notice).toContain("catégorie « Autre » (sans connexion)");
    expect(notice).toContain("en citant la décision S-9");
    expect(notice).toContain("réexamine sa décision");
    expect(notice.indexOf("réexamine")).toBeLessThan(notice.indexOf("juge compétent"));
  });

  it("désamorce le balisage Discord d'un motif saisi", () => {
    const hostile = formatSuspensionNotice({
      id: 1,
      reason: "Mention @everyone et <@123> sur\ndeux lignes",
      ground: "ACCOUNT",
      endsAt: null,
      termsUrl: "https://site.test/x",
    });
    expect(hostile).not.toContain("@everyone");
    expect(hostile).not.toContain("<@123>");
    expect(hostile).not.toContain("\n");
    expect(hostile).toContain("pour une durée indéterminée");
  });

  it("tient dans un message Discord au motif le plus long", () => {
    const longest = formatSuspensionNotice({
      id: 999999,
      reason: "é".repeat(SUSPENSION_REASON_MAX_LENGTH),
      ground: "CONTENT",
      endsAt: "2026-10-14T22:00:00.000Z",
      termsUrl: "https://bluegenji-esport.fr/conditions-utilisation#contenus",
    });
    expect(longest.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("annonce la levée avec la référence", () => {
    expect(formatSuspensionLiftedNotice(9)).toContain("décision S-9");
    expect(formatSuspensionLiftedNotice(9)).toContain("levée");
  });
});

describe("journal du staff", () => {
  it("ne porte ni pseudo ni motif", () => {
    const line = formatSuspensionLog({ id: 4, ground: "BEHAVIOR", endsAt: null });
    expect(line).toContain("un joueur");
    expect(line).toContain("S-4");
    expect(line).toContain("« Comportement »");
    expect(line).not.toContain(REASON);
    expect(formatSuspensionLiftedLog(4)).toBe("✅ Suspension S-4 levée par le staff.");
  });
});

describe("exposé à la connexion refusée", () => {
  const notice = toSuspensionNotice({ id: 5, reason: REASON, ground: "CONTENT", endsAt: "2026-10-14T22:00:00.000Z" });

  it("fait l'aller-retour par le cookie", () => {
    expect(notice).toEqual({ reference: "S-5", reason: REASON, ground: "CONTENT", endsAt: "2026-10-14T22:00:00.000Z" });
    expect(parseSuspensionNotice(encodeSuspensionNotice(notice))).toEqual(notice);
    // Le corps de réponse arrive déjà décodé.
    expect(parseSuspensionNotice(notice)).toEqual(notice);
  });

  it.each<[string, unknown]>([
    ["absent", undefined],
    ["illisible", "%E0%A4%A"],
    ["en base64 d'octets invalides", "_w"],
    ["pas du JSON", "abc"],
    ["référence fausse", { ...notice, reference: "42" }],
    ["motif trop long", { ...notice, reason: "x".repeat(SUSPENSION_REASON_MAX_LENGTH + 1) }],
    ["clause inconnue", { ...notice, ground: "OTHER" }],
    ["échéance illisible", { ...notice, endsAt: "demain" }],
    ["échéance d'un autre type", { ...notice, endsAt: 12 }],
  ])("rejette un exposé %s", (_label, value) => {
    expect(parseSuspensionNotice(value)).toBeNull();
  });

  it("tient sous la limite d'un cookie au motif le plus lourd, même réencodé", () => {
    for (const char of ["é", "Ж", "’", "😀"]) {
      const reason = char.repeat(Math.floor(SUSPENSION_REASON_MAX_LENGTH / char.length));
      const heavy = toSuspensionNotice({ id: 999999, reason, ground: "CONTENT", endsAt: "2026-10-14T22:00:00.000Z" });
      const encoded = encodeSuspensionNotice(heavy);
      // base64url : un réencodage d'URL ne le change pas.
      expect(encodeURIComponent(encoded)).toBe(encoded);
      expect(`bg_suspension_notice=${encoded}; Path=/connexion; Max-Age=600; HttpOnly; SameSite=lax; Secure`.length).toBeLessThan(4096);
      expect(parseSuspensionNotice(encoded)).toEqual(heavy);
    }
  });

  it("garde une échéance nulle (durée indéterminée)", () => {
    expect(parseSuspensionNotice({ ...notice, endsAt: null })?.endsAt).toBeNull();
  });

  it("donne une phrase de repli qui dit comment contester", () => {
    expect(suspendedLoginMessage(null)).toContain("pour une durée indéterminée");
    expect(suspendedLoginMessage("n'importe quoi")).toContain("pour une durée indéterminée");
    expect(suspendedLoginMessage("2026-10-14T22:00:00.000Z")).toContain("jusqu'au 15 octobre 2026");
    expect(suspendedLoginMessage(null)).toContain("catégorie « Autre »");
    expect(suspendedLoginMessage(null)).toContain("juge compétent");
    expect(ACCOUNT_SUSPENDED).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("cleanModerationReason et messages d'erreur", () => {
  it("rend une chaîne vide pour une valeur non textuelle", () => {
    expect(cleanModerationReason(42)).toBe("");
    expect(cleanModerationReason(null)).toBe("");
  });

  it.each([
    "SUSPENSION_REASON_REQUIRED",
    "SUSPENSION_REASON_TOO_LONG",
    "SUSPENSION_INVALID_GROUND",
    "SUSPENSION_DURATION_REQUIRED",
    "SUSPENSION_INVALID_DURATION",
    "ACCOUNT_ALREADY_SUSPENDED",
    "NO_ACTIVE_SUSPENSION",
    "CANNOT_SUSPEND_SELF",
    "CANNOT_SUSPEND_ADMIN",
    "USER_NOT_FOUND",
  ])("dit %s en français, jamais le code", (code) => {
    const message = suspensionErrorMessage(code);
    expect(message).not.toContain(code);
    expect(message).not.toBe(suspensionErrorMessage("INCONNU"));
  });
});
