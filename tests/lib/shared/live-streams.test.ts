import { describe, expect, it } from "@jest/globals";
import {
  canConfigureLive,
  canToggleOnAir,
  isMatchCastable,
  isMatchLive,
  isMatchLiveTrigger,
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MATCH_LIVE_STATE_LABELS,
  MATCH_LIVE_TRIGGER_LABELS,
  MAX_STREAM_URL_LENGTH,
  normalizeStreamUrl,
  PLATFORM_LABELS,
  resolveMatchLiveState,
  streamPlatform,
  type MatchLiveInput,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import type { MatchStatus } from "@/lib/shared/types";

const STATUSES: MatchStatus[] = ["PENDING", "READY", "AWAITING_CONFIRMATION", "COMPLETED"];

function match(overrides: Partial<MatchLiveInput> = {}): MatchLiveInput {
  return {
    status: "READY",
    liveTrigger: null,
    liveStartedAt: null,
    ...overrides,
  };
}

describe("normalizeStreamUrl", () => {
  it("accepte chaque plateforme de la liste blanche", () => {
    expect(normalizeStreamUrl("https://twitch.tv/bluegenji")).toBe("https://twitch.tv/bluegenji");
    expect(normalizeStreamUrl("https://www.youtube.com/@bluegenji")).toBe(
      "https://www.youtube.com/@bluegenji",
    );
    expect(normalizeStreamUrl("https://youtu.be/abc123")).toBe("https://youtu.be/abc123");
    expect(normalizeStreamUrl("https://kick.com/bluegenji")).toBe("https://kick.com/bluegenji");
  });

  it("tolère les préfixes www. et m.", () => {
    expect(normalizeStreamUrl("https://www.twitch.tv/x")).toBe("https://www.twitch.tv/x");
    expect(normalizeStreamUrl("https://m.twitch.tv/x")).toBe("https://m.twitch.tv/x");
  });

  it("ajoute le schéma manquant — le staff colle l'adresse sans https://", () => {
    expect(normalizeStreamUrl("twitch.tv/bluegenji")).toBe("https://twitch.tv/bluegenji");
    expect(normalizeStreamUrl("  kick.com/bluegenji  ")).toBe("https://kick.com/bluegenji");
  });

  it("remonte http en https", () => {
    expect(normalizeStreamUrl("http://twitch.tv/bluegenji")).toBe("https://twitch.tv/bluegenji");
  });

  it("met l'hôte en minuscules mais préserve la casse du chemin", () => {
    expect(normalizeStreamUrl("https://TWITCH.TV/BlueGenji")).toBe(
      "https://twitch.tv/BlueGenji",
    );
  });

  it("préserve la query — YouTube en a besoin pour identifier le direct", () => {
    expect(normalizeStreamUrl("https://www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
  });

  it("refuse un hôte hors liste blanche", () => {
    expect(normalizeStreamUrl("https://exemple.com/live")).toBeNull();
    expect(normalizeStreamUrl("https://dailymotion.com/live")).toBeNull();
  });

  it("refuse un domaine qui imite une plateforme", () => {
    // Le piège classique : le domaine réel est exemple.com.
    expect(normalizeStreamUrl("https://twitch.tv.exemple.com/live")).toBeNull();
    expect(normalizeStreamUrl("https://faux-twitch.tv/live")).toBeNull();
    expect(normalizeStreamUrl("https://exemple.com/twitch.tv")).toBeNull();
  });

  it("refuse un sous-domaine non listé", () => {
    expect(normalizeStreamUrl("https://evil.twitch.tv/live")).toBeNull();
  });

  it("refuse un schéma dangereux", () => {
    expect(normalizeStreamUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeStreamUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(normalizeStreamUrl("ftp://twitch.tv/x")).toBeNull();
  });

  it("refuse des identifiants dans l'URL — l'hôte affiché serait trompeur", () => {
    expect(normalizeStreamUrl("https://user:pass@twitch.tv/x")).toBeNull();
    expect(normalizeStreamUrl("https://user@twitch.tv/x")).toBeNull();
  });

  it("refuse un port explicite", () => {
    expect(normalizeStreamUrl("https://twitch.tv:8080/x")).toBeNull();
  });

  it("refuse une URL trop longue pour la colonne", () => {
    const long = `https://twitch.tv/${"a".repeat(MAX_STREAM_URL_LENGTH)}`;
    expect(long.length).toBeGreaterThan(MAX_STREAM_URL_LENGTH);
    expect(normalizeStreamUrl(long)).toBeNull();
  });

  it("refuse une entrée démesurée sans tenter de la parser", () => {
    expect(normalizeStreamUrl(`https://twitch.tv/${"a".repeat(100_000)}`)).toBeNull();
  });

  it("refuse le vide et les types non chaîne", () => {
    expect(normalizeStreamUrl("")).toBeNull();
    expect(normalizeStreamUrl("   ")).toBeNull();
    expect(normalizeStreamUrl(null)).toBeNull();
    expect(normalizeStreamUrl(undefined)).toBeNull();
    expect(normalizeStreamUrl(42)).toBeNull();
    expect(normalizeStreamUrl({ url: "https://twitch.tv/x" })).toBeNull();
  });

  it("est idempotente", () => {
    const once = normalizeStreamUrl("twitch.tv/bluegenji")!;
    expect(normalizeStreamUrl(once)).toBe(once);
  });
});

describe("isValidStreamUrl", () => {
  it("suit normalizeStreamUrl", () => {
    expect(isValidStreamUrl("https://twitch.tv/x")).toBe(true);
    expect(isValidStreamUrl("https://exemple.com/x")).toBe(false);
  });
});

describe("streamPlatform", () => {
  it("identifie la plateforme d'un lien normalisé", () => {
    expect(streamPlatform("https://www.twitch.tv/x")).toBe("twitch.tv");
    expect(streamPlatform("https://youtu.be/x")).toBe("youtu.be");
    expect(streamPlatform("https://kick.com/x")).toBe("kick.com");
  });

  it("renvoie null sur une entrée vide ou illisible", () => {
    expect(streamPlatform(null)).toBeNull();
    expect(streamPlatform(undefined)).toBeNull();
    expect(streamPlatform("")).toBeNull();
    expect(streamPlatform("pas une url")).toBeNull();
  });

  it("a un libellé pour chaque plateforme acceptée", () => {
    for (const platform of LIVE_PLATFORMS) {
      expect(PLATFORM_LABELS[platform]).toBeTruthy();
    }
  });
});

describe("isMatchLiveTrigger", () => {
  it("n'accepte que AUTO et MANUAL", () => {
    expect(isMatchLiveTrigger("AUTO")).toBe(true);
    expect(isMatchLiveTrigger("MANUAL")).toBe(true);
    expect(isMatchLiveTrigger("auto")).toBe(false);
    expect(isMatchLiveTrigger(null)).toBe(false);
    expect(isMatchLiveTrigger(undefined)).toBe(false);
    expect(isMatchLiveTrigger(1)).toBe(false);
  });
});

describe("resolveMatchLiveState", () => {
  it("est OFF pour un match non casté, quel que soit son statut", () => {
    for (const status of STATUSES) {
      expect(resolveMatchLiveState(match({ status, liveTrigger: null }))).toBe("OFF");
    }
  });

  it("ignore une antenne fantôme sur un match non casté", () => {
    expect(
      resolveMatchLiveState(match({ liveTrigger: null, liveStartedAt: new Date() })),
    ).toBe("OFF");
  });

  it("est SCHEDULED tant que le match n'est pas jouable", () => {
    expect(resolveMatchLiveState(match({ status: "PENDING", liveTrigger: "AUTO" }))).toBe(
      "SCHEDULED",
    );
    expect(resolveMatchLiveState(match({ status: "PENDING", liveTrigger: "MANUAL" }))).toBe(
      "SCHEDULED",
    );
  });

  it("passe AUTO à l'antenne dès que le match est jouable", () => {
    expect(resolveMatchLiveState(match({ status: "READY", liveTrigger: "AUTO" }))).toBe("LIVE");
  });

  it("n'ouvre MANUAL que si l'antenne a été ouverte", () => {
    expect(resolveMatchLiveState(match({ liveTrigger: "MANUAL" }))).toBe("SCHEDULED");
    expect(
      resolveMatchLiveState(match({ liveTrigger: "MANUAL", liveStartedAt: "2026-08-28T10:00:00Z" })),
    ).toBe("LIVE");
    expect(
      resolveMatchLiveState(match({ liveTrigger: "MANUAL", liveStartedAt: new Date() })),
    ).toBe("LIVE");
  });

  it("éteint le direct dès qu'un score est saisi, dans les deux modes", () => {
    const triggers: MatchLiveTrigger[] = ["AUTO", "MANUAL"];
    for (const liveTrigger of triggers) {
      for (const status of ["AWAITING_CONFIRMATION", "COMPLETED"] as MatchStatus[]) {
        expect(
          resolveMatchLiveState(match({ status, liveTrigger, liveStartedAt: new Date() })),
        ).toBe("OFF");
      }
    }
  });

  it("rallume le direct si une correction ramène le match à READY", () => {
    const onAir = { liveTrigger: "MANUAL" as const, liveStartedAt: new Date() };
    expect(resolveMatchLiveState(match({ ...onAir, status: "COMPLETED" }))).toBe("OFF");
    // Aucune écriture entre les deux : seul le statut a changé.
    expect(resolveMatchLiveState(match({ ...onAir, status: "READY" }))).toBe("LIVE");
  });

  it("a un libellé pour chaque état visible", () => {
    expect(MATCH_LIVE_STATE_LABELS.SCHEDULED).toBeTruthy();
    expect(MATCH_LIVE_STATE_LABELS.LIVE).toBeTruthy();
    expect(MATCH_LIVE_TRIGGER_LABELS.AUTO).toBeTruthy();
    expect(MATCH_LIVE_TRIGGER_LABELS.MANUAL).toBeTruthy();
  });
});

describe("isMatchLive", () => {
  it("ne retient que l'état LIVE", () => {
    expect(isMatchLive(match({ liveTrigger: "AUTO" }))).toBe(true);
    expect(isMatchLive(match({ liveTrigger: "MANUAL" }))).toBe(false);
    expect(isMatchLive(match())).toBe(false);
  });
});

describe("isMatchCastable", () => {
  it("accepte un match dont le score n'est pas saisi", () => {
    expect(isMatchCastable(match({ status: "READY" }))).toBe(true);
    expect(isMatchCastable(match({ status: "PENDING" }))).toBe(true);
  });

  it("accepte un match pas encore apparié — annoncer la finale à l'avance", () => {
    // C'est l'objet même de l'état SCHEDULED : on caste un créneau du tableau
    // avant de savoir qui le jouera.
    expect(isMatchCastable(match({ status: "PENDING" }))).toBe(true);
  });

  it("refuse un match dont le score est déjà saisi", () => {
    expect(isMatchCastable(match({ status: "COMPLETED" }))).toBe(false);
    expect(isMatchCastable(match({ status: "AWAITING_CONFIRMATION" }))).toBe(false);
  });

  it("refuse un bye — le moteur le pose directement en COMPLETED", () => {
    expect(isMatchCastable(match({ status: "COMPLETED" }))).toBe(false);
  });
});

describe("canConfigureLive", () => {
  it("suit isMatchCastable sur un match non marqué", () => {
    expect(canConfigureLive(match())).toBe(true);
    expect(canConfigureLive(match({ status: "PENDING" }))).toBe(true);
    expect(canConfigureLive(match({ status: "COMPLETED" }))).toBe(false);
  });

  it("reste ouvert sur un match marqué devenu non castable", () => {
    // Sans cette porte de sortie, une diffusion posée par erreur deviendrait
    // ineffaçable une fois le score saisi.
    expect(canConfigureLive(match({ status: "COMPLETED", liveTrigger: "MANUAL" }))).toBe(true);
    expect(canConfigureLive(match({ status: "COMPLETED", liveTrigger: "AUTO" }))).toBe(true);
  });
});

describe("canToggleOnAir", () => {
  it("n'expose un bouton qu'en MANUAL sur un match jouable", () => {
    expect(canToggleOnAir(match({ liveTrigger: "MANUAL", status: "READY" }))).toBe(true);
  });

  it("n'expose rien en AUTO — l'état ne dépend que du statut", () => {
    expect(canToggleOnAir(match({ liveTrigger: "AUTO", status: "READY" }))).toBe(false);
  });

  it("n'expose rien sur un match non casté ou déjà noté", () => {
    expect(canToggleOnAir(match({ liveTrigger: null, status: "READY" }))).toBe(false);
    expect(canToggleOnAir(match({ liveTrigger: "MANUAL", status: "PENDING" }))).toBe(false);
    expect(canToggleOnAir(match({ liveTrigger: "MANUAL", status: "COMPLETED" }))).toBe(false);
    expect(canToggleOnAir(match({ liveTrigger: "MANUAL", status: "AWAITING_CONFIRMATION" }))).toBe(
      false,
    );
  });
});
