/**
 * Inscription d'un caster sur un match qui a déjà un stream
 * (`docs/features/MATCH_LAUNCH.md` § Casters et streams) : les choix offerts
 * (`_lib/cast-claim.ts`), la fenêtre qui les rend (`CastClaimDialog`), les
 * liens de streams du bandeau (`matchStreamLinks`) et les branchements de la
 * carte (clic direct sans stream, choix du caster retiré par le staff).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
// Rendu serveur : seul l'effet de montage de la confirmation est joué (sans
// lui, elle ne rend rien) ; les autres effets n'ont pas lieu d'être ici.
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed || !String(effect).includes("setMounted")) return;
      effects.armed = false;
      effect();
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { CastClaimDialog } from "@/app/(secured)/tournois/[id]/_components/CastClaimDialog";
import { lockedTrigger } from "@/app/(secured)/tournois/[id]/_components/CastSettingsFields";
import {
  casterLinkEdits,
  casterStreamsOf,
  changedTriggerNeedsDate,
  lockedOnClosedMatch,
  refusedCasterField,
} from "@/app/(secured)/tournois/[id]/_components/MatchLiveDialog";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { matchStreamLinks } from "@/app/(secured)/tournois/[id]/_components/MatchLiveStrip";
import { castClaimBody, castClaimChoiceKey, castClaimChoices } from "@/app/(secured)/tournois/[id]/_lib/cast-claim";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { bracketMatch, matchCaster } from "../helpers/bracket-match";
import { readSource } from "../helpers/read-source";
import { ToastProvider } from "@/components/ui/toast";
import frActions from "@/messages/fr/tournamentActions.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enActions from "@/messages/en/tournamentActions.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const TWO_STREAMS = bracketMatch({
  streams: [
    { id: 3, liveUrl: "https://twitch.tv/match", staff: true },
    { id: 4, liveUrl: null, staff: false },
  ],
  casters: [
    matchCaster({ userId: 9, pseudo: "Voix", streamId: 3 }),
    matchCaster({ userId: 12, pseudo: "Écho", streamId: 3 }),
    matchCaster({ userId: 13, pseudo: "Solo", streamId: 4 }),
  ],
});

describe("castClaimChoices — un choix par stream, puis « ouvrir le sien »", () => {
  it("liste les streams dans leur ordre, chacun avec ses casters, et finit par le stream à part", () => {
    expect(castClaimChoices(TWO_STREAMS)).toEqual([
      { kind: "JOIN", streamId: 3, liveUrl: "https://twitch.tv/match", casterPseudos: ["Voix", "Écho"] },
      { kind: "JOIN", streamId: 4, liveUrl: null, casterPseudos: ["Solo"] },
      { kind: "SEPARATE" },
    ]);
  });

  it("un stream que personne ne tient (lien du staff) se rejoint aussi", () => {
    const match = bracketMatch({ streams: [{ id: 1, liveUrl: "https://kick.com/bg", staff: true }] });
    expect(castClaimChoices(match)[0]).toEqual({
      kind: "JOIN",
      streamId: 1,
      liveUrl: "https://kick.com/bg",
      casterPseudos: [],
    });
  });

  it("le stream d'un caster que la lecture tait n'est pas offert comme « stream du match »", () => {
    // Caster retiré d'office avant le lancement : son stream reste, sans caster visible.
    const match = bracketMatch({
      streams: [
        { id: 6, liveUrl: "https://twitch.tv/perso", staff: false },
        { id: 7, liveUrl: "https://kick.com/bg", staff: true },
      ],
    });
    expect(castClaimChoices(match)).toEqual([
      { kind: "JOIN", streamId: 7, liveUrl: "https://kick.com/bg", casterPseudos: [] },
      { kind: "SEPARATE" },
    ]);
  });

  it("sans stream : seul le stream à part reste", () => {
    expect(castClaimChoices(bracketMatch())).toEqual([{ kind: "SEPARATE" }]);
  });

  it("donne une clé stable par choix", () => {
    const keys = castClaimChoices(TWO_STREAMS).map(castClaimChoiceKey);
    expect(keys).toEqual(["join-3", "join-4", "separate"]);
  });
});

describe("castClaimBody — le corps envoyé à POST /api/matches/[id]/caster", () => {
  const input = { url: "", battletag: "", trigger: "AUTO" as const };

  it("rejoindre : le stream seul, aucun lien ni mode même saisis", () => {
    expect(
      castClaimBody({ kind: "JOIN", streamId: 4, liveUrl: null, casterPseudos: [] }, { ...input, url: "twitch.tv/x" }),
    ).toEqual({ streamId: 4, battletag: null });
  });

  it("le BattleTag du cast suit les deux choix, rogné ; vide = celui du compte", () => {
    expect(
      castClaimBody({ kind: "JOIN", streamId: 4, liveUrl: null, casterPseudos: [] }, { ...input, battletag: " Voix#2100 " }),
    ).toEqual({ streamId: 4, battletag: "Voix#2100" });
    expect(castClaimBody({ kind: "SEPARATE" }, { ...input, url: "twitch.tv/voix", battletag: "  " })).toMatchObject({
      battletag: null,
    });
  });

  it("à part : le lien rogné, le mode d'antenne, et l'origine du lien seulement si elle est dite", () => {
    expect(castClaimBody({ kind: "SEPARATE" }, { ...input, url: "  twitch.tv/voix " })).toEqual({
      liveUrl: "twitch.tv/voix",
      battletag: null,
      trigger: "AUTO",
    });
    expect(
      castClaimBody({ kind: "SEPARATE" }, { ...input, url: "twitch.tv/voix", trigger: "MANUAL" }),
    ).toEqual({ liveUrl: "twitch.tv/voix", battletag: null, trigger: "MANUAL" });
  });

  it("castClaimBody_lockedTrigger_omitsTrigger", () => {
    // Mode posé par un autre caster : le corps ne le porte pas, rien à refuser.
    expect(castClaimBody({ kind: "SEPARATE" }, { ...input, url: "twitch.tv/voix", trigger: undefined })).toEqual({
      liveUrl: "twitch.tv/voix",
      battletag: null,
    });
  });
});

/** La fenêtre telle que la voit un caster connecté (compte 4), mode d'antenne réglable. */
function renderAsCaster(match: typeof TWO_STREAMS) {
  effects.armed = true;
  return renderToStaticMarkup(
    <LiveProvider
      canManage={false}
      canSchedule={false}
      refereeScheduling={false}
      launchPhase
      openConfig={() => undefined}
      openSchedule={() => undefined}
      openReplay={() => undefined}
      viewerUserId={4}
      myTeamId={null}
      castBlock={null}
    >
      <CastClaimDialog match={match} matchLabel="Alpha contre Bravo" onClose={() => undefined} onClaim={async () => ({ ok: true })} />
    </LiveProvider>,
  );
}

