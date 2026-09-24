import { describe, expect, it } from "@jest/globals";
import {
  allPartiesReady,
  autoLaunchAt,
  canDeclareTeamReady,
  canPlayersReportScore,
  castBlockReason,
  currentLaunchState,
  isAutoLaunchDue,
  LAUNCH_AUTO_DELAY_MINUTES,
  LAUNCH_ERROR_MESSAGES,
  launchErrorMessage,
  launchModalKey,
  launchModalWaits,
  launchPairingKey,
  launchReadiness,
  matchLaunchPhase,
  nextLaunchPhaseChangeAt,
  pickLaunchContacts,
  readyCount,
  resolveHostTeamId,
  type ContactCandidate,
  type MatchLaunchInput,
} from "@/lib/shared/match-launch";

const NOW = Date.parse("2026-09-24T20:00:00.000Z");
const HOUR = 3_600_000;

function input(overrides: Partial<MatchLaunchInput> = {}): MatchLaunchInput {
  return {
    status: "READY",
    team1Id: 1,
    team2Id: 2,
    startAt: null,
    launchedAt: null,
    ...overrides,
  };
}

function member(overrides: Partial<ContactCandidate> = {}): ContactCandidate {
  return {
    userId: 1,
    pseudo: "Joueur",
    roles: ["DPS"],
    discordTag: null,
    discordVerified: false,
    battletag: null,
    blizzardLinked: false,
    ...overrides,
  };
}

describe("matchLaunchPhase", () => {
  it("n'a rien à lancer sur un match à venir, terminé ou sans ses deux engagées", () => {
    expect(matchLaunchPhase(input({ status: "PENDING" }), NOW)).toBe("NONE");
    expect(matchLaunchPhase(input({ status: "COMPLETED" }), NOW)).toBe("NONE");
    expect(matchLaunchPhase(input({ team2Id: null }), NOW)).toBe("NONE");
    expect(matchLaunchPhase(input({ team1Id: null }), NOW)).toBe("NONE");
  });

  it("attend l'heure de début d'un match programmé", () => {
    const startAt = new Date(NOW + HOUR).toISOString();
    expect(matchLaunchPhase(input({ startAt }), NOW)).toBe("SCHEDULED");
  });

  it("entre en lancement à l'heure dite, bornes comprises", () => {
    const startAt = new Date(NOW).toISOString();
    expect(matchLaunchPhase(input({ startAt }), NOW)).toBe("LOBBY");
    expect(matchLaunchPhase(input({ startAt: new Date(NOW - HOUR).toISOString() }), NOW)).toBe(
      "LOBBY",
    );
  });

  it("entre en lancement dès qu'il est jouable s'il n'a pas d'horaire", () => {
    expect(matchLaunchPhase(input(), NOW)).toBe("LOBBY");
  });

  it("est lancé dès que `launched_at` est posé, même avant l'heure", () => {
    const startAt = new Date(NOW + HOUR).toISOString();
    expect(matchLaunchPhase(input({ startAt, launchedAt: new Date(NOW).toISOString() }), NOW)).toBe(
      "LAUNCHED",
    );
  });

  it("compte pour lancé un report déjà en attente de confirmation", () => {
    // Il n'existe que parce qu'on a joué — et c'est l'état des matchs en
    // cours au déploiement.
    expect(matchLaunchPhase(input({ status: "AWAITING_CONFIRMATION" }), NOW)).toBe("LAUNCHED");
  });

  it("traite une heure illisible comme absente", () => {
    expect(matchLaunchPhase(input({ startAt: "pas une date" }), NOW)).toBe("LOBBY");
  });
});

describe("nextLaunchPhaseChangeAt", () => {
  it("donne l'heure de début d'un match programmé, seule frontière d'horloge", () => {
    const startAt = new Date(NOW + HOUR).toISOString();
    expect(nextLaunchPhaseChangeAt(input({ startAt }), NOW)).toBe(NOW + HOUR);
  });

  it("n'a aucune frontière hors de la phase programmée", () => {
    expect(nextLaunchPhaseChangeAt(input(), NOW)).toBeNull();
    expect(nextLaunchPhaseChangeAt(input({ status: "COMPLETED" }), NOW)).toBeNull();
  });
});

