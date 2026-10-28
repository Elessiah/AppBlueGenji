/**
 * ERREUR-FIX EF-05 : textes juridiques alignés sur le code — proposition de
 * certification du tag Discord (marque de session, parcours, « Ne plus
 * voir »), invitation à certifier de la fiche tournoi (durée en mémoire,
 * variante Marvel Rivals), langue des messages privés, droits sur le choix
 * des messages de match et portabilité dans la politique du bot.
 *
 * Chaque phrase gardée ici dit un fait du code, en français et en anglais.
 */
import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import {
  CERTIFICATION_PROMPT_FAILURE_TTL_MS,
  CERTIFICATION_PROMPT_TTL_MS,
} from "@/lib/server/tournaments/certification-prompt-cache";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { DONNEES_PROFIL } from "@/lib/shared/rgpd-policy";
import { DONNEES_PROFIL_EN } from "@/lib/shared/rgpd-policy-en";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";

const row = (entries: typeof DONNEES_PROFIL, donnee: string) => {
  const found = entries.find((entry) => entry.donnee === donnee);
  if (!found) throw new Error(`ligne absente : ${donnee}`);
  return found.finalite;
};
const activity = (list: typeof PROCESSING_ACTIVITIES, ref: string) => {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`activité absente : ${ref}`);
  return [found.purpose, ...found.subPurposes, ...found.dataCategories].join(" ");
};
const source = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");

describe("/rgpd — choix « Ne plus voir » de la certification Discord", () => {
  const fr = row(DONNEES_PROFIL, "Choix « Ne plus voir » de la certification Discord");
  const en = row(DONNEES_PROFIL_EN, "Discord verification “Don't show again” choice");

  it("dit une fois par connexion (« Plus tard » ne vaut que pour la connexion en cours)", () => {
    // LATER ne lève la marque que de la session qui répond (WHERE token_hash = ?) :
    // une autre session encore marquée, sur un autre appareil, la propose encore.
    expect(fr).toContain("une fois par connexion : « Plus tard » la ferme pour cette connexion-là");
    expect(en).toContain("once per login: “Later” closes it for that login");
    expect(fr).not.toContain("la ferme jusqu'à ta prochaine connexion");
    expect(en).not.toContain("closes it until your next login");
    // Seule une connexion par Discord ou Blizzard la rouvre (CERTIFY_PROMPT_DOORS).
    expect(fr).toContain("elle revient à ta prochaine connexion par Discord ou Blizzard");
    expect(en).toContain("it comes back at your next login with Discord or Blizzard");
  });

  it("nomme le parcours « ajouter un tag » d'un compte qui n'en a pas", () => {
    expect(fr).toContain("(ou, si tu n'en as pas, de l'ajouter puis de le certifier)");
    expect(en).toContain("(or, if you have none, that you add it and then verify it)");
  });

  it("sépare la marque de session (hors export) du choix (exporté)", () => {
    expect(fr).toContain("effacée avec la session, hors de l'export de tes données");
    expect(fr).toContain("Ce choix figure dans l'export de tes données");
    expect(en).toContain("erased with the session, and not included in the export of your data");
    expect(en).toContain("This choice is included in the export of your data");
  });

  it("dit qu'une réponse perdue ou refusée laisse la marque", () => {
    expect(fr).toContain(
      "Une réponse qui ne parvient pas au site, ou qu'il refuse (autre compte connecté depuis dans ce navigateur, compte introuvable), ne lève pas la marque : la fenêtre peut revenir au chargement suivant.",
    );
    expect(en).toContain(
      "An answer that doesn't reach the site, or that it refuses (another account logged in since in that browser, account not found), doesn't clear the mark: the window may come back at the next page load.",
    );
  });

  it("nomme l'exception par l'équipe du lecteur", () => {
    expect(fr).toContain("(jamais quand ton équipe n'a aucun contact)");
    expect(en).toContain("(never when your team has no contact at all)");
  });
});

describe("/rgpd — certification du pseudo Discord", () => {
  const fr = row(DONNEES_PROFIL, "Certification du pseudo Discord");
  const en = row(DONNEES_PROFIL_EN, "Certification of the Discord username");

  it("le code en message privé n'appartient qu'à Mon profil, la fenêtre certifie d'un clic", () => {
    expect(fr).toContain(
      "depuis Mon profil (un clic si ton Discord est rattaché, un code en message privé sinon) ou, d'un clic, depuis la fenêtre",
    );
    expect(fr).toContain("(sinon, elle te mène à Mon profil)");
    expect(en).toContain(
      "from My profile (one click if your Discord is linked, a code by direct message otherwise) or, in one click, from the window",
    );
    expect(en).toContain("(otherwise, it takes you to My profile)");
  });

  it("dit que des tournois et le cast l'exigent", () => {
    expect(fr).toContain("Les conditions d'inscription d'un tournoi peuvent l'exiger, et caster un match l'exige.");
    expect(en).toContain("A tournament's registration conditions may require it, and casting a match requires it.");
  });
});