it("CastClaimDialog_triggerPosedByAnotherCaster_showsItWithoutRadios", () => {
  const html = renderAsCaster(bracketMatch({ liveTrigger: "AUTO", liveTriggerCasterId: 9 }));
  // Le mode du caster 9 se lit sans se changer : seul le choix du stream reste en bouton radio.
  expect(html.match(/name="[^"]*" value="(AUTO|START_TIME|MANUAL)"/g)).toBeNull();
});

it("CastClaimDialog_scoreDeclared_noTriggerOffered", () => {
  // Le score saisi, le mode ne bouge plus (`isMatchCastable`) : il n'est ni offert ni envoyé.
  const html = renderAsCaster(bracketMatch({ status: "AWAITING_CONFIRMATION" }));
  expect(html).toContain("Ouvrir mon propre stream");
  expect(html).not.toContain('value="MANUAL"');
});

it("CastClaimDialog_matchToPlay_offersTrigger", () => {
  expect(renderAsCaster(bracketMatch({ status: "READY" }))).toContain('value="MANUAL"');
});

function renderDialog(locale: "fr" | "en", match: typeof TWO_STREAMS = TWO_STREAMS) {
  effects.armed = true;
  const dialog = (
    <CastClaimDialog
      match={match}
      matchLabel="Alpha contre Bravo"
      onClose={() => undefined}
      onClaim={async () => ({ ok: true })}
    />
  );
  if (locale === "fr") return renderToStaticMarkup(dialog);
  return renderToStaticMarkup(
    <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(messagesFor("en"))}>
      {dialog}
    </TournamentActionsTextProvider>,
  );
}