describe("canPlayersReportScore", () => {
  it("n'ouvre le report qu'à un match lancé", () => {
    expect(canPlayersReportScore(input(), NOW)).toBe(false);
    expect(canPlayersReportScore(input({ launchedAt: new Date(NOW).toISOString() }), NOW)).toBe(true);
    expect(canPlayersReportScore(input({ status: "AWAITING_CONFIRMATION" }), NOW)).toBe(true);
  });

  it("le refuse à un match terminé ou programmé", () => {
    expect(canPlayersReportScore(input({ status: "COMPLETED" }), NOW)).toBe(false);
    const startAt = new Date(NOW + HOUR).toISOString();
    expect(canPlayersReportScore(input({ startAt }), NOW)).toBe(false);
  });
});

describe("lancement d'office", () => {
  it("part quinze minutes après l'ouverture du lancement", () => {
    expect(LAUNCH_AUTO_DELAY_MINUTES).toBe(15);
    const opened = new Date(NOW).toISOString();
    expect(autoLaunchAt(opened)).toBe(new Date(NOW + 15 * 60_000).toISOString());
    expect(isAutoLaunchDue(opened, NOW + 15 * 60_000 - 1)).toBe(false);
    expect(isAutoLaunchDue(opened, NOW + 15 * 60_000)).toBe(true);
  });

  it("n'a pas de délai tant que le lancement n'est pas ouvert", () => {
    expect(autoLaunchAt(null)).toBeNull();
    expect(isAutoLaunchDue(null, NOW)).toBe(false);
    expect(autoLaunchAt("illisible")).toBeNull();
  });
});

describe("launchPairingKey / currentLaunchState", () => {
  const stored = {
    launchPairing: "10:20",
    lobbyOpenedAt: "a",
    launchedAt: "b",
    team1ReadyAt: "c",
    team2ReadyAt: "d",
    casterReadyAt: "e",
  };

  it("forme l'empreinte comme le `CONCAT` du SQL, et n'en a pas sans les deux engagées", () => {
    expect(launchPairingKey(10, 20)).toBe("10:20");
    expect(launchPairingKey(20, 10)).toBe("20:10");
    expect(launchPairingKey(null, 20)).toBeNull();
  });

  it("garde l'état posé pour l'appariement courant", () => {
    expect(currentLaunchState(stored, 10, 20)).toBe(stored);
  });

  it("efface ce qui a été posé pour un autre appariement — match réécrit sur place", () => {
    const cleared = currentLaunchState(stored, 10, 30);
    expect(cleared).toEqual({
      launchPairing: "10:20",
      lobbyOpenedAt: null,
      launchedAt: null,
      team1ReadyAt: null,
      team2ReadyAt: null,
      casterReadyAt: null,
    });
    // Les équipes qui échangent leurs créneaux forment aussi un autre appariement.
    expect(currentLaunchState(stored, 20, 10).launchedAt).toBeNull();
  });

  it("ne reconnaît aucun état sans empreinte, ni sans les deux engagées", () => {
    expect(currentLaunchState({ ...stored, launchPairing: null }, 10, 20).team1ReadyAt).toBeNull();
    expect(currentLaunchState(stored, 10, null).launchedAt).toBeNull();
  });
});