describe("registre — T01 (marque de session, langue) et T04 (invitation, code)", () => {
  it("T01 : marque posée à chaque connexion d'un compte non certifié, levée à la première réponse", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T01");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T01");
    expect(fr).toContain("à chaque connexion par Discord ou Blizzard");
    expect(fr).toContain("levée à la première réponse");
    expect(en).toContain("at each login with Discord or Blizzard");
    expect(en).toContain("cleared at the first answer");
  });

  it("T01 : les alertes au staff partent toujours dans les deux langues", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T01")).toContain("alertes adressées au staff");
    expect(activity(PROCESSING_ACTIVITIES, "T01")).toContain("Proposer, une fois par connexion par Discord ou Blizzard,");
    expect(activity(PROCESSING_ACTIVITIES, "T01")).not.toContain("Proposer une fois");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T01")).toContain("Suggesting, once per login with Discord or Blizzard,");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T01")).toContain("alerts sent to staff");
  });

  it("T04 : une minute après la lecture, dix secondes après une erreur — les durées du cache", () => {
    expect([CERTIFICATION_PROMPT_TTL_MS, CERTIFICATION_PROMPT_FAILURE_TTL_MS]).toEqual([60_000, 10_000]);
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain(
      "au plus une minute après la fin de sa lecture (dix secondes après une erreur de lecture)",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04")).toContain("ten seconds after a read error");
  });

  it("T04 : variante Marvel Rivals du fait dit aux membres", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain(
      "personne n'y a certifié son tag Discord ni son BattleTag — en Marvel Rivals, son tag Discord",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04")).toContain("in Marvel Rivals, their Discord tag");
  });

  it("T04 : renvoie à la langue du compte lue pour le code (T01)", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain(
      "Langue du compte déjà rattaché au compte Discord visé (T01)",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04")).toContain(
      "Language of the account already linked to the targeted Discord account (T01)",
    );
  });

  it("T04 : jamais quand l'équipe n'a aucun contact", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain("(jamais quand son équipe n'a aucun contact à présenter)");
  });
});