describe("CastClaimDialog — rendu", () => {
  it("un bouton radio par choix, le premier coché ; casters et plateforme nommés", () => {
    const html = renderDialog("fr");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    const first = /<input[^>]*value="join-3"[^>]*>/.exec(html)?.[0] ?? "";
    expect(first).toContain('checked=""');
    expect(/<input[^>]*value="separate"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(html).toContain("Co-caster avec Voix et Écho");
    expect(html).toContain("Twitch");
    expect(html).toContain("sans lien");
    expect(html).toContain("Ouvrir mon propre stream");
    expect(html).toContain("<legend");
  });

  it("le focus d'ouverture va à « Annuler », jamais à un bouton radio (un Entrée réflexe n'inscrit personne)", () => {
    const html = renderDialog("fr");
    expect(/<input[^>]*type="radio"[^>]*>/.exec(html)?.[0]).not.toContain("data-autofocus");
    expect(html).not.toContain("aria-describedby=\"\"");
    expect(/<button[^>]*data-autofocus="true"[^>]*>Annuler<\/button>/.test(html)).toBe(true);
  });

  it("joint trois casters par la conjonction de la langue : « A, B et C » / \"A, B, and C\"", () => {
    const three = bracketMatch({
      streams: [{ id: 3, liveUrl: null, staff: true }],
      casters: [
        matchCaster({ userId: 9, pseudo: "Voix", streamId: 3 }),
        matchCaster({ userId: 12, pseudo: "Écho", streamId: 3 }),
        matchCaster({ userId: 13, pseudo: "Solo", streamId: 3 }),
      ],
    });
    expect(renderDialog("fr", three)).toContain("Co-caster avec Voix, Écho et Solo");
    expect(renderDialog("en", three)).toContain("Co-cast with Voix, Écho, and Solo");
  });

  it("un caster seul se nomme sans conjonction", () => {
    const one = bracketMatch({
      streams: [{ id: 3, liveUrl: null, staff: true }],
      casters: [matchCaster({ userId: 9, pseudo: "Voix", streamId: 3 })],
    });
    expect(renderDialog("fr", one)).toContain("Co-caster avec Voix<");
  });

  it("un match sans stream ouvre la fenêtre avec le seul choix « ouvrir mon propre stream », son champ de lien et le mode d'antenne", () => {
    const html = renderAsCaster(bracketMatch());
    // Un seul choix de stream, et les trois modes de passage à l'antenne que
    // « ouvrir mon propre stream » règle du même geste (`CAST_SETTINGS.md`).
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).toContain("Ouvrir mon propre stream");
    expect(html).toContain('inputMode="url"');
    expect(html).toContain("Passage à l&#x27;antenne");
  });

  it("sans notifications, l'annonce du stream disparu est une zone vive montée, vide tant que le choix existe", () => {
    expect(renderDialog("fr")).toMatch(/<\/fieldset><output class="[^"]*gone[^"]*" aria-live="polite"><\/output>/);
  });

  it("CastClaimDialog_underToastProvider_noSecondLiveRegion", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <CastClaimDialog
          match={TWO_STREAMS}
          matchLabel="Alpha contre Bravo"
          onClose={() => undefined}
          onClaim={async () => ({ ok: true })}
        />
      </ToastProvider>,
    );

    // Une seule voix : le toast ; la zone du texte persistant se tait.
    expect(html).not.toMatch(/<output[^>]*aria-live="polite"/);
  });

  it("le champ du lien n'apparaît qu'en choisissant son propre stream", () => {
    expect(renderDialog("fr")).not.toContain('inputmode="url"');
  });

  it("parle anglais sous /en", () => {
    const html = renderDialog("en");
    expect(html).toContain("Co-cast with Voix and Écho");
    expect(html).toContain("Open my own stream");
    expect(html).toContain("no link");
    expect(html).not.toContain("Ouvrir mon propre stream");
  });
});

describe("matchStreamLinks — tous les liens du bandeau, le premier en tête", () => {
  it("garde l'ordre des streams, saute ceux sans lien et ne double jamais le premier", () => {
    const match = bracketMatch({
      liveUrl: "https://twitch.tv/match",
      streams: [
        { id: 3, liveUrl: "https://twitch.tv/match", staff: true },
        { id: 4, liveUrl: null, staff: false },
        { id: 5, liveUrl: "https://kick.com/voix", staff: false },
      ],
    });
    expect(matchStreamLinks(match)).toEqual(["https://twitch.tv/match", "https://kick.com/voix"]);
  });

  it("lecture partielle (sans streams) : le premier lien seul ; sans lien, rien", () => {
    expect(matchStreamLinks(bracketMatch({ liveUrl: "https://twitch.tv/x" }))).toEqual(["https://twitch.tv/x"]);
    expect(matchStreamLinks(bracketMatch())).toEqual([]);
  });
});

