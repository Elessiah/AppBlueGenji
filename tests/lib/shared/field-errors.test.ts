import { describe, expect, it } from "@jest/globals";
import {
  CodedError,
  DATE_ORDER_CODES,
  DISCORD_VERIFICATION_FIELD_ERRORS,
  FIELD_ERROR_FOCUS_ATTRIBUTE,
  LOGIN_FIELD_ERRORS,
  PLAYER_PSEUDO_FIELD_ERRORS,
  PROFILE_FIELD_ERRORS,
  TEAM_IDENTITY_FIELD_ERRORS,
  TOURNAMENT_FIELD_ERRORS,
  clearFlag,
  describedBy,
  errorCode,
  fieldAria,
  fieldErrorId,
  fieldForError,
  firstMisplacedDate,
  flagFromCode,
  focusFlaggedField,
  isFieldErrorFocus,
} from "@/lib/shared/field-errors";
import { teamErrorMessage } from "@/app/(secured)/equipes/_lib/team-errors";
import { discordVerificationErrorMessage } from "@/app/(secured)/profil/discord-errors";
import { PROFILE_INPUT_ERRORS } from "@/lib/shared/profile-input-errors";
import { checkTeamTag } from "@/lib/shared/team-tag";
import { checkTeamName } from "@/lib/shared/team-name";

describe("fieldForError", () => {
  it("rend le champ désigné par un code connu", () => {
    expect(fieldForError("PSEUDO_ALREADY_USED", PROFILE_FIELD_ERRORS)).toBe("pseudo");
    expect(fieldForError("TEAM_TAG_ALREADY_USED", TEAM_IDENTITY_FIELD_ERRORS)).toBe("tag");
  });

  it("ne rattache à rien un code qui ne tient pas à une saisie", () => {
    // Session expirée, réseau, droits : aucun champ n'y peut rien.
    for (const code of ["UNAUTHORIZED", "NETWORK_ERROR", "FORBIDDEN", "PROFILE_UPDATE_FAILED"]) {
      expect(fieldForError(code, PROFILE_FIELD_ERRORS)).toBeNull();
    }
  });

  it("ignore un code absent ou vide", () => {
    expect(fieldForError(null, PROFILE_FIELD_ERRORS)).toBeNull();
    expect(fieldForError(undefined, PROFILE_FIELD_ERRORS)).toBeNull();
    expect(fieldForError("", PROFILE_FIELD_ERRORS)).toBeNull();
  });

  it("ne lit pas les propriétés héritées d'Object.prototype", () => {
    expect(fieldForError("constructor", PROFILE_FIELD_ERRORS)).toBeNull();
    expect(fieldForError("toString", TEAM_IDENTITY_FIELD_ERRORS)).toBeNull();
    expect(fieldForError("__proto__", LOGIN_FIELD_ERRORS)).toBeNull();
  });
});

describe("flagFromCode / clearFlag", () => {
  it("signale le champ avec la phrase du refus", () => {
    expect(flagFromCode("INVALID_CODE", "Le code doit contenir 6 chiffres.", LOGIN_FIELD_ERRORS)).toEqual({
      field: "code",
      message: "Le code doit contenir 6 chiffres.",
    });
  });

  it("un refus qui ne désigne aucun champ efface le signalement", () => {
    expect(flagFromCode("TOO_MANY_REQUESTS", "Trop de tentatives.", LOGIN_FIELD_ERRORS)).toBeNull();
  });

  it("lever sans champ efface tout", () => {
    expect(clearFlag({ field: "name", message: "x" })).toBeNull();
    expect(clearFlag(null)).toBeNull();
  });

  it("lever un champ ne touche pas le refus d'un autre", () => {
    const flagged = { field: "tag" as const, message: "Sigle déjà pris." };
    expect(clearFlag<"name" | "tag">(flagged, "name")).toBe(flagged);
    expect(clearFlag<"name" | "tag">(flagged, "tag")).toBeNull();
  });
});

describe("describedBy", () => {
  it("garde l'ordre, retire vides et doublons", () => {
    expect(describedBy("a-error", null, "a-help", false, undefined, "a-help")).toBe("a-error a-help");
  });

  it("découpe une valeur qui en porte déjà plusieurs", () => {
    expect(describedBy("x y", "y z")).toBe("x y z");
  });

  it("rend undefined quand il ne reste rien", () => {
    expect(describedBy()).toBeUndefined();
    expect(describedBy(null, false, "")).toBeUndefined();
  });
});