describe("launchReadiness / allPartiesReady / readyCount", () => {
  const base = {
    team1ReadyAt: null,
    team2ReadyAt: null,
    team1IsGhost: false,
    team2IsGhost: false,
    casterUserId: null,
    casterReadyAt: null,
  };

  it("sans caster, les deux équipes suffisent", () => {
    const readiness = launchReadiness({ ...base, team1ReadyAt: "t", team2ReadyAt: "t" });
    expect(readiness.casterRequired).toBe(false);
    expect(allPartiesReady(readiness)).toBe(true);
    expect(readyCount(readiness)).toEqual({ ready: 2, expected: 2 });
  });

  it("attend le caster quand il est inscrit", () => {
    const readiness = launchReadiness({
      ...base,
      team1ReadyAt: "t",
      team2ReadyAt: "t",
      casterUserId: 9,
    });
    expect(allPartiesReady(readiness)).toBe(false);
    expect(readyCount(readiness)).toEqual({ ready: 2, expected: 3 });
    expect(
      allPartiesReady(
        launchReadiness({ ...base, team1ReadyAt: "t", team2ReadyAt: "t", casterUserId: 9, casterReadyAt: "t" }),
      ),
    ).toBe(true);
  });

  it("compte une fantôme prête d'office — personne ne cliquerait pour elle", () => {
    const readiness = launchReadiness({ ...base, team1IsGhost: true, team2IsGhost: true });
    expect(readiness.team1Ready).toBe(true);
    expect(allPartiesReady(readiness)).toBe(true);
  });

  it("ne compte pas un « Prêt » de caster sans caster", () => {
    expect(launchReadiness({ ...base, casterReadyAt: "t" }).casterReady).toBe(false);
  });

  it("attend l'équipe qui n'a pas cliqué", () => {
    expect(allPartiesReady(launchReadiness({ ...base, team1ReadyAt: "t" }))).toBe(false);
  });
});

describe("canDeclareTeamReady", () => {
  it("donne le « Prêt » au capitaine, au manager et au propriétaire", () => {
    expect(canDeclareTeamReady(["CAPITAINE"])).toBe(true);
    expect(canDeclareTeamReady(["MANAGER"])).toBe(true);
    expect(canDeclareTeamReady(["OWNER"])).toBe(true);
    expect(canDeclareTeamReady(["DPS", "CAPITAINE"])).toBe(true);
  });

  it("le refuse aux rôles purement sportifs et à une liste absente", () => {
    expect(canDeclareTeamReady(["DPS", "TANK", "HEAL", "COACH"])).toBe(false);
    expect(canDeclareTeamReady([])).toBe(false);
    expect(canDeclareTeamReady(null)).toBe(false);
    expect(canDeclareTeamReady(undefined)).toBe(false);
  });
});

describe("resolveHostTeamId", () => {
  it("retombe sur l'équipe 1 sans désignation", () => {
    expect(resolveHostTeamId(null, 10, 20)).toBe(10);
  });

  it("garde l'équipe désignée par l'arbitrage", () => {
    expect(resolveHostTeamId(20, 10, 20)).toBe(20);
    expect(resolveHostTeamId(10, 10, 20)).toBe(10);
  });

  it("ignore une désignation qui ne vise plus une des deux engagées", () => {
    // Un appariement corrigé a pu remplacer l'équipe désignée.
    expect(resolveHostTeamId(99, 10, 20)).toBe(10);
  });

  it("n'a pas d'hôte sans équipe 1", () => {
    expect(resolveHostTeamId(null, null, 20)).toBeNull();
  });
});

describe("castBlockReason", () => {
  const verified = { discordVerified: true, blizzardLinked: true };

  it("laisse caster qui a la permission et une identité vérifiée", () => {
    expect(castBlockReason(true, verified)).toBeNull();
  });

  it("refuse sans la permission `live`, avant toute question d'identité", () => {
    expect(castBlockReason(false, verified)).toBe("NOT_CASTER");
  });

  it("exige le tag Discord certifié ET le compte Battle.net", () => {
    expect(castBlockReason(true, { discordVerified: false, blizzardLinked: true })).toBe(
      "CASTER_IDENTITY_REQUIRED",
    );
    expect(castBlockReason(true, { discordVerified: true, blizzardLinked: false })).toBe(
      "CASTER_IDENTITY_REQUIRED",
    );
    expect(castBlockReason(true, { discordVerified: false, blizzardLinked: false })).toBe(
      "CASTER_IDENTITY_REQUIRED",
    );
  });
});