describe("PRIVACY_CHANGES — entrée rectificative de la marque de session", () => {
  const id = "2026-10-proposition-certification-discord-marque-de-session";
  const entry = PRIVACY_CHANGES.find((change) => change.id === id);
  const english = PRIVACY_CHANGES_EN[id];

  it("dit la marque posée à la connexion et levée à la première réponse, hors export", () => {
    const fr = [entry?.summary, ...(entry?.details ?? [])].join(" ");
    const en = [english?.summary, ...(english?.details ?? [])].join(" ");
    expect(fr).toContain("la marque est posée à la connexion et levée à ta première réponse");
    expect(fr).toContain("ne figure pas dans l'export de tes données");
    // Fermer la fenêtre (Échap, voile), son bouton vers la certification de « Mon profil »
    // (`DIALOG`) et le refus d'un clic dont le tag n'est plus le bon (`STATE_CHANGED`) répondent tous « Plus tard ».
    expect(fr).toContain("(« Plus tard », la fermeture de la fenêtre ou son bouton vers « Mon profil », « Ne plus voir »");
    expect(fr).toContain("ou la certification, réussie ou refusée parce que ton tag Discord ne peut plus être certifié depuis cette fenêtre)");
    expect(en).toContain("(“Later”, closing the window or its button to “My profile”, “Don't show again”");
    expect(en).toContain("or verification, whether it succeeds or is refused because your Discord tag can no longer be verified from this window)");
    expect(en).toContain("the mark is set at login and cleared at your first answer");
    expect(en).toContain("isn't included in the export of your data");
  });

  it("dit qu'une réponse perdue ou refusée (autre compte, compte introuvable) laisse la marque (FR et EN)", () => {
    // `closeOnDeadEnd` ferme sans écrire ; un LATER en keepalive perdu est avalé.
    expect(entry?.details[0]).toContain(
      "Une réponse qui ne parvient pas au site, ou qu'il refuse parce qu'un autre compte s'est connecté depuis dans ce navigateur ou que ton compte est introuvable, ne la lève pas : la fenêtre peut revenir au chargement suivant.",
    );
    expect(english?.details[0]).toContain(
      "An answer that doesn't reach the site, or that it refuses because another account has logged in since in that browser or your account can't be found, doesn't clear it: the window may come back at the next page load.",
    );
  });

  it("le code qu'elle décrit : le passage à « Mon profil » et un tag qui a changé répondent « Plus tard »", () => {
    const prompt = source("components/discord/DiscordCertifyPrompt.tsx");
    expect(prompt).toMatch(/if \(prompt\.mode === "DIALOG"\) \{\s*(?:\/\/[^\n]*\n\s*)*closeForSession\(\);/);
    expect(prompt).toMatch(/if \(STATE_CHANGED\.has\(code\)\) \{\s*(?:\/\/[^\n]*\n\s*)*closeForSession\(\);/);
    expect(prompt).toMatch(/const postpone = \(\) => \{\s*if \(inFlight\.current\) return;\s*closeForSession\(\);/);
  });

  it("laisse intacte l'entrée publiée du 21 octobre", () => {
    const publishedId = "2026-10-proposition-certification-discord";
    const published = PRIVACY_CHANGES.find((change) => change.id === publishedId);
    expect(published?.publishedAt).toBe("2026-10-21");
    // Empreinte du texte publié (FR et EN, liens compris) : toute retouche la change.
    const fingerprint = createHash("sha256").update(JSON.stringify([published, PRIVACY_CHANGES_EN[publishedId]])).digest("hex");
    expect(fingerprint).toBe("19953e98609ad2083d8788fffa38424109b607c47fa400cd9b850dd56f87ea69");
  });
});

describe("avis de la connexion et du profil", () => {
  it("le tag se certifie aussi dans la fenêtre proposée après la connexion", () => {
    expect(frLogin.consent.discordTag).toContain("dans ton profil ou dans la fenêtre qui te le propose après la connexion");
    expect(enLogin.consent.discordTag).toContain("in your profile or in the window that offers it after you log in");
  });

  it("le code de connexion part dans la langue du compte déjà rattaché à ce Discord", () => {
    expect(source("lib/server/discord-verification.ts")).toContain("accountLocaleForDiscordId(");
    expect(frLogin.consent.pseudonyms).toContain(
      "dans la langue du compte déjà rattaché à ce Discord — en français puis en anglais s'il n'y en a pas",
    );
    expect(enLogin.consent.pseudonyms).toContain(
      "in the language of the account already linked to that Discord — French then English if there is none",
    );
  });

  it("la langue du compte ne vaut pas pour les alertes adressées au staff", () => {
    // bilingualDm : le français seul quand les deux langues dépassent un message.
    expect(frProfile.accountLocale.hint).toContain(
      "(hors alertes adressées au staff en message privé, en français puis en anglais — en français seul si les deux ne tiennent pas dans un message)",
    );
    expect(enProfile.accountLocale.hint).toContain(
      "(except alerts sent to staff by direct message, in French then English — French alone if both do not fit in one message)",
    );
    expect(frProfile.accountLocale.hint).not.toContain("toujours en français");
  });
});

describe("politique du bot — droits", () => {
  const text = (lang: "fr" | "en") => JSON.stringify(PRIVACY_POLICY[lang]);

  it("le choix des messages de match, gardé au titre d'une obligation légale, échappe à l'opposition", () => {
    expect(text("fr")).toContain(
      "La conservation par le site de votre choix des messages privés de match n'en relève pas non plus : elle repose sur une obligation légale",
    );
    expect(text("en")).toContain("Nor is the site's keeping of your match direct messages choice: it rests on a legal obligation");
  });

  it("la portabilité n'est écartée que pour les traitements propres au bot", () => {
    expect(text("fr")).toContain("Le droit à la portabilité ne s'applique pas aux traitements propres au Bot");
    expect(text("fr")).toContain("[politique de confidentialité du site](");
    expect(text("fr")).not.toContain("ne s'applique pas : ces traitements");
    expect(text("en")).toContain("The right to data portability does not apply to the Bot's own processing");
    expect(text("en")).toContain("[website's privacy policy](");
  });
});

describe("/rgpd — droits sur le choix des messages de match, stockage de l'invitation", () => {
  it("la conservation du choix ne relève pas du droit d'opposition (FR et EN)", () => {
    expect(source("app/rgpd/page.tsx")).toContain("cette conservation ne relève donc pas du droit d&apos;opposition");
    expect(source("app/rgpd/RgpdEn.tsx")).toContain("this keeping is therefore not subject to the right to object");
  });

  it("l'invitation de la fiche tournoi ne parle du BattleTag que selon le jeu et le compte", () => {
    // Overwatch, Battle.net rattaché sans BattleTag (`battletagUnfixable`) : la fenêtre ne parle que de Discord.
    expect(source("app/rgpd/page.tsx")).toContain("à certifier votre tag Discord (et votre BattleTag, selon le jeu et le compte)</strong>");
    expect(source("app/rgpd/RgpdEn.tsx")).toContain("verify your Discord tag (and your BattleTag, depending on the game and the account)</strong>");
  });
});

describe("/rgpd — clés React des bases supplémentaires (portée, jamais la base)", () => {
  it("les deux pages indexent une base supplémentaire par sa portée", () => {
    for (const path of ["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"]) {
      expect([path, source(path).includes("key={extra.scope}")]).toEqual([path, true]);
      expect([path, source(path).includes("key={extra.base}")]).toEqual([path, false]);
    }
  });

  it("dans chaque ligne, FR comme EN, les portées sont uniques — même quand une base revient", () => {
    let repeatedBase = false;
    for (const entries of [DONNEES_PROFIL, DONNEES_PROFIL_EN]) {
      for (const entry of entries) {
        const extras = entry.extraBases ?? [];
        const scopes = extras.map((extra) => extra.scope);
        expect([entry.donnee, new Set(scopes).size]).toEqual([entry.donnee, scopes.length]);
        if (new Set(extras.map((extra) => extra.base)).size < extras.length) repeatedBase = true;
      }
    }
    // Le cas qui faisait doubler `key={extra.base}` existe bien.
    expect(repeatedBase).toBe(true);
  });
});

describe("PRIVACY_CHANGES — « Ne plus voir » de l'invitation, entrée encore à publier", () => {
  it("ne parle du BattleTag que selon le jeu et le compte (en Marvel Rivals, ou sans BattleTag rattachable, seul le tag Discord compte)", () => {
    const id = "2026-10-ne-plus-voir-invitation-certification-sur-le-compte";
    const entry = PRIVACY_CHANGES.find((change) => change.id === id);
    expect(entry?.publishedAt).toBe("2026-10-29");
    expect(entry?.summary).toContain("à certifier ton tag Discord (et ton BattleTag, selon le jeu et le compte)");
    expect(PRIVACY_CHANGES_EN[id]?.summary).toContain("to verify your Discord tag (and your BattleTag, depending on the game and the account)");
  });
});

describe("registre — cartes choisies dans le pool de la manche (T04, T05)", () => {
  const retention = (list: typeof PROCESSING_ACTIVITIES, ref: string) => list.find((entry) => entry.ref === ref)?.retention.join(" ");

  it("registerT04_dataCategories_namesPoolPicksByStaffOrTeam", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain(
      "cartes choisies dans le pool de la manche (par le staff ou, en autogestion, par une équipe du match)",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04")).toContain(
      "maps picked from the round pool (by the staff or, in self-management, by a team of the match)",
    );
  });

  it("registerT04_retention_keepsPoolPicksWithMatch", () => {
    expect(retention(PROCESSING_ACTIVITIES, "T04")).toContain("première carte et cartes choisies dans le pool : conservés avec le match");
    expect(retention(PROCESSING_ACTIVITIES_EN, "T04")).toContain("first map and maps picked from the pool: kept with the match");
  });

  it("registerT05_staffLog_namesPoolPickAndClear", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05")).toContain(
      "carte choisie dans le pool de la manche ou choix retiré — sans nommer l'arbitre ni le staff",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05")).toContain(
      "map picked from the round pool or pick cleared — without naming the referee or the staff",
    );
  });
});

describe("/rgpd — opposition retenue d'un arbitre (décision 42b, REFEREE-OBJECTION)", () => {
  it("rgpdArbitreDesigne_upheldObjection_saysRemovedFromUnfinishedMatchesFrAndEn", () => {
    const fr = source("app/rgpd/page.tsx").replace(/\s+/g, " ");
    const en = source("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");
    expect(fr).toContain("son opposition le retire de tous ses matchs non terminés (le staff en désigne un autre ; ses matchs joués gardent leur arbitre)");
    expect(fr).toContain("le staff pouvant lui confier de nouveau ce match (sauf opposition retenue)");
    expect(fr).not.toContain("ceux qu'il tient déjà lui restent");
    expect(en).toContain("their objection removes them from all their unfinished matches (the staff assigns another referee; their played matches keep their referee)");
    expect(en).toContain("assign that match to them again (unless an objection is upheld)");
    expect(en).not.toContain("those they already hold stay theirs");
  });
});