describe("fieldAria", () => {
  it("invalide : aria-invalid, puis la phrase du refus avant l'aide", () => {
    expect(fieldAria("team-name", true, "team-name-help")).toEqual({
      "aria-invalid": true,
      "aria-describedby": "team-name-error team-name-help",
    });
  });

  it("valide : aria-invalid absent, l'aide seule", () => {
    const aria = fieldAria("team-name", false, "team-name-help");
    expect(aria).toEqual({ "aria-describedby": "team-name-help" });
    expect("aria-invalid" in aria).toBe(false);
  });

  it("valide et sans aide : aucun attribut", () => {
    expect(fieldAria("login-code", false)).toEqual({});
  });

  it("l'identifiant du texte d'erreur dérive de celui du champ", () => {
    expect(fieldErrorId("profile-pseudo")).toBe("profile-pseudo-error");
    expect(fieldAria("profile-pseudo", true)["aria-describedby"]).toBe(fieldErrorId("profile-pseudo"));
  });
});

describe("firstMisplacedDate", () => {
  const order = (a: string, b: string, c: string, d: string) =>
    firstMisplacedDate([
      ["visibility", a],
      ["open", b],
      ["close", c],
      ["start", d],
    ] as const);

  it("rend null sur une suite en ordre, égalités comprises (comme le serveur)", () => {
    expect(order("2026-10-01T10:00", "2026-10-02T10:00", "2026-10-03T10:00", "2026-10-04T10:00")).toBeNull();
    expect(order("2026-10-01T10:00", "2026-10-01T10:00", "2026-10-01T10:00", "2026-10-01T10:00")).toBeNull();
  });

  it("désigne le premier jalon antérieur à son précédent", () => {
    expect(order("2026-10-01T10:00", "2026-10-02T10:00", "2026-10-01T12:00", "2026-10-04T10:00")).toBe("close");
    expect(order("2026-10-05T10:00", "2026-10-02T10:00", "2026-10-03T10:00", "2026-10-04T10:00")).toBe("open");
  });

  it("désigne un jalon illisible, même en tête", () => {
    expect(order("", "2026-10-02T10:00", "2026-10-03T10:00", "2026-10-04T10:00")).toBe("visibility");
    expect(order("2026-10-01T10:00", "2026-10-02T10:00", "pas une date", "2026-10-04T10:00")).toBe("close");
  });

  it("les deux codes de date du serveur renvoient à cette lecture", () => {
    expect([...DATE_ORDER_CODES].sort()).toEqual(["INVALID_DATES", "INVALID_DATE_ORDER"]);
    for (const code of DATE_ORDER_CODES) expect(fieldForError(code, TOURNAMENT_FIELD_ERRORS)).toBeNull();
  });
});

describe("tables des formulaires", () => {
  it("chaque refus de saisie du profil désigne un champ", () => {
    // Un refus ajouté à la liste partagée sans champ serait annoncé sans
    // qu'aucun contrôle ne se signale.
    for (const code of PROFILE_INPUT_ERRORS) expect(fieldForError(code, PROFILE_FIELD_ERRORS)).not.toBeNull();
  });

  it("les refus de forme du nom et du sigle d'équipe désignent leur champ", () => {
    const name = checkTeamName("ab");
    expect(name.ok).toBe(false);
    if (!name.ok) expect(fieldForError(name.reason, TEAM_IDENTITY_FIELD_ERRORS)).toBe("name");
    for (const raw of ["A", "ABCDE", "A-B"]) {
      const tag = checkTeamTag(raw);
      expect(tag.ok).toBe(false);
      if (!tag.ok) expect(fieldForError(tag.reason, TEAM_IDENTITY_FIELD_ERRORS)).toBe("tag");
    }
  });

  it("la connexion rattache tag et code, jamais un plafond de débit", () => {
    expect(fieldForError("DISCORD_USER_NOT_FOUND", LOGIN_FIELD_ERRORS)).toBe("handle");
    expect(fieldForError("CODE_INVALID_OR_EXPIRED", LOGIN_FIELD_ERRORS)).toBe("code");
    expect(fieldForError("TOO_MANY_CODE_REQUESTS", LOGIN_FIELD_ERRORS)).toBeNull();
  });
});