describe("pickLaunchContacts", () => {
  it("ne rend rien pour un roster vide", () => {
    expect(pickLaunchContacts([])).toEqual([]);
  });

  it("suit l'ordre des rôles à vérifications égales : capitaine, manager, propriétaire, joueur", () => {
    const roster = [
      member({ userId: 4, pseudo: "Joueur", roles: ["DPS"] }),
      member({ userId: 3, pseudo: "Proprio", roles: ["OWNER"] }),
      member({ userId: 2, pseudo: "Manager", roles: ["MANAGER"] }),
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"] }),
    ];
    expect(pickLaunchContacts(roster).map((c) => c.pseudo)).toEqual(["Capitaine"]);
    expect(pickLaunchContacts(roster.slice(0, 3)).map((c) => c.pseudo)).toEqual(["Manager"]);
    expect(pickLaunchContacts(roster.slice(0, 2)).map((c) => c.pseudo)).toEqual(["Proprio"]);
    expect(pickLaunchContacts(roster.slice(0, 1)).map((c) => c.pseudo)).toEqual(["Joueur"]);
  });

  it("fait passer un joueur vérifié devant un capitaine qui ne l'est pas", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], discordTag: "cap", battletag: "Cap#1" }),
      member({
        userId: 2,
        pseudo: "Verifie",
        roles: ["DPS"],
        discordTag: "verif",
        discordVerified: true,
        battletag: "Verif#1",
        blizzardLinked: true,
      }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Verifie"]);
  });

  it("entre deux vérifiés, reprend l'ordre des rôles", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Joueur", roles: ["DPS"], discordTag: "a", discordVerified: true, battletag: "A#1", blizzardLinked: true }),
      member({ userId: 2, pseudo: "Manager", roles: ["MANAGER"], discordTag: "b", discordVerified: true }),
    ]);
    // Le manager n'a que Discord : on lui adjoint un porteur du BattleTag.
    expect(contacts.map((c) => c.pseudo)).toEqual(["Manager", "Joueur"]);
  });

  it("adjoint un second joueur quand le premier n'a que Discord de vérifié", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], discordTag: "cap", discordVerified: true, battletag: "Cap#1" }),
      member({ userId: 2, pseudo: "Tank", roles: ["TANK"], battletag: "Tank#1", blizzardLinked: true }),
      member({ userId: 3, pseudo: "Heal", roles: ["HEAL"], discordTag: "heal", discordVerified: true }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Capitaine", "Tank"]);
    expect(contacts[0]).toMatchObject({ discordTag: "cap", battletag: "Cap#1", battletagVerified: false });
    expect(contacts[1]).toMatchObject({ discordTag: null, battletag: "Tank#1", battletagVerified: true });
  });

  it("adjoint un second joueur quand le premier n'a que le BattleTag de vérifié", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], battletag: "Cap#1", blizzardLinked: true }),
      member({ userId: 2, pseudo: "Dps", roles: ["DPS"], discordTag: "dps", discordVerified: true }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Capitaine", "Dps"]);
  });

  it("préfère, pour le second, le meilleur rôle parmi les porteurs de la vérification manquante", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], discordTag: "cap", discordVerified: true }),
      member({ userId: 2, pseudo: "Dps", roles: ["DPS"], battletag: "Dps#1", blizzardLinked: true }),
      member({ userId: 3, pseudo: "Proprio", roles: ["OWNER"], battletag: "Pro#1", blizzardLinked: true }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Capitaine", "Proprio"]);
  });

  it("ne rend qu'un joueur quand le premier a les deux vérifications", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Complet", roles: ["CAPITAINE"], discordTag: "c", discordVerified: true, battletag: "C#1", blizzardLinked: true }),
      member({ userId: 2, pseudo: "Autre", roles: ["DPS"], battletag: "A#1", blizzardLinked: true }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Complet"]);
  });

  it("ne rend qu'un joueur quand personne ne porte la vérification manquante", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], discordTag: "cap", discordVerified: true }),
      member({ userId: 2, pseudo: "Dps", roles: ["DPS"], battletag: "Dps#1" }),
    ]);
    expect(contacts.map((c) => c.pseudo)).toEqual(["Capitaine"]);
  });

  it("sans aucune vérification, présente le premier par rôle, BattleTag non vérifié et jamais le Discord", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 2, pseudo: "Dps", roles: ["DPS"], discordTag: "dps", battletag: "Dps#1" }),
      member({ userId: 1, pseudo: "Capitaine", roles: ["CAPITAINE"], discordTag: "cap", battletag: "Cap#1" }),
    ]);
    expect(contacts).toEqual([
      {
        userId: 1,
        pseudo: "Capitaine",
        roles: ["CAPITAINE"],
        discordTag: null,
        battletag: "Cap#1",
        battletagVerified: false,
      },
    ]);
  });

  it("ne tient pas pour vérifié un compte Battle.net rattaché sans BattleTag", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 1, pseudo: "Vide", roles: ["CAPITAINE"], blizzardLinked: true }),
    ]);
    expect(contacts[0]).toMatchObject({ battletag: null, battletagVerified: false });
  });

  it("départage deux joueurs identiques par pseudo, de façon stable", () => {
    const contacts = pickLaunchContacts([
      member({ userId: 2, pseudo: "Beta", roles: ["DPS"] }),
      member({ userId: 1, pseudo: "Alpha", roles: ["DPS"] }),
    ]);
    expect(contacts[0].pseudo).toBe("Alpha");
  });

  it("ne modifie pas la liste reçue", () => {
    const roster = [member({ userId: 2, pseudo: "B" }), member({ userId: 1, pseudo: "A" })];
    pickLaunchContacts(roster);
    expect(roster.map((m) => m.pseudo)).toEqual(["B", "A"]);
  });
});

