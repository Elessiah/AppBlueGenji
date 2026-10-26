import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  DONNEES_PROFIL,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
  AUTOMOD_ALERT_SCOPE,
  BATTLETAG_MATCH_SCOPE,
  MATCH_CONTACTS_SCOPE,
  LIVE_PSEUDO_SCOPE,
  MATCH_TIME_DM_SCOPE,
  MODERATION_DM_SCOPE,
  DATA_NOTICE_DM_SCOPE,
} from "@/lib/shared/rgpd-policy";
import { DONNEES_PROFIL_EN, DROITS_EN } from "@/lib/shared/rgpd-policy-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";

describe("clés de rendu de /rgpd", () => {
  // La page s'en sert comme `key` React : un doublon ferait confondre deux lignes.
  it("chaque donnée du profil est nommée une seule fois", () => {
    const names = DONNEES_PROFIL.map((d) => d.donnee);
    expect(new Set(names).size).toBe(names.length);
  });

  it("chaque droit porte un titre distinct", () => {
    const titles = DROITS.map((d) => d.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("contacts du lancement d'un match — base légale", () => {
  it("affiche l'exécution du contrat à côté du consentement, sans que la finalité les oppose", () => {
    for (const [donnee, scope] of [
      ["Certification du pseudo Discord", MATCH_CONTACTS_SCOPE],
      ["Pseudo Overwatch", BATTLETAG_MATCH_SCOPE],
    ] as const) {
      const entry = DONNEES_PROFIL.find((d) => d.donnee === donnee);
      expect(entry?.base).toBe("Consentement");
      expect(entry?.extraBases?.[0]).toEqual({ base: "Exécution du contrat", scope });
      expect(entry?.finalite).not.toMatch(/non sur ce consentement/);
    }
    expect(MATCH_CONTACTS_SCOPE).toBe(
      "présentation, dans la fenêtre « Contacts » du match et dans sa fenêtre de lancement, aux membres de ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, et à son caster le temps du match (la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes et au caster) ; les contacts du caster aux deux équipes le temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin (conditions d'utilisation, « Contacts de match »)",
    );
  });

  // Décision du 2026-10-19 : masqué, le BattleTag reste lu par les parties de
  // tes matchs au titre du service, pas du consentement (le réglage n'y peut rien).
  it("fonde la lecture du BattleTag masqué par les parties d'un match sur le contrat, pas le consentement", () => {
    expect(BATTLETAG_MATCH_SCOPE).toMatch(/^lecture, même masqué, dans la seule fenêtre « Contacts » d'un match où tu es présenté comme contact/);
    expect(BATTLETAG_MATCH_SCOPE).toMatch(/arbitres et administrateurs n'y ont pas d'autre accès \(conditions d'utilisation, « Contacts de match »\)$/);
  });
});

describe("DONNEES_PROFIL", () => {
  it("covers all profile data types", () => {
    const names = DONNEES_PROFIL.map((d) => d.donnee);
    expect(names).toContain("Pseudo site");
    expect(names).toContain("Pseudo Overwatch");
    expect(names).toContain("Pseudo Discord");
    expect(names).toContain("ID Discord");
    expect(names).toContain("Pseudo Marvel Rivals");
    expect(names).toContain("Avatar");
    expect(names).toContain("Certification du pseudo Discord");
    // Les trois portes d'entrée du compte. Ce sont des **moyens de connexion**
    // avant d'être des identifiants techniques : le déclarer est la condition
    // pour que « on ne peut pas retirer le dernier » ait un sens pour le
    // lecteur.
    expect(names).toContain("Identifiant Google");
    expect(names).toContain("Identifiant Blizzard");
  });

  it("has exactly 14 entries", () => {
    expect(DONNEES_PROFIL).toHaveLength(14);
  });

  it("déclare la langue du compte (lot 9-3) : exécution du contrat, durée du compte, remise au français", () => {
    const locale = DONNEES_PROFIL.find((d) => d.donnee === "Langue du compte");
    expect(locale?.base).toBe("Exécution du contrat");
    expect(locale?.duree).toBe("Durée du compte");
    expect(locale?.extraBases).toBeUndefined();
    expect(locale?.finalite).toMatch(/notifications push/);
    expect(locale?.finalite).toMatch(/Mon profil/);
    expect(locale?.finalite).toMatch(/sauf les exceptions détaillées à la section Notifications push/);
    expect(locale?.finalite).toMatch(/français par défaut, remis au français si le compte est anonymisé/);
  });

  it("déclare le « Ne plus afficher » du recrutement gardé sur le compte : base, durée, export, anonymisation, report (FR et EN)", () => {
    const index = DONNEES_PROFIL.findIndex((d) => d.donnee === "Choix « Ne plus afficher » du recrutement");
    expect(index).toBeGreaterThanOrEqual(0);
    const row = DONNEES_PROFIL[index];
    expect(row.base).toBe("Exécution du contrat");
    expect(row.duree).toBe("Durée du compte");
    expect(row.finalite).toMatch(/reporté à la connexion ou à ta prochaine visite connectée/);
    expect(row.finalite).toMatch(/Figure dans l'export de tes données, remis au défaut si le compte est anonymisé/);
    const en = DONNEES_PROFIL_EN[index];
    expect(en.donnee).toBe("Recruitment “Don't show again” choice");
    expect(en.base).toBe(row.base);
    expect(en.finalite).toMatch(/carried over to the account at login or on your next visit while logged in/);
    expect(en.finalite).toMatch(/Included in the export of your data, reset to the default if the account is anonymized/);
    expect(row.finalite).toMatch(/Réversible dans Mon profil : le compte note alors que la fenêtre a été réaffichée/);
    expect(en.finalite).toMatch(/Can be undone in My profile: the account then records that the window was turned back on/);
    expect(row.finalite).toMatch(/avant la connexion, ou pas enregistré sur-le-champ, y est reporté/);
    expect(en.finalite).toMatch(/before logging in, or not saved right away, is carried over/);
  });

  it("déclare la majorité, facultative et affichée seulement sur choix du joueur", () => {
    const majority = DONNEES_PROFIL.find((d) => d.donnee === "Majorité déclarée");
    expect(majority?.base).toBe("Consentement");
    expect(majority?.finalite).toContain("« Majorité »");
  });

  it("déclare chaque identité OAuth comme un moyen de connexion retirable", () => {
    for (const donnee of ["ID Discord", "Identifiant Google", "Identifiant Blizzard"]) {
      const entry = DONNEES_PROFIL.find((d) => d.donnee === donnee);
      expect(entry?.finalite).toMatch(/moyen de connexion/i);
      expect(entry?.finalite).toMatch(/retirable/i);
    }
  });

  it("ne déclare **aucune** adresse e-mail, qui n'est plus collectée", () => {
    // Le scope `email` a disparu de la demande faite à Google et plus rien ne
    // rattache un compte par son adresse : déclarer une collecte qui n'a plus
    // lieu serait aussi faux que taire celle qui a lieu.
    const google = DONNEES_PROFIL.find((d) => d.donnee === "Identifiant Google");
    expect(google?.finalite).toMatch(/aucune adresse e-mail n’est demandée|aucune adresse e-mail n'est demandée/i);
    expect(DONNEES_PROFIL.map((d) => d.donnee)).not.toContain("Adresse e-mail");
  });

  it("dit que Blizzard renseigne le BattleTag, qu'il écrase à chaque connexion", () => {
    // Sans cette phrase, un joueur qui voit sa saisie changer ne peut pas savoir
    // pourquoi.
    const overwatch = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch");
    expect(overwatch?.finalite).toMatch(/Blizzard/);
    expect(overwatch?.finalite).toMatch(/chaque connexion/i);
  });

  it("dit qui lit encore un BattleTag masqué, et jusqu'à quand", () => {
    const overwatch = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch");
    // Décision du 2026-10-19 : la seule fenêtre « Contacts » d'un match, staff compris.
    expect(overwatch?.finalite).toMatch(/Masqué, il n'est lisible de personne — arbitres et administrateurs compris — sauf dans la fenêtre « Contacts » d'un match où tu fais partie des contacts présentés/);
    expect(overwatch?.finalite).toMatch(/de son caster le temps du match seulement \(de son départ à sa fin\)/);
    expect(overwatch?.finalite).not.toMatch(/de l'arbitrage tant que tu es inscrit/);
  });

  it("dit que le tag Discord enregistré à la connexion n'est pas certifié, donc privé", () => {
    const tag = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Discord");
    expect(tag?.finalite).toMatch(/Enregistré à ta connexion par Discord, ou saisi par toi/);
    expect(tag?.finalite).toMatch(/sans certification, invisible de tous, administrateurs compris/);
    // DM-CERTIFIED-ONLY (revue légale) : le bot ne reçoit le tag que certifié, pour toute notification.
    expect(tag?.finalite).toMatch(/codes du bot en message privé \(connexion, rattachement, certification\), notifications bot \(tag certifié seulement\)/);
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Discord username")?.finalite).toMatch(/bot codes by direct message \(login, linking, certification\), bot notifications \(certified tag only\)/);
    // La certification filtre les messages de match : la base de ceux-ci (intérêt légitime) y figure.
    expect(DONNEES_PROFIL.find((d) => d.donnee === "Certification du pseudo Discord")?.extraBases).toContainEqual({ base: "Intérêt légitime", scope: MATCH_TIME_DM_SCOPE });
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Certification of the Discord username")?.extraBases).toContainEqual({ base: "Intérêt légitime", scope: "match time notices, reminders and match removal notices by direct message" });
    // L'ID sert aussi, certifié ou non, aux avis passant par la portée « proven ».
    const id = DONNEES_PROFIL.find((d) => d.donnee === "ID Discord");
    expect(id?.finalite).toMatch(/horaires, rappels et retrait de match — seulement si ton tag est certifié —, demande d'adhésion à une équipe que tu gères, avis de suspension ou de modération, information sur tes données/);
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Discord ID")?.finalite).toMatch(/match times, reminders and removal — only if your tag is certified —, request to join a team you manage, suspension or moderation notices, information about your data/);
  });

  it("déclare, sur la certification, chaque public qu'elle ouvre — et celui qu'on choisit", () => {
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/administrateurs à tout moment/i);
    expect(certification?.finalite).toMatch(/arbitres tant que tu es inscrit à un tournoi qui n'est pas terminé/i);
    expect(certification?.finalite).not.toMatch(/tournoi en cours/i);
    expect(certification?.finalite).toMatch(/son caster le temps du match seulement/i);
    expect(certification?.finalite).toMatch(/autres joueurs connectés/i);
    expect(certification?.finalite).toContain("« Tag Discord »");
  });

  it("déclare que la certification se retire, et qu'elle se perd au changement de pseudo", () => {
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/retirant ton tag/i);
    expect(certification?.finalite).toMatch(/pseudo change/i);
  });

  it("dit que la certification est un geste du joueur, que la connexion ne donne pas", () => {
    // La base « Consentement » ne tient que si le geste est distinct : se
    // connecter est un acte d'authentification, pas un consentement.
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/profil/i);
    expect(certification?.finalite).toMatch(/se connecter par Discord ne la donne pas/i);
    expect(certification?.finalite).not.toMatch(/automatiquement/i);
    expect(certification?.base).toBe("Consentement");
  });

  it("discloses that the Discord user ID is stored for Discord login", () => {
    const idDiscord = DONNEES_PROFIL.find((d) => d.donnee === "ID Discord");
    expect(idDiscord).toBeDefined();
    expect(idDiscord?.finalite).toMatch(/Discord/);
  });

  it("fonde le compte et la connexion sur le contrat, et non sur un consentement", () => {
    // Un consentement demandé pour des données sans lesquelles le compte
    // n'existe pas ne serait pas libre (RGPD art. 7.4) — et le registre (T01,
    // T02) les fonde déjà sur le contrat : une donnée n'a qu'une base.
    for (const donnee of [
      "Pseudo site",
      "Pseudo Discord",
      "ID Discord",
      "Identifiant Google",
      "Identifiant Blizzard",
    ]) {
      expect(DONNEES_PROFIL.find((d) => d.donnee === donnee)?.base).toBe("Exécution du contrat");
    }
  });

  it("réserve le consentement à ce que le joueur choisit en plus", () => {
    for (const entry of DONNEES_PROFIL) {
      // Seule exception : le choix des messages privés de match, opposition à un
      // traitement d'intérêt légitime (registre T04).
      if (entry.donnee === "Choix des messages privés de match") continue;
      expect(["Exécution du contrat", "Consentement"]).toContain(entry.base);
    }
    // Données facultatives, renseignées et publiées au choix du joueur : un
    // compte fonctionne sans elles, le contrat ne les exige pas.
    for (const donnee of [
      "Certification du pseudo Discord",
      "Pseudo Overwatch",
      "Pseudo Marvel Rivals",
      "Avatar",
    ]) {
      expect(DONNEES_PROFIL.find((d) => d.donnee === donnee)?.base).toBe("Consentement");
    }
  });

  it("every profile entry has a non-empty finalite and duree", () => {
    for (const entry of DONNEES_PROFIL) {
      expect(entry.finalite.trim().length).toBeGreaterThan(0);
      expect(entry.duree.trim().length).toBeGreaterThan(0);
    }
  });

  it("profile data is tied to account lifetime", () => {
    // **Bornée par** la durée du compte, et non strictement égale : la
    // certification du tag Discord se perd dès que le tag change, donc plus tôt.
    // Ce qu'il faut tenir est qu'aucune donnée de profil ne survive au compte —
    // pas que toutes vivent exactement aussi longtemps que lui.
    for (const entry of DONNEES_PROFIL) {
      expect(entry.duree.toLowerCase()).toContain("durée du compte");
    }
  });
});

describe("DONNEE_TOURNOIS", () => {
  it("uses Intérêt légitime as legal basis (not Consentement)", () => {
    expect(DONNEE_TOURNOIS.base).toBe("Intérêt légitime");
    expect(DONNEE_TOURNOIS.base).not.toBe("Consentement");
  });

  it("says no retention period is defined: kept while the site exists, anonymised on account deletion", () => {
    expect(DONNEE_TOURNOIS.duree).toMatch(/^Aucune durée définie/);
    expect(DONNEE_TOURNOIS.duree).toContain("tant que le site existe");
    expect(DONNEE_TOURNOIS.duree).toContain("anonymisés à la suppression du compte");
  });

  it("has a non-empty finalite", () => {
    expect(DONNEE_TOURNOIS.finalite.trim().length).toBeGreaterThan(0);
  });
});

describe("DROITS", () => {
  it("liste les huit droits : art. 15 à 21, retrait du consentement, directives post-mortem", () => {
    expect(DROITS).toHaveLength(8);
  });

  it("dit que l'alerte AutoMod d'une annonce #live survit au compte comme l'annonce, supprimée sur demande (FR et EN)", () => {
    const erasureFr = DROITS.map((d) => d.text).find((t) => t.includes("Les annonces #live d'un tournoi individuel"));
    const erasureEn = DROITS_EN.map((d) => d.text).find((t) => t.includes("The #live announcements of a solo tournament"));
    expect(erasureFr).toMatch(/sur une demande distincte \(« Signaler un problème », catégorie RGPD\), comme l'alerte de modération d'une telle annonce bloquée ou signalée par AutoMod/);
    expect(erasureEn).toMatch(/on a separate request \(“Report a problem”, GDPR category\), as does the moderation alert for such an announcement blocked or flagged by AutoMod/);
  });

  it("couvre le droit à la limitation (art. 18)", () => {
    const limitation = DROITS.find((d) => d.title.toLowerCase().includes("limitation"));
    expect(limitation?.text).toMatch(/art\. 18/);
  });

  it("couvre les directives après le décès (art. 85 loi Informatique et Libertés)", () => {
    const directives = DROITS.find((d) => /décès/.test(d.title));
    expect(directives?.text).toMatch(/art\. 85 de la loi Informatique et Libertés/);
  });

  it.each<[string]>([["effacement"], ["accès"], ["opposition"]])("covers the right to %s", (keyword) => {
    const found = DROITS.some((d) => d.title.toLowerCase().includes(keyword));
    expect(found).toBe(true);
  });

  it("every right has a non-empty title and text", () => {
    for (const droit of DROITS) {
      expect(droit.title.trim().length).toBeGreaterThan(0);
      expect(droit.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("DONNEE_SAUVEGARDES", () => {
  it("annonce la durée réelle des sauvegardes, pas « quelques jours »", () => {
    expect(DONNEE_SAUVEGARDES.duree).toBe(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(BACKUP_RETENTION_DAYS).toBe(30);
  });

  it("nomme le détenteur réel de la clé, pas « seule l'association »", () => {
    expect(DONNEE_SAUVEGARDES.finalite).not.toMatch(/seule l'association/);
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/responsable technique/);
  });

  it("nomme l'hébergeur et le chiffrement", () => {
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/Hetzner, en Allemagne/);
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/chiffrées/i);
  });
});

describe("/rgpd — données obligatoires : la langue du compte (revue juridique #439)", () => {
  const read = (file: string) => readFileSync(join(__dirname, "../../..", file), "utf8");

  it("dit en FR et en EN que tout compte garde une langue, non facultative et modifiable", () => {
    expect(read("app/rgpd/page.tsx")).toMatch(/Il garde aussi une langue, français ou anglais \(le français par défaut\)/);
    // BOT-NOTIF-LANG : la langue sert aussi aux messages privés Discord ; les salons restent en français.
    expect(read("app/rgpd/page.tsx")).toMatch(
      /vos\s+notifications push et les messages privés Discord du site \(les messages des salons Discord\s+restent en français\)/,
    );
    expect(read("app/rgpd/page.tsx")).toMatch(/Le bot vous écrit aussi en privé, dans la\s+langue de votre compte/);
    expect(read("app/rgpd/page.tsx")).toMatch(/vous la changez dans Mon profil \(jusqu&apos;à votre prochaine connexion\s+faite dans l&apos;autre langue\)/);
    expect(read("app/rgpd/RgpdEn.tsx")).toMatch(/It also keeps a language, French or English \(French by default\)/);
    expect(read("app/rgpd/RgpdEn.tsx")).toMatch(
      /your push notifications and the site&apos;s Discord direct\s+messages to you \(messages in Discord channels stay in French\)/,
    );
    expect(read("app/rgpd/RgpdEn.tsx")).toMatch(/The bot also writes to you privately, in your account&apos;s\s+language/);
    expect(read("app/rgpd/RgpdEn.tsx")).toMatch(/you can change it in My profile \(until you next log in from a page\s+in the other language\)/);
  });

  // Revue juridique BOT-NOTIF-LANG : le code de certification ou de changement
  // du tag part aussi au bot avec une langue — celle du compte déjà rattaché à
  // ce Discord, bilingue sans compte — et un bilingue trop long part en français seul.
  it("dit quel compte donne la langue du code, que T08 la reçoit, et le repli en français seul (FR et EN)", () => {
    const fr = read("app/rgpd/page.tsx").replace(/\s+/g, " ");
    expect(fr).toMatch(/le code envoyé par message privé Discord \(connexion, certification ou changement du tag\) est rédigé par le bot/);
    expect(fr).toMatch(/la langue du compte déjà rattaché à ce compte Discord — en français puis en anglais s&apos;il n&apos;y en a pas/);
    expect(fr).toMatch(/en français seul si les deux ne tiennent pas dans un message/);
    const en = read("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");
    expect(en).toMatch(/the code sent by Discord direct message \(login, certification or change of the tag\) is written by the bot/);
    expect(en).toMatch(/account already linked to that Discord account — French then English when there is none/);
    expect(en).toMatch(/French alone when both do not fit in one message/);

    const items = (list: readonly (typeof PROCESSING_ACTIVITIES)[number][], ref: string) =>
      list.find((activity) => activity.ref === ref)!.dataCategories.join(" ");
    expect(items(PROCESSING_ACTIVITIES, "T01")).toMatch(/celle du compte déjà rattaché à ce compte Discord, en français puis en anglais s'il n'y en a pas/);
    expect(items(PROCESSING_ACTIVITIES_EN, "T01")).toMatch(/the language of the account already linked to that Discord account, French then English when there is none/);
    expect(items(PROCESSING_ACTIVITIES, "T08")).toMatch(/pour le seul code envoyé en message privé \(connexion, certification ou changement du tag\), la langue du compte du site/);
    expect(items(PROCESSING_ACTIVITIES_EN, "T08")).toMatch(/for the code sent by direct message only \(login, certification or change of the tag\), the language of the site account/);
  });

  // Deuxième passe : la langue sert aux messages privés Discord partout où elle est décrite.
  it("décrit le même usage dans le tableau des données, à la collecte, dans Mon profil et dans T01, T02, T08 (FR et EN)", () => {
    expect(read("lib/shared/rgpd-policy.ts")).toMatch(/la langue des notifications push et des messages privés Discord du site \(transmise au bot avec le seul code envoyé en message privé\)/);
    expect(read("lib/shared/rgpd-policy-en.ts")).toMatch(/the language of push notifications and of the site's Discord direct messages \(sent to the bot with the code sent by direct message only\)/);
    expect(read("messages/fr/login.json")).toMatch(/pour t'écrire dans cette langue tes notifications push et les messages privés Discord du site/);
    expect(read("messages/en/login.json")).toMatch(/to write your push notifications and the site's Discord direct messages in that language/);
    expect(read("messages/fr/profile.json")).toMatch(/Tes notifications push et les messages privés Discord du site arrivent dans cette langue/);
    expect(read("messages/en/profile.json")).toMatch(/Your push notifications and the site's Discord direct messages arrive in this language/);

    const find = (list: readonly (typeof PROCESSING_ACTIVITIES)[number][], ref: string) =>
      list.find((activity) => activity.ref === ref)!;
    expect(find(PROCESSING_ACTIVITIES, "T01").recipients).toContain("Bot Discord de l'association (T08) : la langue du compte, avec le seul code envoyé en message privé");
    expect(find(PROCESSING_ACTIVITIES_EN, "T01").recipients).toContain("The association's Discord bot (T08): the account language, with the code sent by direct message only");
    expect(find(PROCESSING_ACTIVITIES, "T02").dataCategories).toContain("Langue du compte déjà rattaché à ce compte Discord (T01), lue pour que le bot rédige le code dans cette langue");
    expect(find(PROCESSING_ACTIVITIES_EN, "T02").dataCategories).toContain("Language of the account already linked to that Discord account (T01), read so that the bot writes the code in that language");
    const t08 = find(PROCESSING_ACTIVITIES, "T08").subPurposes.join(" ");
    expect(t08).toMatch(/codes \(rédigés par le bot dans la langue du compte que le site lui transmet\)/);
    expect(t08).toMatch(/avatar masqué, retiré ou rétabli, suspension du compte et sa levée/);
    const t08En = find(PROCESSING_ACTIVITIES_EN, "T08").subPurposes.join(" ");
    expect(t08En).toMatch(/codes \(written by the bot in the account language the site sends it\)/);
    expect(t08En).toMatch(/avatar hidden, removed or restored, suspension of the account and its lifting/);
    for (const activities of [PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN]) {
      expect(find(activities, "T01").recipients).toHaveLength(find(PROCESSING_ACTIVITIES, "T01").recipients.length);
      expect(find(activities, "T02").dataCategories).toHaveLength(find(PROCESSING_ACTIVITIES, "T02").dataCategories.length);
    }
  });
});

describe("messages privés d'horaire et de rappel de match — base légale (revue juridique #441)", () => {
  it("l'identifiant et le pseudo Discord portent l'intérêt légitime pour ces messages, comme le registre T04", () => {
    for (const donnee of ["Pseudo Discord", "ID Discord"]) {
      const entry = DONNEES_PROFIL.find((d) => d.donnee === donnee);
      expect(entry?.base).toBe("Exécution du contrat");
      expect(entry?.extraBases?.[0]).toEqual({ base: "Intérêt légitime", scope: MATCH_TIME_DM_SCOPE });
    }
    // Revue légale DM-CERTIFIED-ONLY : l'ID sert aussi aux avis de modération (T11) et sur les données (T10).
    expect(DONNEES_PROFIL.find((d) => d.donnee === "ID Discord")?.extraBases).toEqual([
      { base: "Intérêt légitime", scope: MATCH_TIME_DM_SCOPE },
      { base: "Intérêt légitime", scope: MODERATION_DM_SCOPE },
      { base: "Obligation légale", scope: DATA_NOTICE_DM_SCOPE },
    ]);
    const t04 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04");
    // Les messages vont à tous les membres actifs des équipes, pas aux seuls joueurs.
    expect(t04?.dataSubjects).toContain("Autres membres des équipes engagées (coachs, managers, propriétaires)");
    expect(t04?.legalBasis).toMatch(/intérêt légitime \(bon déroulement des tournois\) pour l'annonce des horaires de match, l'avis qu'un match quitte son programme et les rappels de match envoyés aux joueurs, avec un droit d'opposition/);
  });

  it("le droit d'opposition les nomme, en français et en anglais", () => {
    expect(DROITS.find((d) => d.title === "Droit d'opposition")?.text).toContain(MATCH_TIME_DM_SCOPE);
    expect(DROITS_EN.find((d) => d.title === "Right to object")?.text).toContain(
      "match time notices, reminders and match removal notices by direct message",
    );
    // L'avis « Match retiré » et la case de Mon profil (revue juridique #444).
    expect(MATCH_TIME_DM_SCOPE).toBe("annonces d'horaire, rappels et avis de retrait de match en message privé");
    expect(DROITS.find((d) => d.title === "Droit d'opposition")?.text).toMatch(/case « Messages privés Discord de mes matchs » de Mon profil/);
    expect(DROITS_EN.find((d) => d.title === "Right to object")?.text).toMatch(/“Discord direct messages about my matches” box in My profile/);
  });

  it("déclare le pseudo #live et le choix des messages privés de match (revue juridique #444)", () => {
    expect(DROITS.find((d) => d.title === "Droit à l'effacement")?.text).toMatch(/annonces #live d'un tournoi individuel qui ont publié votre pseudo restent dans le salon Discord jusqu'à leur suppression, sur une demande distincte/);
    expect(DROITS_EN.find((d) => d.title === "Right to erasure")?.text).toMatch(/#live announcements of a solo tournament that posted your username stay in the Discord channel until they are deleted, on a separate request/);
    // Le pseudo #live repose sur l'exécution du service, pas l'intérêt légitime (décision du 2026-10-14) :
    // le droit d'opposition l'exclut, ne pas y être nommé = ne pas s'inscrire.
    expect(DROITS.find((d) => d.title === "Droit d'opposition")?.text).toMatch(/Le pseudo publié dans l'annonce #live d'un tournoi individuel n'en fait pas partie : il relève de l'exécution du service auquel vous vous inscrivez — ne pas y être nommé revient à ne pas s'inscrire/);
    expect(DROITS_EN.find((d) => d.title === "Right to object")?.text).toMatch(/The username posted in the #live announcement of a solo tournament is not part of it: it falls under performance of the service you register for — not being named in it means not registering/);
    const pseudo = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo site");
    // Revue légale #445 : l'alerte AutoMod repose sur l'intérêt légitime (modérer le serveur), pas sur le contrat.
    expect(pseudo?.extraBases).toEqual([
      { base: "Exécution du contrat", scope: LIVE_PSEUDO_SCOPE },
      { base: "Intérêt légitime", scope: AUTOMOD_ALERT_SCOPE },
    ]);
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Site username")?.extraBases).toEqual([
      { base: "Exécution du contrat", scope: "#live announcement of a solo tournament, kept in the Discord channel until deleted on request" },
      { base: "Intérêt légitime", scope: "AutoMod alert for such an announcement when blocked or flagged, kept in the moderators' alert channel until they delete it or on request" },
    ]);
    const choice = DONNEES_PROFIL.find((d) => d.donnee === "Choix des messages privés de match");
    expect(choice?.base).toBe("Intérêt légitime");
    expect(choice?.finalite).toMatch(/Figure dans l'export de tes données, remis au défaut si le compte est anonymisé/);
    // Revue légale #445 : la ligne dit à qui profite l'intérêt légitime (le joueur), comme T04.
    expect(choice?.finalite).toMatch(/Gardé dans ton intérêt légitime : c'est ce qui permet d'honorer ton opposition/);
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Match direct messages choice")?.finalite).toMatch(/Kept in your legitimate interest: that is what allows your objection to be honoured/);
    expect(DROITS.find((d) => d.title === "Droit d'opposition")?.text).toMatch(/L'alerte AutoMod d'une telle annonce bloquée ou signalée, gardée pour la modération du serveur Discord \(intérêt légitime\), est supprimée sur demande/);
    expect(DROITS_EN.find((d) => d.title === "Right to object")?.text).toMatch(/The AutoMod alert for such an announcement when blocked or flagged, kept to moderate the Discord server \(legitimate interest\), is deleted on request/);
    expect(AUTOMOD_ALERT_SCOPE).toMatch(/alerte AutoMod d'une telle annonce bloquée ou signalée, gardée dans le salon d'alertes des modérateurs/);
    expect(LIVE_PSEUDO_SCOPE).not.toMatch(/AutoMod/);
    expect(DONNEES_PROFIL_EN.find((d) => d.donnee === "Match direct messages choice")?.finalite).toMatch(/reset to the default if the account is anonymized/);
  });

  it("le registre du bot (T08) déclare ce que le site lui transmet, comme sa politique", () => {
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect(t08?.dataCategories.join(" ")).toMatch(
      /Messages du site : identifiant ou pseudo Discord du destinataire, son pseudo BlueGenji[^,]*, le texte du message/,
    );
    const t08En = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T08");
    expect(t08En?.dataCategories.join(" ")).toMatch(/Site messages: the recipient's Discord ID or username, their BlueGenji username/);
    expect(t08En?.dataCategories).toHaveLength(t08?.dataCategories.length ?? -1);
  });

  it("la portée est traduite en anglais", () => {
    const entry = DONNEES_PROFIL_EN.find((d) => d.donnee === "Discord ID");
    expect(entry?.extraBases).toEqual([
      { base: "Intérêt légitime", scope: "match time notices, reminders and match removal notices by direct message" },
      { base: "Intérêt légitime", scope: "suspension or moderation notices by direct message" },
      { base: "Obligation légale", scope: "information about your data by direct message" },
    ]);
  });
});