/** Chaque extrait attendu figure dans la source. */
function expectContains(source: string, snippets: readonly string[]): void {
  for (const snippet of snippets) expect(source).toContain(snippet);
}

describe("CastClaimDialog — un stream choisi qui disparaît", () => {
  const source = readSource("app/(secured)/tournois/[id]/_components/CastClaimDialog.tsx");

  it("n'est pas remplacé en silence par le premier : plus rien n'est choisi, l'envoi est désarmé", () => {
    expectContains(source, [
      "choices.find((option) => castClaimChoiceKey(option) === choiceKey) ?? null;",
      "disabled={choice === null || urlMissing || urlRefused || battletagRefused || triggerRefused}",
      "if (choice === null) return false;",
    ]);
  });

  it("le focus passe au premier choix restant quand celui qui l'avait est démonté, et une annonce dit pourquoi", () => {
    expectContains(source, [
      "if (!gone || document.activeElement !== document.body) return;",
      'fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();',
      '{gone ? goneMessage : ""}',
    ]);
  });

  it("le stream disparu se notifie aussi par un toast, sans exiger le ToastProvider", () => {
    expectContains(source, [
      'import { useOptionalToast } from "@/components/ui/toast";',
      "if (gone) notifyGone.current.toast?.showError(notifyGone.current.goneMessage);",
    ]);
    expect(source).not.toContain("= useToast(");
    // Sans fournisseur de toasts, la fenêtre se rend quand même (renderDialog n'en monte aucun).
    expect(renderDialog("fr")).toContain("Alpha contre Bravo");
  });

  it("oublie le choix disparu : un stream qui revient ne se recoche pas sans nouveau choix", () => {
    expect(source).toContain('if (choice === null && choiceKey !== "") setChoiceKey("");');
  });

  it("ouvre sans focusContent ni radio focalisée : « Annuler » prend le focus", () => {
    expect(source).not.toContain("focusContent");
    expect(source).not.toContain("data-autofocus");
  });

  it("joint les casters par Intl.ListFormat dans la langue de la page", () => {
    expect(source).toContain('useMemo(() => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }), [locale])');
    expect(source).not.toContain('casterPseudos.join(", ")');
  });
});

