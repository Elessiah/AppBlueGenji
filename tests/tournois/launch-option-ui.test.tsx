import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { closedNoticeText } from "@/app/(secured)/tournois/[id]/_components/PlayerScoreDialog";
import { startAtHint } from "@/app/(secured)/tournois/[id]/_components/MatchScheduleDialog";
import { anotherModalOpen, launchSidesLaterText } from "@/components/match-launch/MatchLaunchCenter";
import { CasterCard, SideCard } from "@/components/match-launch/LaunchContactCards";
import { contactsErrorText } from "@/components/match-launch/MatchContactsDialog";
import { FR_LAUNCH_TEXT } from "@/components/match-launch/launch-text";
import { tournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { casterContactsArrived, exposesCasterContacts, viewerIsCaster, type LaunchSide, type MatchLaunchInfo } from "@/lib/shared/match-launch";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";
import frRules from "@/messages/fr/rules.json";
import enRules from "@/messages/en/rules.json";

/**
 * Textes et gestes d'un tournoi **sans** phase de lancement (option éteinte,
 * `docs/features/MATCH_LAUNCH.md` § Option du tournoi) : rien n'y parle de
 * « Prêt » ; et la modale « Contacts » (refus écrit, pas d'ouverture d'office
 * par-dessus, noms cliquables).
 */

const FR = tournamentDialogsText("fr", frDialogs);
const EN = tournamentDialogsText("en", enDialogs);
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("modale de score — pourquoi le score attend", () => {
  it("option éteinte : l'heure, sans « Prêt » (FR et EN)", () => {
    expect(closedNoticeText(FR, "SCHEDULED", "lundi 19 octobre à 21:00", false)).toBe(
      "Ce match démarre le lundi 19 octobre à 21:00 : le score se saisit dès qu'il a démarré.",
    );
    expect(closedNoticeText(FR, "SCHEDULED", null, false)).not.toMatch(/prêt/i);
    expect(closedNoticeText(EN, "SCHEDULED", "Monday", false)).not.toMatch(/\bready\b/i);
    expect(closedNoticeText(EN, "SCHEDULED", null, false)).toBe(enDialogs.score.player.closed.scheduledDirect);
  });

  it("option éteinte, l'heure passée avant la mise à jour : pas de « Prêt »", () => {
    expect(closedNoticeText(FR, "LAUNCHED", null, false)).toBe(frDialogs.score.player.closed.startingDirect);
    expect(closedNoticeText(EN, "LAUNCHED", null, false)).toBe(enDialogs.score.player.closed.startingDirect);
    expect(enDialogs.score.player.closed.startingDirect).not.toMatch(/\bready\b/i);
  });

  it("option éteinte, déjà lancé mais score fermé (page figée…) : avis neutre", () => {
    expect(closedNoticeText(FR, "LAUNCHED", null, false, "2026-10-19T19:00:00.000Z")).toBe(
      frDialogs.score.player.closed.unavailable,
    );
    expect(enDialogs.score.player.closed.unavailable).toBe("The score can't be entered right now.");
  });

  it("option allumée ou absente : la règle d'origine", () => {
    expect(closedNoticeText(FR, "LOBBY", null)).toBe(frDialogs.score.player.closed.lobby);
    expect(closedNoticeText(FR, "SCHEDULED", null)).toBe(frDialogs.score.player.closed.scheduled);
    expect(closedNoticeText(FR, "SCHEDULED", null, true)).toBe(frDialogs.score.player.closed.scheduled);
    expect(closedNoticeText(FR, "TO_PLAN", null, false)).toBe(frDialogs.score.player.closed.toPlan);
  });
});

describe("modale d'horaire — ce que la date produit", () => {
  it("option éteinte : le match est lancé directement", () => {
    expect(startAtHint(FR, false, true, true, false)).toBe(frDialogs.schedule.hintDirect);
    expect(startAtHint(FR, true, true, true, false)).toBe(frDialogs.schedule.hintPlanningDirect);
    expect(startAtHint(EN, false, true, true, false)).toBe(enDialogs.schedule.hintDirect);
    for (const text of [frDialogs.schedule.hintDirect, frDialogs.schedule.hintPlanningDirect]) {
      expect(text).not.toMatch(/prêt/i);
    }
    for (const text of [enDialogs.schedule.hintDirect, enDialogs.schedule.hintPlanningDirect]) {
      expect(text).not.toMatch(/\bready\b/i);
    }
  });

  it("option éteinte : vider la date lance le match tout de suite — l'aide le dit (FR et EN)", () => {
    expect(frDialogs.schedule.hintDirect).toMatch(/lancé tout de suite, sans retour possible/);
    expect(enDialogs.schedule.hintDirect).toMatch(/launched right away, with no going back/);
    // Adversaire encore inconnu : rien ne part tout de suite.
    expect(startAtHint(FR, false, false, false, false)).toMatch(/^Sans jour ni mois = aucun horaire : le match sera lancé dès que ses deux adversaires seront connus/);
    expect(enDialogs.schedule.hintDirectTbd).toMatch(/as soon as both its opponents are known/);
  });

  it("match déjà lancé, option allumée : la date ne le fait pas attendre (FR et EN)", () => {
    expect(startAtHint(FR, false, true, false, true, true)).toBe(
      `${frDialogs.schedule.hintLaunched} ${frDialogs.schedule.notice}`,
    );
    expect(startAtHint(EN, false, true, false, true, true)).toMatch(/^The match has already launched:/);
  });

  it("match lancé d'office, option éteinte : une heure à venir le remet en attente (FR et EN)", () => {
    expect(startAtHint(FR, false, true, false, false, true)).toBe(
      `${frDialogs.schedule.hintLaunchedDirect} ${frDialogs.schedule.notice}`,
    );
    expect(startAtHint(EN, false, true, false, false, true)).toBe(
      `${enDialogs.schedule.hintLaunchedDirect} ${enDialogs.schedule.notice}`,
    );
    expect(startAtHint(FR, true, true, false, false, true)).toBe(
      `${frDialogs.schedule.hintLaunchedPlanningDirect} ${frDialogs.schedule.noticePlanning}`,
    );
    for (const text of [frDialogs.schedule.hintLaunchedDirect, frDialogs.schedule.hintLaunchedPlanningDirect]) {
      expect(text).toMatch(/En attente de départ/);
      expect(text).not.toMatch(/prêt/i);
    }
    for (const text of [enDialogs.schedule.hintLaunchedDirect, enDialogs.schedule.hintLaunchedPlanningDirect]) {
      expect(text).toMatch(/Waiting to start/);
      expect(text).not.toMatch(/\bready\b/i);
    }
    expect(frDialogs.schedule.hintLaunchedPlanningDirect).toMatch(/À planifier/);
    expect(enDialogs.schedule.hintLaunchedPlanningDirect).toMatch(/To schedule/);
    // Joué : l'archive seule.
    expect(startAtHint(FR, false, true, true, false, true)).toBe(frDialogs.schedule.hintDirect);
  });

  it("option allumée ou absente : l'entrée en lancement", () => {
    expect(startAtHint(FR, false, true, true)).toBe(frDialogs.schedule.hint);
    expect(startAtHint(FR, true, true, true, true)).toBe(frDialogs.schedule.hintPlanning);
  });
});

describe("forcer le lancement — confirmation", () => {
  it("a sa phrase sans « Prêt », en FR et en EN", () => {
    expect(frActions.cardActions.forceConfirm.bodyDirect).not.toMatch(/prêt/i);
    expect(enActions.cardActions.forceConfirm.bodyDirect).not.toMatch(/\bready\b/i);
    const source = read("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(source).toContain('{launchPhaseEnabled && <p>{t("cardActions.forceConfirm.body")}</p>}');
    expect(source).toContain(
      '{!launchPhaseEnabled && phase !== "TO_PLAN" && <p>{t("cardActions.forceConfirm.bodyDirect")}</p>}',
    );
  });
});

describe("planification par l'arbitrage — option éteinte", () => {
  it("avertissements sans « Prêt » (FR et EN)", () => {
    expect(frForm.form.referee.warningDirect).not.toMatch(/prêt/i);
    expect(enForm.form.referee.warningDirect).not.toMatch(/\bready\b/i);
    expect(frActions.planning.confirm.consequenceDirect).not.toMatch(/prêt/i);
    expect(enActions.planning.confirm.consequenceDirect).not.toMatch(/\bready\b/i);
    expect(read("app/(secured)/tournois/_components/RefereeSchedulingField.tsx")).toContain(
      '{t(launchPhase ? "form.referee.warning" : "form.referee.warningDirect")}',
    );
    expect(read("app/(secured)/tournois/[id]/_components/MatchPlanningPanel.tsx")).toContain(
      'detail.card.launchPhase ? "planning.confirm.consequence" : "planning.confirm.consequenceDirect"',
    );
  });
});

describe("formulaire et règles", () => {
  it("le délai d'office vient de LAUNCH_AUTO_DELAY_MINUTES", () => {
    expect(frForm.form.launchPhase.description).toContain("{launchDelay} minutes");
    expect(enForm.form.launchPhase.description).toContain("{launchDelay} minutes");
    expect(frForm.form.launchPhase.description).toMatch(/un match sans heure, dès que ses deux adversaires sont connus/);
    expect(enForm.form.launchPhase.description).toMatch(/a match with no time, as soon as both its opponents are known/);
    expect(read("app/(secured)/tournois/_components/LaunchPhaseField.tsx")).toContain(
      "launchDelay: LAUNCH_AUTO_DELAY_MINUTES",
    );
  });

  it("/regles dit que la phase dépend du tournoi (FR et EN)", () => {
    const fr = frRules.common.find((section) => section.title === "Lancement d'un match");
    const en = enRules.common.find((section) => section.title === "Match launch");
    expect(fr?.body).toHaveLength(2);
    expect(en?.body).toHaveLength(2);
    expect(fr?.body[1]).toMatch(/lancé directement/);
    expect(en?.body[1]).toMatch(/launched directly/);
  });
});

describe("modale « Contacts »", () => {
  it("refus : notification, et un corps neutre (pas « aucun contact »)", () => {
    const source = read("components/match-launch/MatchContactsDialog.tsx");
    expect(source).toContain('{state.kind === "failed" && <p className={styles.note}>{t("contacts.notShown")}</p>}');
    expect(FR_LAUNCH_TEXT.t("contacts.notShown")).toBe("Contacts non affichés.");
    expect(contactsErrorText(FR_LAUNCH_TEXT, "MATCH_CONTACTS_UNAVAILABLE")).toBe(
      FR_LAUNCH_TEXT.t("contacts.unavailable"),
    );
    expect(contactsErrorText(FR_LAUNCH_TEXT, null)).toBe(FR_LAUNCH_TEXT.t("contacts.failed"));
  });

  it("la modale de lancement ne s'ouvre pas d'office par-dessus une autre modale", () => {
    const withModal = { querySelector: () => ({}) } as unknown as ParentNode;
    const withoutModal = { querySelector: () => null } as unknown as ParentNode;
    expect(anotherModalOpen(withModal)).toBe(true);
    expect(anotherModalOpen(withoutModal)).toBe(false);
    // …et « Contacts » relance la lecture à sa fermeture.
    expect(read("components/match-launch/MatchContactsDialog.tsx")).toContain(
      "window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));",
    );
  });

  it("« Contacts » ne prend pas la place principale d'un geste d'arbitrage", () => {
    expect(read("app/(secured)/tournois/[id]/_lib/match-card-actions.ts")).toContain(
      '["playerScore", "openLaunch", "plan", "adminScore", "contacts"]',
    );
  });

  it("est chargée à la demande, pas avec la page de tournoi", () => {
    const source = read("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(source).not.toMatch(/^import \{ MatchContactsDialog \}/m);
    expect(source).toContain('import("@/components/match-launch/MatchContactsDialog")');
  });
});

describe("fiches de contact — noms cliquables", () => {
  const contact = {
    userId: 7,
    pseudo: "Alice",
    roles: ["CAPITAINE" as const],
    discordTag: null,
    battletag: null,
    battletagVerified: false,
  };
  const side = (overrides: Partial<LaunchSide> = {}): LaunchSide => ({
    teamId: 42,
    name: "Les Bleus",
    logoUrl: null,
    isGhost: false,
    isSolo: false,
    ready: false,
    contacts: [contact],
    contactsShown: true,
    ...overrides,
  });
  const noop = async () => {};
  const TEAM_VIEWER = { role: "TEAM1", isCaster: false, earlyContacts: true } as const;
  const LATER = "Contacts non affichés.";

  it("modale de lancement (par défaut) : aucun lien — elle survit à la navigation", () => {
    const html = renderToStaticMarkup(<SideCard side={side()} isHost={false} phase="LAUNCHED" onCopy={noop} laterText={LATER} />);
    expect(html).not.toContain("href=");
  });

  it("équipe → sa fiche, contact → son profil", () => {
    const html = renderToStaticMarkup(
      <SideCard side={side()} isHost={false} phase="LAUNCHED" onCopy={noop} laterText={LATER} linkNames />,
    );
    expect(html).toContain('href="/equipes/42"');
    expect(html).toContain('href="/joueurs/7"');
  });

  // Contacts tus par le serveur : la note de la modale de lancement ne renvoie
  // à l'action « Contacts » que pour qui elle ouvre quelque chose — pas pour le
  // seul caster avant le départ (un arbitre qui caste, si : `earlyContacts`).
  it("contacts tus → note au lancement, sans renvoi à « Contacts » pour le caster", () => {
    expect(launchSidesLaterText(FR_LAUNCH_TEXT, { earlyContacts: true })).toContain("ou dès maintenant par l'action « Contacts »");
    const forCaster = launchSidesLaterText(FR_LAUNCH_TEXT, { earlyContacts: false });
    expect(forCaster).toBe("Les contacts s'affichent au lancement.");
    const closed = side({ contacts: [], contactsShown: false });
    const html = renderToStaticMarkup(<SideCard side={closed} isHost={false} phase="SCHEDULED" onCopy={noop} laterText={forCaster} />);
    expect(html).toContain("Les contacts s&#x27;affichent au lancement.</p>");
    expect(html).not.toContain("« Contacts »");
    // La modale « Contacts » passe sa note : jamais un renvoi à elle-même.
    const inDialog = renderToStaticMarkup(<SideCard side={closed} isHost={false} phase="SCHEDULED" onCopy={noop} laterText={LATER} />);
    expect(inDialog).toContain("Contacts non affichés.");
    expect(inDialog).not.toContain("« Contacts »");
  });

  it("entrée solo → le profil du joueur, jamais une fiche d'équipe", () => {
    const html = renderToStaticMarkup(
      <SideCard side={side({ isSolo: true })} isHost={false} phase="LAUNCHED" onCopy={noop} laterText={LATER} linkNames />,
    );
    expect(html).not.toContain("/equipes/");
    expect(html).toContain('href="/joueurs/7"');
    const hidden = renderToStaticMarkup(
      <SideCard side={side({ isSolo: true, contacts: [], contactsShown: false })} isHost={false} phase="SCHEDULED" onCopy={noop} laterText={LATER} linkNames />,
    );
    expect(hidden).not.toContain("href=");
  });

  it("caster → son profil", () => {
    const html = renderToStaticMarkup(
      <CasterCard
        caster={{ userId: 9, pseudo: "Voix", discordTag: null, battletag: null, battletagVerified: false, ready: false, contactsShown: true }}
        phase="LAUNCHED"
        onCopy={noop}
        viewer={TEAM_VIEWER}
        linkNames
      />,
    );
    expect(html).toContain('href="/joueurs/9"');
  });

  // La carte rend la décision du serveur (`exposesCasterContacts`, portée par la réponse).
  describe("caster : contacts ou note, selon la phase et le lecteur", () => {
    const caster = { userId: 9, pseudo: "Voix", discordTag: "voix", battletag: null, battletagVerified: false, ready: false };
    const NOTE = "Ses contacts s&#x27;afficheront au départ du match.";
    const render = (phase: MatchLaunchInfo["phase"], viewer: { role: MatchLaunchInfo["viewer"]["role"]; isCaster: boolean }) =>
      renderToStaticMarkup(
        <CasterCard
          caster={{ ...caster, contactsShown: exposesCasterContacts(phase, viewer.role) }}
          phase={phase}
          onCopy={noop}
          viewer={viewer}
          laterText={FR_LAUNCH_TEXT.t("contacts.casterLater")}
          announceArrival
        />,
      );

    it("équipe avant le départ → une note, pas deux « — »", () => {
      for (const phase of ["TO_PLAN", "SCHEDULED"] as const) {
        const html = render(phase, TEAM_VIEWER);
        expect(html).toContain(NOTE);
        // Statut présent mais vide : rien à annoncer tant que la note est là.
        expect(html).toContain('<output class="sr-only" aria-live="polite"></output>');
        expect(html).not.toContain("BattleTag");
      }
    });

    it("équipe pendant le match → les contacts, sans note", () => {
      for (const phase of ["LOBBY", "LAUNCHED"] as const) {
        const html = render(phase, { role: "TEAM2", isCaster: false });
        expect(html).toContain("BattleTag");
        // Ouverte sur des contacts déjà là : rien d'« arrivé » à annoncer.
        expect(html).toContain('<output class="sr-only" aria-live="polite"></output>');
        expect(html).not.toContain("afficheront");
      }
    });

    it("arbitre dès que les adversaires sont connus → les contacts", () => {
      for (const phase of ["TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const) {
        const html = render(phase, { role: "REFEREE", isCaster: false });
        expect(html).toContain("BattleTag");
        expect(html).not.toContain("afficheront");
      }
    });

    it("annonce l'arrivée des contacts au seul passage « en attente → montrés »", () => {
      const shown = { ...caster, contactsShown: true };
      expect(casterContactsArrived(true, shown)).toBe(true);
      expect(casterContactsArrived(false, shown)).toBe(false);
      expect(casterContactsArrived(true, { ...caster, contactsShown: false })).toBe(false);
    });

    // Ouverts mais vides : la phrase des engagées sans contact, jamais deux « — ».
    it("contacts ouverts mais vides → « Aucun contact disponible. »", () => {
      const html = renderToStaticMarkup(
        <CasterCard
          caster={{ ...caster, discordTag: null, battletag: null, contactsShown: true }}
          phase="LOBBY"
          onCopy={noop}
          viewer={TEAM_VIEWER}
        />,
      );
      expect(html).toContain("Aucun contact disponible.");
      expect(html).not.toContain("BattleTag");
      // Pas au caster lui-même, sous son propre nom.
      const own = renderToStaticMarkup(
        <CasterCard
          caster={{ ...caster, discordTag: null, battletag: null, contactsShown: true }}
          phase="LOBBY"
          onCopy={noop}
          viewer={{ role: "CASTER", isCaster: true }}
        />,
      );
      expect(own).not.toContain("Aucun contact disponible.");
    });

    it("le caster lui-même avant le départ → ni contacts ni note sur sa propre fiche", () => {
      for (const viewer of [{ role: "CASTER", isCaster: true }, { role: "TEAM1", isCaster: true }] as const) {
        const html = render("SCHEDULED", viewer);
        expect(html).not.toContain("afficheront");
        expect(html).not.toContain("BattleTag");
      }
    });
  });

  // Modale de lancement : la note du caster reprend les mots de celle des engagées.
  it("modale de lancement → note du caster « au lancement », comme celle des engagées", () => {
    const html = renderToStaticMarkup(
      <CasterCard
        caster={{ userId: 9, pseudo: "Voix", discordTag: null, battletag: null, battletagVerified: false, ready: false, contactsShown: false }}
        phase="SCHEDULED"
        onCopy={noop}
        viewer={TEAM_VIEWER}
      />,
    );
    expect(html).toContain("Ses contacts s&#x27;affichent au lancement.");
  });

  // Un joueur du match qui caste aussi garde son rôle de joueur : le drapeau le dit caster.
  it("reconnaît le caster par son rôle ou par le drapeau isCaster", () => {
    expect(viewerIsCaster({ viewer: { role: "CASTER", isCaster: true } })).toBe(true);
    expect(viewerIsCaster({ viewer: { role: "TEAM1", isCaster: true } })).toBe(true);
    expect(viewerIsCaster({ viewer: { role: "TEAM1", isCaster: false } })).toBe(false);
  });
});