describe("launchModalKey", () => {
  it("distingue les phases d'un même match : fermer le lancement ne tait pas le départ", () => {
    expect(launchModalKey({ matchId: 4, phase: "LOBBY" })).not.toBe(
      launchModalKey({ matchId: 4, phase: "LAUNCHED" }),
    );
  });
});

describe("launchModalWaits", () => {
  it("attend qu'un choix de confidentialité dû soit fait", () => {
    expect(launchModalWaits({ privacyPending: true, privacyAnswered: false, onPrivacyPage: false })).toBe(true);
  });

  it("s'ouvre une fois le choix fait, ou sans choix dû", () => {
    expect(launchModalWaits({ privacyPending: true, privacyAnswered: true, onPrivacyPage: false })).toBe(false);
    expect(launchModalWaits({ privacyPending: false, privacyAnswered: false, onPrivacyPage: false })).toBe(false);
  });

  it("n'attend pas sur la page de la politique, où la modale de confidentialité se tait", () => {
    expect(launchModalWaits({ privacyPending: true, privacyAnswered: false, onPrivacyPage: true })).toBe(false);
  });
});

describe("launchErrorMessage", () => {
  it("rend un message français pour chaque refus connu", () => {
    for (const code of Object.keys(LAUNCH_ERROR_MESSAGES)) {
      expect(launchErrorMessage(code)).toBe(LAUNCH_ERROR_MESSAGES[code]);
    }
    expect(launchErrorMessage("CASTER_IDENTITY_REQUIRED")).toMatch(/Battle\.net/);
  });

  it("retombe sur un message générique pour un code inconnu ou absent", () => {
    expect(launchErrorMessage("QUELQUE_CHOSE")).toMatch(/Réessaie/);
    expect(launchErrorMessage(null)).toMatch(/Réessaie/);
  });
});