describe("MatchCardActions — branchements du cast", () => {
  const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");

  it("« Caster » ouvre toujours la fenêtre (une seule règle, castClaimChoices, décide des choix)", () => {
    expect(card).not.toContain("match.streams.length === 0");
    expect(card).not.toContain('send(`/api/matches/${match.id}/caster`, "POST", {})');
    expect(card).toMatch(/claimCast: \(\) => \{[\s\S]*?setClaimOpen\(true\);/);
    expect(card).toContain("<CastClaimDialog match={match}");
  });

  it("inscrit, le focus passe au bouton qui remplace « Caster » (« Ne plus caster », sinon « Plus d'actions »)", () => {
    expectContains(card, [
      "claimedRef.current = true;",
      "if (!claimedRef.current || hasClaimCast) return;",
      'querySelector<HTMLElement>(\'[data-action="releaseCast"]\')',
      "(release ?? toggleRef.current)?.focus({ preventScroll: true });",
    ]);
  });

  it("le staff choisit le caster retiré, désigné par ?userId= ; le caster se retire depuis sa fenêtre", () => {
    expectContains(card, [
      "/api/matches/${match.id}/caster?userId=${encodeURIComponent(",
      "{match.casters.length > 1 && (",
    ]);
    // La carte ne porte plus le retrait du lecteur lui-même : « Ne plus
    // caster » vit dans « Configurer ma diffusion » (`CAST_SETTINGS.md`).
    expect(card).toContain("releaseCast: () => openRelease(),");
    const settings = readSource("app/(secured)/tournois/[id]/_components/CastSettingsDialog.tsx");
    expect(settings).toContain('fetch(`/api/matches/${match.id}/caster`, { method: "DELETE" })');
  });

  it("CastDialogs_organisationBox_neverOfferedToCaster", () => {
    // Décision D7 du 2026-11-09 : la case quitte les fenêtres du caster (la configuration du direct la garde).
    for (const file of ["CastSettingsDialog.tsx", "CastClaimDialog.tsx", "CastSettingsFields.tsx"]) {
      const source = readSource(`app/(secured)/tournois/[id]/_components/${file}`);
      expect(source).not.toContain("organisationLink");
      expect(source).not.toContain("CastOrganisationLinkField");
    }
  });

  it("le caster à retirer est fixé à l'ouverture ; parti entre-temps, la fenêtre se ferme au lieu d'en viser un autre", () => {
    expectContains(card, [
      "setReleaseTarget(casters[0]?.userId ?? null);",
      "const releasedCaster = casters.find((caster) => caster.userId === releaseTarget) ?? null;",
      "if (open && releasedCaster === null) setOpen(false);",
      "const shown = open && releasedCaster !== null;",
      "confirmRelease: shown,",
    ]);
    expect(card).not.toContain("?? match.casters[0] ?? null");
  });

  it("le caster choisi qui part pendant le choix : une notice neutre le dit, sauf pour le retrait que le lecteur vient de confirmer", () => {
    expectContains(card, [
      "wasShown.current && !shown && releasedCaster === null && !ownRelease.current",
      '() => showInfo(t("cardActions.releaseConfirm.gone"))',
      "markOwnRelease(true);",
    ]);
    // Un retrait refusé laisse la fenêtre ouverte : le départ suivant doit se dire.
    expectContains(card, [
      "if (!done) markOwnRelease(false);",
      "ownRelease.current = false;",
    ]);
  });

  it("un arbitre qui se choisit lui-même : textes « Ne plus caster », sans avis, comme un départ volontaire", () => {
    expectContains(card, [
      "const releasingSelf = releasedCaster.userId === viewerUserId;",
      't("cardActions.releaseConfirm.selfTitle", { match: matchLabel })',
      't("cardActions.releaseConfirm.selfConfirm")',
      't("cardActions.releaseConfirm.selfBody")',
      'self ? t("cardActions.notCasting") : t("cardActions.casterRemoved")',
    ]);
  });

  it("un seul caster : le corps de l'avis le nomme", () => {
    expect(card).toContain('t("cardActions.releaseConfirm.body", { caster: releasedCaster.pseudo })');
  });

  it("les choix restent figés pendant l'envoi, sans disabled natif (le focus ne se perd pas)", () => {
    expectContains(card, [
      "aria-disabled={busy || undefined}",
      "if (!busy) onPick(caster.userId);",
    ]);
    expect(card).not.toMatch(/<fieldset[^>]*disabled/);
  });

  it("le choix du caster à retirer garde le focus sur « Annuler » : un Entrée réflexe sur un bouton radio ne retire personne", () => {
    const start = card.indexOf("function ReleaseCastDialog(");
    const dialog = card.slice(start, card.indexOf("</ConfirmActionDialog>", start));
    expect(dialog).toContain('name={`release-caster-${match.id}`}');
    expect(dialog).not.toContain("focusContent");
    expect(dialog).not.toContain("data-autofocus");
  });
});

describe("Configuration du direct — l'aide du lien", () => {
  it("dit qu'un champ vide laisse le premier lien d'un caster à l'annonce (FR et EN)", () => {
    expect(frDialogs.live.urlHint).toContain("Vide, l'annonce Discord renvoie au premier lien ouvert par un caster");
    expect(enDialogs.live.urlHint).toContain("Left empty, the Discord announcement points to the first link opened by a caster");
  });

  it("ne déduit plus la provenance du lien de ce que le poseur caste : la case « lien de l'organisation » la dit (FR et EN)", () => {
    expect(frDialogs.live.urlHint).not.toContain("Si tu castes déjà ce match");
    expect(enDialogs.live.urlHint).not.toContain("If you already cast this match");
    expect(frDialogs.live.organisationLink).toBe("Ce lien est celui de l'organisation");
    expect(enDialogs.live.organisationLink).toBe("This link is the organisation's");
    expect(frDialogs.live.organisationLinkHint).toContain("Décoché, c'est ta propre chaîne");
    expect(enDialogs.live.organisationLinkHint).toContain("Unticked, it is your own channel");
    expect(frDialogs.live.urlOwnChannel).toContain("retiré du match si ton compte est supprimé");
    expect(enDialogs.live.urlOwnChannel).toContain("removed from the match if your account is deleted");
  });
});

describe("Textes de caster — pluriel, parité FR/EN, clé retirée", () => {
  const read = (locale: string, file: string) =>
    JSON.parse(readSource(`messages/${locale}/${file}.json`)) as Record<string, any>;

  it("l'aide du lien dit qu'il est obligatoire, et où il paraît (FR et EN)", () => {
    expect(frActions.cardActions.castSettings.urlHint).toContain("Obligatoire");
    expect(enActions.cardActions.castSettings.urlHint).toContain("Required");
    expect(frActions.cardActions.claimDialog.gone).toBe("Ce stream n'existe plus : choisis-en un autre.");
    expect(enActions.cardActions.claimDialog.gone).toBe("This stream no longer exists: pick another one.");
  });

  it("le retrait par le staff a ses variantes « Ne plus caster » et nomme le caster, en FR et EN", () => {
    const fr = frActions.cardActions.releaseConfirm as Record<string, string>;
    const en = enActions.cardActions.releaseConfirm as Record<string, string>;
    expect(fr.body).toContain("{caster}");
    expect(en.body).toContain("{caster}");
    expect(fr.selfConfirm).toBe("Ne plus caster");
    expect(en.selfConfirm).toBe("Stop casting");
    expect(fr.selfTitle).toContain("{match}");
    expect(en.selfTitle).toContain("{match}");
    expect(fr.gone).toBe("Ce caster ne caste plus ce match.");
    expect(en.gone).toBe("This caster is no longer casting this match.");
  });

  it("les annonces des contacts parlent des casters au pluriel", () => {
    expect(read("fr", "launchModal").contacts.casterShown).toBe("Les contacts des casters sont maintenant affichés.");
    expect(read("fr", "launchModal").contacts.casterShownEmpty).toBe("Aucun contact de caster disponible.");
    expect(read("en", "launchModal").contacts.casterShown).toBe("The casters' contacts are now shown.");
  });

  it("la région d'un caster passe par une clé à paramètre, pas par une concaténation", () => {
    expect(read("fr", "launchModal").casterRegion).toBe("Caster {pseudo}");
    expect(read("en", "launchModal").casterRegion).toBe("Caster {pseudo}");
    const cards = readSource("components/match-launch/LaunchContactCards.tsx");
    expect(cards).toContain('t("casterRegion", { pseudo: caster.pseudo })');
    expect(cards).not.toContain('`${t("caster")} ${caster.pseudo}`');
  });

  it("la clé launch.caster, plus lue, est retirée des deux catalogues", () => {
    expect(read("fr", "tournament").launch).not.toHaveProperty("caster");
    expect(read("en", "tournament").launch).not.toHaveProperty("caster");
  });

  it("la phase de lancement attend chacun des casters inscrits (FR et EN)", () => {
    const text = (locale: string) => JSON.stringify(read(locale, "tournamentForm"));
    expect(text("fr")).toContain("(et chacun de ses casters) cliquent");
    expect(text("en")).toContain("(and each of its casters) to click");
  });
});

describe("Fenêtre « Caster » — l'aide du lien du caster", () => {
  it("dit où le lien paraît, et qu'il part avec le compte (FR et EN)", () => {
    expect(frActions.cardActions.castSettings.urlHint).toContain("ni sur le match ni dans l'annonce du direct");
    expect(frActions.cardActions.castSettings.urlHint).toContain("retiré du match si ton compte est supprimé");
    expect(enActions.cardActions.castSettings.urlHint).toContain("neither on the match nor in the live announcement");
    expect(enActions.cardActions.castSettings.urlHint).toContain("removed from the match if your account is deleted");
  });

  it("le BattleTag du cast dit qu'il remplace celui du profil et que personne ne le vérifie (FR et EN)", () => {
    expect(frActions.cardActions.castSettings.battletagHint).toContain("il remplace celui de ton profil");
    expect(frActions.cardActions.castSettings.battletagHint).toContain("personne ne le vérifie");
    expect(enActions.cardActions.castSettings.battletagHint).toContain("it replaces your profile's");
    expect(enActions.cardActions.castSettings.battletagHint).toContain("nobody checks it");
  });
});

describe("lockedTrigger — un mode verrouillé montre celui du match", () => {
  it("lockedTrigger_lockedWithMatchTrigger_returnsMatchTrigger", () => {
    expect(lockedTrigger(true, "AUTO", "MANUAL")).toBe("AUTO");
  });

  it("lockedTrigger_notLocked_returnsPicked", () => {
    expect(lockedTrigger(false, "AUTO", "MANUAL")).toBe("MANUAL");
  });

  it("lockedTrigger_lockedMatchUncast_returnsPicked", () => {
    expect(lockedTrigger(true, null, "MANUAL")).toBe("MANUAL");
  });
});

describe("casterLinkEdits — seules les saisies de l'arbitre partent", () => {
  const casterStream = { id: 4, liveUrl: "https://kick.com/b" };

  it("casterLinkEdits_untouchedStreamArrivedLater_notSent", () => {
    expect(casterLinkEdits([casterStream], {})).toBeUndefined();
  });

  it("casterLinkEdits_typedNewLink_sentTrimmed", () => {
    expect(casterLinkEdits([casterStream], { 4: "  twitch.tv/x " })).toEqual([{ streamId: 4, liveUrl: "twitch.tv/x" }]);
  });

  it("casterLinkEdits_typedEmpty_clearsLink", () => {
    expect(casterLinkEdits([casterStream], { 4: "  " })).toEqual([{ streamId: 4, liveUrl: null }]);
  });

  it("casterLinkEdits_typedSameAsCurrent_undefined", () => {
    expect(casterLinkEdits([casterStream], { 4: "https://kick.com/b" })).toBeUndefined();
  });

  it("casterLinkEdits_typedStreamGone_notSent", () => {
    expect(casterLinkEdits([], { 4: "twitch.tv/x" })).toBeUndefined();
  });
});

describe("casterStreamsOf — les streams des casters, leurs voix en liste", () => {
  const list = new Intl.ListFormat("fr", { type: "conjunction" });

  it("casterStreamsOf_staffAndCasterStreams_keepsCasterStreamsWithTheirCasters", () => {
    const match = bracketMatch({
      streams: [
        { id: 1, liveUrl: "https://twitch.tv/orga", staff: true },
        { id: 4, liveUrl: null, staff: false },
      ],
      casters: [matchCaster({ userId: 12, pseudo: "Voix", streamId: 4 }), matchCaster({ userId: 13, pseudo: "Écho", streamId: 4 })],
    });

    expect(casterStreamsOf(match, list)).toEqual([{ id: 4, liveUrl: null, casters: "Voix et Écho" }]);
  });
});

describe("refusedCasterField — le refus rattaché au lien du stream désigné", () => {
  it("refusedCasterField_integerStreamId_returnsCasterField", () => {
    expect(refusedCasterField({ streamId: 4 })).toBe("caster-4");
  });

  it("refusedCasterField_missingStreamId_returnsNull", () => {
    expect(refusedCasterField({})).toBeNull();
  });

  it("refusedCasterField_nonIntegerStreamId_returnsNull", () => {
    expect(refusedCasterField({ streamId: "4" })).toBeNull();
  });
});

describe("Fenêtre de diffusion — mode changé pendant qu'elle est ouverte", () => {
  it("MatchLiveDialog_triggerChangedWhileOpen_resetsLinkAndOrganisation", () => {
    // Un mode retiré a effacé le lien du staff : la fenêtre ne le repose pas.
    const dialog = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    const reset = dialog.slice(dialog.indexOf("if (seenTrigger !== match.liveTrigger)"));
    expect(reset.slice(0, reset.indexOf("}"))).toContain("resetLiveUrl();");
    expect(reset.slice(0, reset.indexOf("}"))).toContain("setOrganisationLink(false);");
  });

  it("MatchLiveDialog_triggerChangedWhileOpen_clearsCasterLinksAndFieldErrors", () => {
    // Les saisies des liens des casters et leurs refus visaient l'état d'avant.
    const dialog = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    const reset = dialog.slice(dialog.indexOf("if (seenTrigger !== match.liveTrigger)"));
    const block = reset.slice(0, reset.indexOf("\n  }"));
    expect(block).toContain("setCasterLinks({});");
    expect(block).toContain("fieldErrors.clear();");
  });
});

describe("Fenêtre de diffusion — lien du staff sur le mode d'un autre caster", () => {
  it("MatchLiveDialog_linkOwnedByOtherCaster_readOnlyWithHintAndNoOrganisationBox", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(dialog).toContain("const linkLocked = staffLinkLocked(triggerLocked, match) || !staffSide;");
    expect(dialog).toContain("readOnly={linkLocked}");
    expect(dialog).toContain('return linkLocked ? <p>{t("live.urlLocked")}</p> : null;');
    expect(dialog).toContain("{canSpeakForOrganisation && urlTouched && !linkLocked && (");
  });

  it("urlLocked_frAndEn_present", () => {
    expect(frDialogs.live.urlLocked).toContain("seuls lui, l'arbitre du match ou un admin le changent");
    expect(enDialogs.live.urlLocked).toContain("only they, the match referee or an admin can change it");
  });
});

