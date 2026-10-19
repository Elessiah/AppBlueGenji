import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { closedNoticeText } from "@/app/(secured)/tournois/[id]/_components/PlayerScoreDialog";
import { startAtHint } from "@/app/(secured)/tournois/[id]/_components/MatchScheduleDialog";
import { anotherModalOpen } from "@/components/match-launch/MatchLaunchCenter";
import { CasterCard, SideCard } from "@/components/match-launch/LaunchContactCards";
import { contactsErrorText } from "@/components/match-launch/MatchContactsDialog";
import { FR_LAUNCH_TEXT } from "@/components/match-launch/launch-text";
import { tournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import type { LaunchSide } from "@/lib/shared/match-launch";
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
    expect(closedNoticeText(EN, "SCHEDULED", "Monday", false)).not.toMatch(/ready/i);
    expect(closedNoticeText(EN, "SCHEDULED", null, false)).toBe(enDialogs.score.player.closed.scheduledDirect);
  });

  it("option allumée ou absente : la règle d'origine", () => {
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
      expect(text).not.toMatch(/ready/i);
    }
  });

  it("option allumée ou absente : l'entrée en lancement", () => {
    expect(startAtHint(FR, false, true, true)).toBe(frDialogs.schedule.hint);
    expect(startAtHint(FR, true, true, true, true)).toBe(frDialogs.schedule.hintPlanning);
  });
});

describe("forcer le lancement — confirmation", () => {
  it("a sa phrase sans « Prêt », en FR et en EN", () => {
    expect(frActions.cardActions.forceConfirm.bodyDirect).not.toMatch(/prêt/i);
    expect(enActions.cardActions.forceConfirm.bodyDirect).not.toMatch(/ready/i);
    const source = read("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(source).toContain('{launchPhaseEnabled && <p>{t("cardActions.forceConfirm.body")}</p>}');
    expect(source).toContain(
      '{!launchPhaseEnabled && phase !== "TO_PLAN" && <p>{t("cardActions.forceConfirm.bodyDirect")}</p>}',
    );
  });
});

describe("formulaire et règles", () => {
  it("le délai d'office vient de LAUNCH_AUTO_DELAY_MINUTES", () => {
    expect(frForm.form.launchPhase.description).toContain("{launchDelay} minutes");
    expect(enForm.form.launchPhase.description).toContain("{launchDelay} minutes");
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
  it("écrit le refus dans la modale, pas « aucun contact »", () => {
    const source = read("components/match-launch/MatchContactsDialog.tsx");
    expect(source).toContain("{contactsErrorText(text, state.code)}");
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
    ...overrides,
  });
  const noop = async () => {};

  it("équipe → sa fiche, contact → son profil", () => {
    const html = renderToStaticMarkup(<SideCard side={side()} isHost={false} phase="LAUNCHED" onCopy={noop} />);
    expect(html).toContain('href="/equipes/42"');
    expect(html).toContain('href="/joueurs/7"');
  });

  it("entrée solo → le profil du joueur, jamais une fiche d'équipe", () => {
    const html = renderToStaticMarkup(
      <SideCard side={side({ isSolo: true })} isHost={false} phase="LAUNCHED" onCopy={noop} />,
    );
    expect(html).not.toContain("/equipes/");
    expect(html).toContain('href="/joueurs/7"');
    const hidden = renderToStaticMarkup(
      <SideCard side={side({ isSolo: true, contacts: [] })} isHost={false} phase="SCHEDULED" onCopy={noop} />,
    );
    expect(hidden).not.toContain("href=");
  });

  it("caster → son profil", () => {
    const html = renderToStaticMarkup(
      <CasterCard
        caster={{ userId: 9, pseudo: "Voix", discordTag: null, battletag: null, battletagVerified: false, ready: false }}
        phase="LAUNCHED"
        onCopy={noop}
      />,
    );
    expect(html).toContain('href="/joueurs/9"');
  });
});