describe("CodedError / errorCode", () => {
  it("garde le code à côté de la phrase affichée", () => {
    const error = new CodedError("MISSING_NAME", "Le nom du tournoi est obligatoire.");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Le nom du tournoi est obligatoire.");
    expect(errorCode(error)).toBe("MISSING_NAME");
  });

  it("une erreur ordinaire n'a pas de code", () => {
    expect(errorCode(new Error("MISSING_NAME"))).toBeNull();
    expect(errorCode(new TypeError("Failed to fetch"))).toBeNull();
    expect(errorCode("MISSING_NAME")).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe("tables des formulaires — pseudo d'un joueur et certification Discord", () => {
  it("l'invitation et l'attribution d'une fantôme rattachent au pseudo les refus qui le visent", () => {
    for (const code of ["USER_NOT_FOUND", "ALREADY_INVITED", "USER_ALREADY_IN_TEAM", "MISSING_PSEUDO"]) {
      expect(fieldForError(code, PLAYER_PSEUDO_FIELD_ERRORS)).toBe("pseudo");
    }
  });

  it("le pseudo ne se signale pas pour un refus qu'aucune saisie ne lève", () => {
    // Droits, réseau, équipe dissoute, rôles manquants : un autre pseudo n'y
    // changerait rien.
    for (const code of ["FORBIDDEN", "NETWORK_ERROR", "TEAM_DELETED", "NOT_A_GHOST_TEAM", "MISSING_ROLE"]) {
      expect(fieldForError(code, PLAYER_PSEUDO_FIELD_ERRORS)).toBeNull();
    }
  });

  it("chaque refus rattaché au pseudo a sa phrase française", () => {
    const fallback = teamErrorMessage("__INCONNU__");
    for (const code of Object.keys(PLAYER_PSEUDO_FIELD_ERRORS)) {
      expect(teamErrorMessage(code)).not.toBe(fallback);
    }
  });

  it("la certification rattache tag et code, jamais le bot ni un plafond de débit", () => {
    expect(fieldForError("DISCORD_USER_NOT_FOUND", DISCORD_VERIFICATION_FIELD_ERRORS)).toBe("handle");
    expect(fieldForError("DISCORD_ID_MISMATCH", DISCORD_VERIFICATION_FIELD_ERRORS)).toBe("handle");
    expect(fieldForError("INVALID_CODE", DISCORD_VERIFICATION_FIELD_ERRORS)).toBe("code");
    expect(fieldForError("CODE_INVALID_OR_EXPIRED", DISCORD_VERIFICATION_FIELD_ERRORS)).toBe("code");
    for (const code of [
      "BOT_INTERNAL_UNREACHABLE",
      "BOT_RESOLVE_TIMEOUT",
      "TOO_MANY_CODE_REQUESTS",
      "DISCORD_DM_FAILED",
      "DISCORD_ALREADY_LINKED",
    ]) {
      expect(fieldForError(code, DISCORD_VERIFICATION_FIELD_ERRORS)).toBeNull();
    }
  });

  it("chaque refus rattaché de la certification a sa phrase française", () => {
    const fallback = discordVerificationErrorMessage("__INCONNU__");
    for (const code of Object.keys(DISCORD_VERIFICATION_FIELD_ERRORS)) {
      expect(discordVerificationErrorMessage(code)).not.toBe(fallback);
    }
  });
});

/** Élément minimal : attributs, et un `focus()` qui appelle un gestionnaire. */
function fakeField(onFocus: (el: HTMLElement) => void = () => {}): HTMLElement {
  const attributes = new Map<string, string>();
  const el = {
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    focus: () => onFocus(el as unknown as HTMLElement),
  };
  return el as unknown as HTMLElement;
}

describe("focusFlaggedField / isFieldErrorFocus", () => {
  it("marque le champ pendant le focus, pour qu'un gestionnaire le reconnaisse", () => {
    const seen: boolean[] = [];
    focusFlaggedField(fakeField((el) => seen.push(isFieldErrorFocus(el))));
    expect(seen).toEqual([true]);
  });

  it("retire la marque aussitôt : le focus suivant, celui du joueur, n'en porte aucune", () => {
    const field = fakeField();
    focusFlaggedField(field);
    expect(field.hasAttribute(FIELD_ERROR_FOCUS_ATTRIBUTE)).toBe(false);
    expect(isFieldErrorFocus(field)).toBe(false);
  });

  it("retire la marque même si le focus lève", () => {
    const field = fakeField(() => {
      throw new Error("focus impossible");
    });
    expect(() => focusFlaggedField(field)).toThrow("focus impossible");
    expect(isFieldErrorFocus(field)).toBe(false);
  });

  it("ne fait rien sans champ, et ne lit rien sur un élément absent", () => {
    expect(() => focusFlaggedField(null)).not.toThrow();
    expect(() => focusFlaggedField(undefined)).not.toThrow();
    expect(isFieldErrorFocus(null)).toBe(false);
    expect(isFieldErrorFocus(undefined)).toBe(false);
  });
});