describe("Fenêtre de diffusion — le stream d'un caster disparu", () => {
  it("casterStreamGone_frAndEn_present", () => {
    expect(frDialogs.live.casterStreamGone).toContain("rouvre la fenêtre");
    expect(enDialogs.live.casterStreamGone).toContain("reopen the window");
    const dialog = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(dialog).toContain('if (code === "STREAM_NOT_FOUND") return "live.casterStreamGone";');
  });
});

describe("Inscription — un mode posé entre-temps par un autre", () => {
  it("claim_triggerSkipped_saysTheModeStayed", () => {
    const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(card).toContain('payload.triggerSkipped === true ? "cardActions.castingTriggerKept" : "cardActions.casting"');
    expect(frActions.cardActions.castingTriggerKept).toContain("n'a pas changé");
    expect(enActions.cardActions.castingTriggerKept).toContain("stayed as it was");
  });
});

describe("Mode d'antenne verrouillé — qui peut le changer", () => {
  it("triggerLockedHint_ownerlessMode_namesOrganisers", () => {
    expect(frActions.cardActions.castSettings.triggerLockedHint).toContain("l'organisation aussi quand aucun caster ne le tient");
    expect(enActions.cardActions.castSettings.triggerLockedHint).toContain("the organisers too when no caster holds it");
    // La fenêtre de diffusion lit le mode verrouillé avec les mêmes mots (`CastTriggerField`).
    expect(frDialogs.live).not.toHaveProperty("triggerLockedHint");
    expect(enDialogs.live).not.toHaveProperty("triggerLockedHint");
    expect(frErrors.codes.LIVE_TRIGGER_NOT_OWNED).toContain("l'organisation aussi quand aucun caster ne le tient");
    expect(enErrors.codes.LIVE_TRIGGER_NOT_OWNED).toContain("the organisers too when no caster holds it");
  });
});

describe("changedTriggerNeedsDate — seul un mode changé redemande sa date", () => {
  it("changedTriggerNeedsDate_unchangedStartTimeWithoutDate_false", () => {
    expect(changedTriggerNeedsDate("START_TIME", "START_TIME", true)).toBe(false);
  });

  it("changedTriggerNeedsDate_switchToStartTimeWithoutDate_true", () => {
    expect(changedTriggerNeedsDate("MANUAL", "START_TIME", true)).toBe(true);
  });

  it("changedTriggerNeedsDate_switchToStartTimeWithDate_false", () => {
    expect(changedTriggerNeedsDate("MANUAL", "START_TIME", false)).toBe(false);
  });

  it("changedTriggerNeedsDate_switchToManualWithoutDate_false", () => {
    expect(changedTriggerNeedsDate(null, "MANUAL", true)).toBe(false);
  });
});

describe("lockedOnClosedMatch — rien à enregistrer sur un match fermé au mode verrouillé", () => {
  it("lockedOnClosedMatch_lockedModeScoreDeclared_true", () => {
    expect(lockedOnClosedMatch(true, bracketMatch({ status: "AWAITING_CONFIRMATION", liveTrigger: "MANUAL" }))).toBe(true);
  });

  it("lockedOnClosedMatch_lockedModeMatchToPlay_false", () => {
    expect(lockedOnClosedMatch(true, bracketMatch({ status: "READY", liveTrigger: "MANUAL" }))).toBe(false);
  });

  it("lockedOnClosedMatch_notLockedScoreDeclared_false", () => {
    expect(lockedOnClosedMatch(false, bracketMatch({ status: "COMPLETED", liveTrigger: "MANUAL" }))).toBe(false);
  });
});
