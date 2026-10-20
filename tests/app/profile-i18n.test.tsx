/**
 * Lot 9-2 — `/profil`, `/signalements/[id]`, formulaire « Signaler un
 * problème », modale de recadrage, réglage des notifications : le français
 * reste celui d'avant (sources partagées, phrase par phrase), l'anglais se rend
 * sans français.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement, ReactNode } from "react";

let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
// Lecteur connecté : sans session, les mises en page ne sérialisent pas l'anglais (`isDocumentLoad`).
jest.mock("@/lib/server/auth", () => ({ ...jest.requireActual<object>("@/lib/server/auth"), getCurrentUser: async () => ({ id: 1 }) }));
// Chargement complet par défaut ; `"0"` : requête de navigation ou de `router.refresh()` (middleware).
// Chargement complet par défaut ; un `router.refresh()` vient du routeur, depuis `/en/profil`.
let mockRefresh = false;
jest.mock("next/headers", () => ({
  headers: async () =>
    new Headers(mockRefresh ? { "x-bg-document": "0", host: "bluegenji.test", referer: "https://bluegenji.test/en/profil" } : { "x-bg-document": "1" }),
}));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/profil",
  useParams: () => ({ id: "9" }),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
// Les fenêtres se montent après l'hydratation (`setMounted(true)` dans un
// effet) : l'effet de montage est joué une fois par rendu armé.
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed || !String(effect).includes("setMounted(true)")) return;
      effects.armed = false;
      effect();
    },
  };
});
type PushState = ReturnType<typeof import("@/components/notifications/usePushNotifications").usePushNotifications>;
let mockPush: Partial<PushState> = {};
jest.mock("@/components/notifications/usePushNotifications", () => ({ usePushNotifications: () => mockPush }));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import ProfileLayout, { generateMetadata as profileMetadata } from "@/app/(secured)/profil/layout";
import { generateMetadata as reportMetadata } from "@/app/(secured)/signalements/[id]/layout";
import ProfilePage from "@/app/(secured)/profil/page";
import { ProfileSection } from "@/app/(secured)/profil/_components/ProfileSection";
import { AccountLocaleField } from "@/app/(secured)/profil/_components/AccountLocaleField";
import { MatchDmField } from "@/app/(secured)/profil/_components/MatchDmField";
import { RecruitmentModalField } from "@/app/(secured)/profil/_components/RecruitmentModalField";
import { ConnectedAppsSection } from "@/app/(secured)/profil/ConnectedAppsSection";
import { OtherSessionsPanel } from "@/app/(secured)/profil/OtherSessionsPanel";
import { BattletagVisibilityNotice } from "@/app/(secured)/profil/BattletagVisibilityNotice";
import { DiscordVerificationDialog } from "@/app/(secured)/profil/DiscordVerificationDialog";
import { DiscordBotHandleDialog } from "@/app/(secured)/profil/DiscordBotHandleDialog";
import { ConcernedReport } from "@/app/(secured)/signalements/[id]/_components/ConcernedReport";
import { PROFILE_SECTIONS, type ProfileSectionId } from "@/app/(secured)/profil/_lib/profile-sections";
import {
  battletagLockText,
  connectionMethodText,
  connectionRefusalText,
  deletionConsequencesText,
  deletionErrorText,
  deletionOutcomeText,
  discordBotRowText,
  discordTagLockText,
  FR_PROFILE,
} from "@/app/(secured)/profil/_lib/profile-text";
import { avatarUploadErrorMessage, profileErrorMessage } from "@/app/(secured)/profil/profile-errors";
import { connectionErrorMessage, connectionSuccessMessage, otherSessionsSummary, sessionsRevokedMessage, unlinkSuccessMessage } from "@/app/(secured)/profil/connection-errors";
import { discordVerificationErrorMessage } from "@/app/(secured)/profil/discord-errors";
import { ReportProblemDialog } from "@/components/reports/ReportProblemDialog";
import { TargetThumb } from "@/components/reports/TargetPicker";
import {
  FR_REPORTS_TEXT,
  legalBasisText,
  reportErrorText,
  retentionText,
  rightsText,
  targetDetailText,
} from "@/components/reports/reports-text";
import { PushNotificationsPanel } from "@/components/notifications/PushNotificationsPanel";
import { FR_PUSH_TEXT, pushErrorText, pushSupportNotice, pushTopicDescription, pushTopicLabel } from "@/components/notifications/push-text";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import { ReportsTextProvider } from "@/components/reports/reports-text-provider";
import { LogoutButton } from "@/components/logout-button";
import { ImageCropDialog } from "@/components/ui/image-crop-dialog-view";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { ProfileTextProvider } from "@/components/i18n/profile-text";
import { TeamErrorsTextProvider } from "@/components/i18n/team-errors-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import {
  ACCOUNT_DELETION_QUESTION,
  accountDeletionConsequences,
  accountDeletionErrorMessage,
  accountDeletionOutcome,
  RETENTION_UNKNOWN,
} from "@/lib/shared/account-deletion";
import {
  connectionMethodLabel,
  connectionUnlinkRefusalMessage,
  DISCORD_BOT_CONNECTION_LABEL,
  discordBotRowState,
  type AccountConnection,
} from "@/lib/shared/account-connections";
import { battletagLockNotice } from "@/lib/shared/battletag-lock";
import {
  NOTIFIER_FOLLOW_UP,
  REPORT_CATEGORIES,
  REPORT_PRIVACY_NOTICE,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_LABELS,
  RIGHTS_RELATION_LABELS,
  reportErrorMessage,
  reportLegalBasisNotice,
  reportRightsNotice,
  type ConcernedReportView,
  type ReportCategory,
} from "@/lib/shared/content-reports";
import { REPORT_CATEGORY_DEFINITIONS, OFF_SITE_CONDUCT_ENTRY, OFF_SITE_CONDUCT_NOTICE } from "@/lib/shared/content-report-categories";
import { DISCORD_VERIFICATION_EXPOSURE, DISCORD_VERIFICATION_PURPOSE } from "@/lib/shared/discord-identity";
import { discordTagLockNotice } from "@/lib/shared/discord-tag-lock";
import {
  BLIZZARD_BATTLETAG_NOTICE,
  DISCORD_PLAYER_VISIBILITY_NO_TAG,
  DISCORD_PLAYER_VISIBILITY_NOTICE,
  DISCORD_PLAYER_VISIBILITY_PENDING,
  DISCORD_TAG_AUDIENCE,
  DISCORD_TAG_UNVERIFIED_AUDIENCE,
  GAME_TAG_NOTICE,
} from "@/lib/shared/identity-sharing";
import { isMigratedRoute, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { formatMessage } from "@/lib/shared/message-format";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/lib/shared/oauth-providers";
import { PUSH_ERROR_MESSAGES, PUSH_SUPPORT_NOTICES, PUSH_TOPIC_KEYS, PUSH_TOPICS, pushErrorMessage } from "@/lib/shared/push-notifications";
import { scopedText } from "@/lib/shared/scoped-text";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";

const EN = messagesFor("en");
const EN_PROFILE = scopedText("en", EN.profile);

function inEnglish(ui: ReactElement): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <ShellTextProvider locale="en" messages={EN.shell}>
        <TeamErrorsTextProvider locale="en" messages={EN.teamErrors}>
          <ProfileTextProvider locale="en" messages={EN.profile}>
            <ReportsTextProvider locale="en" messages={EN.reports}>
              <PushTextProvider locale="en" messages={EN.push}>
                {ui}
              </PushTextProvider>
            </ReportsTextProvider>
          </ProfileTextProvider>
        </TeamErrorsTextProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

/** Le texte visible et les attributs lus (noms accessibles, infobulles, champs). */
function readable(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|placeholder|alt|aria-roledescription)="([^"]*)"/g)].map((m) => m[1]);
  return `${html.replace(/<[^>]+>/g, " ")} ${attributes.join(" ")}`;
}

const FRENCH_WORDS =
  /\b(Profil|profil|Pseudo|Réessayer|Retirer|Rattacher|Rattaché|Annuler|Valider|Certifier|Recevoir|Signaler|Signalement|signalement|Envoyer|Chargement|Choisir|Fermer|Connecte-toi|Données|Destinataires|Finalité|Durée|Base légale|Déconnexion|Activer|Désactiver|Aperçu|Réduire|Agrandir|Réinitialiser|Masqué|compris|Motif|Reçu|État|Ajouter|Contester|toi|ton|ta|tes)\b/;
const ACCENTED = /[À-ÖØ-öø-ÿ]/;

function expectEnglish(html: string): void {
  const text = readable(html);
  expect(text).not.toMatch(FRENCH_WORDS);
  expect(text).not.toMatch(ACCENTED);
}

const connection = (provider: OAuthProvider, overrides: Partial<AccountConnection> = {}): AccountConnection => ({
  provider,
  linked: false,
  method: null,
  handle: null,
  ...overrides,
});

const CONNECTION_SETS: AccountConnection[][] = [
  OAUTH_PROVIDERS.map((p) => connection(p)),
  [connection("GOOGLE", { linked: true }), connection("DISCORD", { linked: true, method: "DM_CODE", handle: "nova" }), connection("BLIZZARD")],
  [connection("GOOGLE"), connection("DISCORD", { linked: true, method: "DM_CODE" }), connection("BLIZZARD")],
  [connection("GOOGLE", { linked: true }), connection("DISCORD", { linked: true, method: "OAUTH", handle: "nova" }), connection("BLIZZARD", { linked: true, handle: "Nova#1234" })],
  [connection("GOOGLE"), connection("DISCORD", { linked: true, method: null }), connection("BLIZZARD")],
];

// Les fenêtres se portent dans `document.body` : le portail est remplacé par
// son contenu, il ne faut qu'un `document` à désigner.
const globals = globalThis as { document?: unknown };
const hadDocument = "document" in globals;
beforeAll(() => {
  if (!hadDocument) globals.document = { body: {}, getElementById: () => null };
});
afterAll(() => {
  if (!hadDocument) delete globals.document;
});

beforeEach(() => {
  mockLocale = "en";
  effects.armed = false;
  mockPush = {};
});

describe("liste blanche et métadonnées", () => {
  it("ouvre /profil et la page d'un signalement", () => {
    expect(isMigratedRoute("/profil")).toBe(true);
    expect(isMigratedRoute("/signalements/12")).toBe(true);
    expect(isMigratedRoute("/signalements/abc")).toBe(false);
  });

  it("titres et canonique dans la langue de l'adresse", async () => {
    const en = await profileMetadata();
    expect(en.title).toEqual(expect.objectContaining({ default: "My profile" }));
    expect(en.alternates).toEqual({ canonical: "/en/profil", languages: { fr: "/profil", en: "/en/profil", "x-default": "/profil" } });
    const report = await reportsMetadata("12");
    expect(report.title).toEqual(expect.objectContaining({ default: "Report" }));
    expect(report.alternates).toEqual({
      canonical: "/en/signalements/12",
      languages: { fr: "/signalements/12", en: "/en/signalements/12", "x-default": "/signalements/12" },
    });
    // Identifiant invalide : le titre seul, aucune adresse inventée.
    expect((await reportsMetadata("abc")).alternates).toBeUndefined();
    mockLocale = "fr";
    expect((await profileMetadata()).title).toEqual(expect.objectContaining({ default: "Mon profil" }));
    expect((await reportsMetadata("12")).title).toEqual(expect.objectContaining({ default: "Signalement" }));
    expect((await reportsMetadata("12")).alternates).toEqual(expect.objectContaining({ canonical: "/signalements/12" }));
  });

  it("la mise en page ne sérialise l'anglais que sous /en, au chargement complet seulement", async () => {
    type Props = { messages?: { profile: unknown; teamErrors: unknown; push: unknown } };
    mockLocale = "fr";
    const fr = (await ProfileLayout({ children: null })) as ReactElement<Props>;
    expect(fr.props.messages).toBeUndefined();
    mockLocale = "en";
    const en = (await ProfileLayout({ children: null })) as ReactElement<Props>;
    expect(en.props.messages).toEqual({ profile: EN.profile, teamErrors: EN.teamErrors, push: EN.push });
    // `router.refresh()` ou navigation : aucun dictionnaire renvoyé, le client garde le sien.
    mockRefresh = true;
    try {
      const refreshed = (await ProfileLayout({ children: null })) as ReactElement<Props>;
      expect(refreshed.props.messages).toBeUndefined();
    } finally {
      mockRefresh = false;
    }
  });
});

describe("français inchangé — profil", () => {
  it("sections : le registre et les messages disent la même chose", () => {
    for (const section of PROFILE_SECTIONS) {
      const id = section.id as ProfileSectionId;
      expect(FR_PROFILE.t(`sections.${id}.title`)).toBe(section.title);
      expect(FR_PROFILE.t(`sections.${id}.lead`)).toBe(section.lead);
    }
  });

  it("annonces partagées avec /connexion", () => {
    expect(FR_PROFILE.t("games.gameTagNotice")).toBe(GAME_TAG_NOTICE);
    expect(FR_PROFILE.t("games.blizzardNotice")).toBe(BLIZZARD_BATTLETAG_NOTICE);
    expect(FR_PROFILE.t("discord.audience")).toBe(DISCORD_TAG_AUDIENCE);
    expect(FR_PROFILE.t("discord.unverifiedAudience")).toBe(DISCORD_TAG_UNVERIFIED_AUDIENCE);
    expect(FR_PROFILE.t("privacy.discordNotice")).toBe(DISCORD_PLAYER_VISIBILITY_NOTICE);
    expect(FR_PROFILE.t("privacy.discordPending")).toBe(DISCORD_PLAYER_VISIBILITY_PENDING);
    expect(FR_PROFILE.t("privacy.discordNoTag")).toBe(DISCORD_PLAYER_VISIBILITY_NO_TAG);
    expect(FR_PROFILE.t("verify.purpose")).toBe(DISCORD_VERIFICATION_PURPOSE);
    expect(Object.values(messagesFor("fr").profile.verify.exposure)).toEqual([...DISCORD_VERIFICATION_EXPOSURE]);
  });

  it("verrous des champs : cas par cas", () => {
    for (const linked of [true, false, null]) {
      for (const pending of [true, false]) {
        for (const tag of ["nova", null]) {
          for (const verified of [true, false]) {
            const state = { tag, verified, linked, pending };
            expect(discordTagLockText(FR_PROFILE, state)).toBe(discordTagLockNotice(state));
          }
          expect(battletagLockText(FR_PROFILE, { tag, linked, pending })).toBe(battletagLockNotice({ tag, linked, pending }));
        }
      }
    }
  });

  it("suppression du compte : chaque issue", () => {
    expect(FR_PROFILE.t("deletion.question")).toBe(ACCOUNT_DELETION_QUESTION);
    for (const subject of ["TOURNAMENTS", "SOLO_REGISTRATIONS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS", null, RETENTION_UNKNOWN] as const) {
      expect(deletionConsequencesText(FR_PROFILE, subject)).toBe(accountDeletionConsequences(subject));
      expect(deletionOutcomeText(FR_PROFILE, subject)).toBe(accountDeletionOutcome(subject));
    }
    // A solo player's #live announcements outlive the account (until deleted on request): every outcome says so.
    for (const subject of ["TOURNAMENTS", "SOLO_REGISTRATIONS", null] as const) {
      expect(accountDeletionConsequences(subject)).toMatch(/salon #live du Discord \(et l'alerte de modération d'une annonce bloquée ou signalée par AutoMod\), qui gardent ton pseudo jusqu'à leur suppression sur demande/);
      expect(deletionConsequencesText(EN_PROFILE, subject)).toMatch(/Discord #live channel \(and the moderation alert for an announcement blocked or flagged by AutoMod\), which keep your username until they are deleted on request/);
    }
    for (const code of ["ACCOUNT_STILL_REFERENCED", "X", undefined]) {
      expect(deletionErrorText(FR_PROFILE, code)).toBe(accountDeletionErrorMessage(code));
    }
  });

  it("applications connectées : refus, porte, ligne du bot", () => {
    expect(FR_PROFILE.t("connections.bot.label")).toBe(DISCORD_BOT_CONNECTION_LABEL);
    for (const provider of OAUTH_PROVIDERS) {
      for (const refusal of ["NOT_LINKED", "LAST_CONNECTION"] as const) {
        expect(connectionRefusalText(FR_PROFILE, refusal, provider)).toBe(connectionUnlinkRefusalMessage(refusal, provider));
      }
    }
    for (const set of CONNECTION_SETS) {
      for (const item of set) expect(connectionMethodText(FR_PROFILE, item)).toBe(connectionMethodLabel(item));
    }
    // Le français de la ligne du bot, mot pour mot celui d'avant le lot 9-2 (le module partagé
    // ne rend plus que des codes) : chaque cas, et le refus.
    const FR_BOT_NOTES = {
      HANDLE: "Pseudo Discord : keryan",
      LINKED_BY_CODE: "Rattaché par code en message privé",
      LINKED_BY_BUTTON:
        "Ton Discord est rattaché par le bouton Discord : il se retire sur cette ligne-là. Le code en message privé met ici ton pseudo à jour.",
      LINKED_ELSEWHERE:
        "Ton Discord est rattaché : il se retire sur la ligne Discord. Le code en message privé met ici ton pseudo à jour.",
      NOT_LINKED: "Rattache ton Discord sans écran d'autorisation : le bot BlueGenji t'envoie un code en message privé.",
    } as const;
    for (const [noteCode, note] of Object.entries(FR_BOT_NOTES) as Array<[keyof typeof FR_BOT_NOTES, string]>) {
      expect(discordBotRowText(FR_PROFILE, { noteCode, handle: "keryan", refusalCode: null })).toEqual({ note, refusal: null });
    }
    expect(discordBotRowText(FR_PROFILE, { noteCode: "HANDLE", handle: "keryan", refusalCode: "LAST_CONNECTION" }).refusal).toBe(
      "Impossible de te déconnecter du bot : c'est ton dernier moyen de connexion. Ajoutes-en un autre d'abord.",
    );
    for (const set of CONNECTION_SETS) {
      const row = discordBotRowState(set);
      expect(Object.keys(FR_BOT_NOTES)).toContain(row.noteCode);
    }
  });
});

describe("français inchangé — signalements et notifications", () => {
  const fr = messagesFor("fr");

  it("catégories, statuts, qualités, cibles", () => {
    for (const category of [...REPORT_CATEGORIES, "CONTEST"] as ReportCategory[]) {
      const definition = REPORT_CATEGORY_DEFINITIONS[category];
      expect(fr.reports.categories[category]).toEqual({
        label: definition.label,
        hint: definition.hint,
        placeholder: definition.descriptionPlaceholder,
      });
      expect(legalBasisText(FR_REPORTS_TEXT, category)).toBe(reportLegalBasisNotice(category));
      expect(rightsText(FR_REPORTS_TEXT, category)).toBe(reportRightsNotice(category));
    }
    expect(fr.reports.status).toEqual(REPORT_STATUS_LABELS);
    expect(fr.reports.relation).toEqual(RIGHTS_RELATION_LABELS);
    for (const type of ["USER", "TEAM", "TOURNAMENT"] as const) expect(fr.reports.targets[type].picker).toBe(REPORT_TARGET_LABELS[type].picker);
    expect(fr.reports.offSite).toEqual({
      label: OFF_SITE_CONDUCT_ENTRY.label,
      hint: OFF_SITE_CONDUCT_ENTRY.hint,
      // Même phrase, lien compris : `<portal>` porte le libellé du lien, le point suit.
      notice: `${OFF_SITE_CONDUCT_NOTICE} <portal>portail de support BlueGenji</portal>.`,
    });
  });

  it("mentions de confidentialité du formulaire, mot pour mot", () => {
    expect(FR_REPORTS_TEXT.t("privacy.controller")).toBe(REPORT_PRIVACY_NOTICE.controller);
    expect(FR_REPORTS_TEXT.t("privacy.purpose")).toBe(REPORT_PRIVACY_NOTICE.purpose);
    expect(FR_REPORTS_TEXT.t("privacy.data")).toBe(REPORT_PRIVACY_NOTICE.data);
    expect(FR_REPORTS_TEXT.t("privacy.recipients")).toBe(REPORT_PRIVACY_NOTICE.recipients);
    expect(FR_REPORTS_TEXT.t("privacy.contestRecipients")).toBe(REPORT_PRIVACY_NOTICE.contestRecipients);
    expect(retentionText(FR_REPORTS_TEXT)).toBe(REPORT_PRIVACY_NOTICE.retention);
    expect(FR_REPORTS_TEXT.t("privacy.followUp")).toBe(NOTIFIER_FOLLOW_UP);
  });

  it("refus du formulaire, code par code, jamais le jeton", () => {
    for (const code of [...Object.keys(fr.reports.errors).filter((key) => key !== "fallback"), "NOPE", null, "constructor"]) {
      expect(reportErrorText(FR_REPORTS_TEXT, code)).toBe(reportErrorMessage(code));
    }
  });

  it("précision des cibles rédigée par le serveur", () => {
    const en = scopedText("en", EN.reports);
    expect(targetDetailText(en, "Équipe fantôme")).toBe("Ghost team");
    expect(targetDetailText(en, "Non publié")).toBe("Not published");
    expect(targetDetailText(en, "GLC")).toBe("GLC");
  });

  it("notifications : sujets, aides, refus", () => {
    for (const topic of PUSH_TOPIC_KEYS) {
      expect(pushTopicLabel(FR_PUSH_TEXT, topic)).toBe(PUSH_TOPICS[topic].label);
      expect(pushTopicDescription(FR_PUSH_TEXT, topic)).toBe(PUSH_TOPICS[topic].description);
    }
    for (const support of ["UNSUPPORTED", "IOS_NEEDS_INSTALL", "DENIED"] as const) {
      expect(pushSupportNotice(FR_PUSH_TEXT, support)).toBe(PUSH_SUPPORT_NOTICES[support]);
    }
    for (const code of [...Object.keys(PUSH_ERROR_MESSAGES), "NOPE", null]) {
      expect(pushErrorText(FR_PUSH_TEXT, code)).toBe(pushErrorMessage(code));
    }
  });
});

describe("anglais — phrases", () => {
  it("refus du profil, de la certification, des connexions", () => {
    expect(profileErrorMessage("PSEUDO_TOO_LONG", EN_PROFILE)).toBe(`Your username must be ${PSEUDO_MAX_LENGTH} characters or fewer.`);
    expect(profileErrorMessage("NOPE", EN_PROFILE)).toBe("Saving failed. Try again in a moment.");
    expect(avatarUploadErrorMessage("IMAGE_TOO_LARGE", EN_PROFILE, scopedText("en", EN.teamErrors))).toBe("Image too large: 5 MB maximum.");
    expect(discordVerificationErrorMessage("INVALID_CODE", EN_PROFILE)).toBe("The code must have 6 digits.");
    expect(connectionErrorMessage("constructor", EN_PROFILE)).toBe("The operation failed. Try again in a moment.");
    expect(otherSessionsSummary(1, EN_PROFILE)).toBe("1 other session is open on other browsers or devices.");
    expect(otherSessionsSummary(3, EN_PROFILE)).toBe("3 other sessions are open on other browsers or devices.");
    expect(sessionsRevokedMessage(2, EN_PROFILE)).toBe("2 other sessions were closed.");
    expect(unlinkSuccessMessage("BLIZZARD", null, EN_PROFILE)).toBe(
      "Blizzard was removed from your account. Your other sessions couldn't be closed: use “Log out my other sessions”.",
    );
    expect(deletionConsequencesText(EN_PROFILE, null)).toMatch(/^You haven't played any match/);
    expect(discordTagLockText(EN_PROFILE, { tag: "nova", verified: true, linked: true })).toContain("Nobody else, ever.");
  });

  it("aucun refus anglais n'est un code ni ne garde d'accent", () => {
    const push = scopedText("en", EN.push);
    for (const code of Object.keys(PUSH_ERROR_MESSAGES)) expect(pushErrorText(push, code)).not.toMatch(ACCENTED);
    const reports = scopedText("en", EN.reports);
    for (const code of Object.keys(EN.reports.errors)) expect(reportErrorText(reports, code)).not.toMatch(ACCENTED);
  });
});

describe("langue du compte (lot 9-3)", () => {
  it("en anglais : libellé, règle dite, chaque langue nommée dans sa langue", () => {
    const html = inEnglish(<AccountLocaleField initial="en" />);
    expect(html).toContain(">Notification language</label>");
    expect(html).toContain("It follows the page&#x27;s language each time you log in");
    expect(html).toContain("until you next log in from a page in the other language");
    expect(html).toContain('<option value="fr" lang="fr">Français</option>');
    expect(html).toContain('<option value="en" lang="en" selected="">English</option>');
    expect(html).toContain('aria-describedby="profile-account-locale-hint"');
    // Hors les noms de langue, rien de français.
    expectEnglish(html.replace(/<option[^>]*>[^<]*<\/option>/g, ""));
  });

  it("interrupteur des messages privés de match : libellé et aide en anglais, case liée à son aide", () => {
    const on = inEnglish(<MatchDmField initial />);
    expect(on).toContain("Discord direct messages about my matches");
    expect(on).toContain("Untick to stop receiving them");
    expect(on).toContain("referees still get theirs");
    expect(on).toContain("when a match leaves your schedule");
    expect(on).toContain('id="profile-match-dms"');
    expect(on).toContain('aria-describedby="profile-match-dms-hint"');
    expect(on).toMatch(/type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/);
    expectEnglish(on);
    const off = inEnglish(<MatchDmField initial={false} />);
    expect(off).not.toMatch(/checked=""/);
  });

  it("fenêtre de recrutement : libellé et aide en anglais, case liée à son aide, cochée sauf refus du compte", () => {
    const on = inEnglish(<RecruitmentModalField initialOff={false} />);
    expect(on).toContain("Window of urgent recruitment announcements");
    expect(on).toContain("Untick so that it no longer opens on its own");
    expect(on).toContain("another browser where you had turned it down keeps it closed");
    expect(on).toContain('id="profile-recruitment-modal"');
    expect(on).toContain('aria-describedby="profile-recruitment-modal-hint"');
    expect(on).toMatch(/type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/);
    expectEnglish(on);
    expect(inEnglish(<RecruitmentModalField initialOff />)).not.toMatch(/checked=""/);
    // Fiche pas encore lue : rien.
    expect(inEnglish(<RecruitmentModalField initialOff={undefined} />)).toBe("");
  });

  it("fenêtre de recrutement : le français dit le défaut, le réaffichage et l'autre navigateur", async () => {
    const fr = (await import("@/messages/fr/profile.json")).default.recruitmentModal;
    expect(fr.label).toBe("Fenêtre des annonces de recrutement urgentes");
    expect(fr.hint).toMatch(/^Cochée par défaut/);
    expect(fr.hint).toMatch(/un autre navigateur où tu l'avais refusée la garde fermée/);
    expect(fr.shown).toMatch(/réactivée/);
    expect(fr.hidden).toMatch(/ne s'ouvrira plus d'elle-même/);
    const en = (await import("@/messages/en/profile.json")).default.recruitmentModal;
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/page.tsx"), "utf8")).toContain(
      "<RecruitmentModalField initialOff={data?.recruitmentModalOff} />",
    );
  });

  it("interrupteur des messages privés de match : le français dit l'opposition et les push à part", async () => {
    const fr = (await import("@/messages/fr/profile.json")).default.matchDms;
    expect(fr.label).toBe("Messages privés Discord de mes matchs");
    expect(fr.hint).toMatch(/Activés par défaut/);
    expect(fr.hint).toMatch(/tes notifications push gardent leurs propres réglages, et les arbitres reçoivent toujours les leurs/);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(fr.hint).toMatch(/quand un match quitte ton programme/);
    expect(readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/page.tsx"), "utf8")).toMatch(
      /<MatchDmField\s+initial=\{data\?\.matchDmEnabled\}\s+discordReachable=/,
    );
  });

  it("interrupteur des messages privés de match : sans tag certifié, une ligne le dit (FR et EN), liée à la case et à la certification", async () => {
    const en = inEnglish(<MatchDmField initial discordReachable={false} />);
    expect(en).toContain("These messages only go to accounts with a verified Discord tag, to avoid spam");
    expect(en).toMatch(/<a href="#discord" class="[^"]*hintLink[^"]*">Verify my Discord tag<\/a>/);
    expect(en).toContain('aria-describedby="profile-match-dms-hint profile-match-dms-unreachable"');
    expect(en).toContain('id="profile-match-dms-unreachable"');
    expectEnglish(en);
    for (const reachable of [true, null]) {
      const html = inEnglish(<MatchDmField initial discordReachable={reachable} />);
      expect(html).not.toContain("profile-match-dms-unreachable");
    }
    const fr = (await import("@/messages/fr/profile.json")).default.matchDms;
    expect(fr.notCertified).toBe(
      "Ces messages ne partent qu'aux comptes dont le tag Discord est certifié, pour éviter le spam : sans tag certifié, ils ne peuvent pas te parvenir.",
    );
    expect(fr.certifyLink).toBe("Certifier mon tag Discord");
    // Retirer le tag coupe aussi ces messages : la confirmation le dit (FR et EN).
    // Seulement pour un tag certifié : un tag qui ne l'est pas ne reçoit déjà rien.
    const removal = [(await import("@/messages/fr/profile.json")).default.discord.removalBodyDms, (await import("@/messages/en/profile.json")).default.discord.removalBodyDms];
    const unverified = [(await import("@/messages/fr/profile.json")).default.discord.removalBodyUnverified, (await import("@/messages/en/profile.json")).default.discord.removalBodyUnverified];
    expect(unverified).toEqual(["Ton tag n'est pas certifié : personne ne le voit, pas même les administrateurs.", "Your tag isn't verified: nobody sees it, not even the administrators."]);
    // Un tag jamais certifié ne lit pas « de nouveau » : il ne l'a jamais été.
    const unverified2 = [(await import("@/messages/fr/profile.json")).default.discord.removalBody2Unverified, (await import("@/messages/en/profile.json")).default.discord.removalBody2Unverified];
    expect(unverified2).toEqual(["Ta prochaine connexion par Discord réenregistrera ton pseudo, toujours sans le certifier.", "Your next login with Discord will save your username again, still without verifying it."]);
    expect(removal).toEqual(["Le bot ne t'enverra plus non plus les messages privés de tes matchs.", "The bot will no longer send you direct messages about your matches either."]);
    // La page ne juge atteignable qu'un tag certifié (portée `certified` du serveur).
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/page.tsx"), "utf8");
    expect(page).toMatch(/function matchDmReachable\(discordState: DiscordState, profileVerified: boolean \| undefined\): boolean \| null \{\s*if \(discordState\.linked !== null\) return discordState\.verified;\s*return profileVerified \?\? null;/);
    // Lecture de l'état Discord en échec (silencieuse) : le profil chargé prend
    // le relais, sinon un joueur non certifié ne serait jamais prévenu.
    expect(page).toContain("discordReachable={matchDmReachable(discordState, data?.profile.discordVerified)}");
    // Figé à l'ouverture : le texte ne bascule pas pendant « Retrait… ».
    expect(page).toContain("<TagRemovalBody verified={tagRemovalVerified} dms={tagRemovalDms} />");
    expect(page).toMatch(/setTagRemovalVerified\(discordState\.verified\);\s*setTagRemovalDms\(\(matchDmShown\.current \?\? data\?\.matchDmEnabled\) !== false\);\s*setConfirmingTagRemoval\(true\);/);
    // Case décochée : la fin des messages privés de match ne se promet pas à qui
    // ne les reçoit plus ; la valeur enregistrée sur la page remonte à la fiche.
    // Détacher Discord ou changer de pseudo retire la certification : l'écran
    // la retire aussi, même si la relecture de l'état Discord échoue.
    expect(page).toContain("setDiscordState((prev) => (prev.tag === tag ? prev : { ...prev, tag, verified: false }));");
    expect(page).toMatch(/onDiscordUnlinked=\{\(\) => \{\s*setDiscordState\(\(prev\) => \(\{ \.\.\.prev, linked: false, verified: false, attested: false \}\)\)/);
    const apps = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/ConnectedAppsSection.tsx"), "utf8");
    // Perf : la certification tombe sans attendre la relecture de la liste, et
    // l'état Discord se relit en parallèle de celle-ci, pas après.
    expect(apps).toMatch(/if \(provider === "DISCORD"\) onDiscordUnlinked\?\.\(\);\s*onChanged\?\.\(\);\s*await reload\(\);/);
    // Le dialogue du code du bot dit aussi la conséquence sur les messages de match (FR et EN).
    const [frBot, enBot] = [(await import("@/messages/fr/profile.json")).default.botHandle, (await import("@/messages/en/profile.json")).default.botHandle];
    expect([frBot.matchDms, enBot.matchDms]).toEqual(["Sans certification, le bot ne t'envoie aucun message privé de match.", "Without verification, the bot sends you no match direct messages."]);
    for (const mode of ["LINK", "UPDATE"] as const) {
      effects.armed = true;
      expect(inEnglish(<DiscordBotHandleDialog mode={mode} onClose={() => undefined} onUpdated={() => undefined} />)).toContain(enBot.matchDms);
    }
    // Perf : le choix affiché remonte dans une référence, sans rendre la page.
    expect(page).toContain("onChoice={reportMatchDmChoice}");
    expect(page).toContain("const matchDmShown = useRef<boolean | undefined>(undefined);");
    expect(page).not.toMatch(/useState<boolean \| undefined>\(undefined\)/);
    // Le repli du profil chargé suit aussi (lecture de l'état Discord en échec).
    expect(page).toContain("? { ...prev, profile: { ...prev.profile, discordVerified: false } }");
    expect(page).toContain("setData((prev) => (prev ? { ...prev, profile: { ...prev.profile, discordVerified: false } } : prev));");
    // Rattaché par code : le toast rappelle de certifier (FR et EN).
    const bot = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/DiscordBotHandleDialog.tsx"), "utf8");
    expect(bot).toContain('mode === "LINK" ? `${t("botHandle.linked")} ${t("botHandle.certifyForDms")}` : t("botHandle.updated")');
    expect([frBot.certifyForDms, enBot.certifyForDms]).toEqual(["Certifie ton tag (section Discord) : sans certification, aucun message privé de match ne te parvient.", "Verify your tag (Discord section): without verification, no match direct message reaches you."]);
    expect(page).toContain('<p>{t(verified ? "discord.removalBody" : "discord.removalBodyUnverified")}</p>');
    expect(page).toContain('<p>{t(verified ? "discord.removalBody2" : "discord.removalBody2Unverified")}</p>');
    expect(page).toMatch(/function TagRemovalBody\([^)]*\)[^{]*\{[\s\S]*?\{verified && dms \? <p>\{t\("discord\.removalBodyDms"\)\}<\/p> : null\}/);
    // Le lien se distingue de la phrase (couleur + soulignement) : le `a` global
    // n'a ni l'un ni l'autre, et un lien du gris de l'aide ne se voit pas.
    const css = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/profil.module.css"), "utf8");
    expect(css).toMatch(/\.hintLink \{[^}]*color: var\(--blue-300\);[^}]*text-decoration: underline;/);
  });

  it("rattacher ou détacher Discord : le toast dit l'effet sur les messages privés de match (FR et EN)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(connectionSuccessMessage("DISCORD", false)).toBe(
      "Discord est maintenant rattaché à ton compte. Certifie ton tag (section Discord) : sans certification, aucun message privé de match ne te parvient.",
    );
    expect(connectionSuccessMessage("DISCORD", false, EN_PROFILE)).toMatch(/ Verify your tag \(Discord section\): without verification, no match direct message reaches you\.$/);
    expect(connectionSuccessMessage("GOOGLE", false)).not.toMatch(/Certifie/);
    expect(unlinkSuccessMessage("DISCORD", 0)).toBe("Discord a été retiré de ton compte. Sans certification, le bot ne t'envoie aucun message privé de match.");
    expect(unlinkSuccessMessage("DISCORD", 0, EN_PROFILE)).toMatch(/ Without verification, the bot sends you no match direct messages\.$/);
    expect(unlinkSuccessMessage("GOOGLE", 0)).toBe("Google a été retiré de ton compte.");
    // Le dialogue de certification fait lire la conséquence aux lecteurs d'écran.
    const dialog = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/DiscordVerificationDialog.tsx"), "utf8");
    expect(dialog).toContain('aria-describedby="discord-verify-match-dms discord-verify-exposure"');
    expect(dialog).toContain('<p id="discord-verify-match-dms"');
  });

  it("interrupteur des messages privés de match : un clic pendant l'envoi part à la suite, jamais ignoré", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/_components/MatchDmField.tsx"), "utf8");
    expect(source).toContain("runQueuedSaves<boolean>");
    expect(source).toMatch(/if \(busyRef\.current\) \{\s*queued\.current = next;\s*setEnabled\(next\);\s*return;/);
    expect(source).not.toMatch(/disabled=/);
    // Une relecture de la fiche commencée avant l'envoi ne recouvre pas le choix enregistré ici.
    expect(source).toMatch(/if \(outcome\.stored\) setChosenHere\(true\);/);
    // Ce que montre la case remonte à la page dès le geste (envoi en cours compris),
    // jamais pendant le rendu (la relecture de la fiche passe par `setEnabled`).
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(initial !== undefined\) onChoiceRef\.current\?\.\(enabled\);\s*\}, \[enabled, initial\]\);/);
    expect(source).toContain("show: setEnabled,");
    // Le toast lit l'état Discord à la fin de l'envoi, pas celui du clic.
    expect(source).toContain("outcomeMessage(outcome.saved, reachableRef.current)");
    expect(source).toMatch(/if \(initial !== undefined\) setEnabled\(initial\);/);
    // Activés sans tag certifié : le toast ne promet pas un envoi (FR et EN).
    expect(source).toMatch(/return discordReachable === false \? "matchDms\.enabledNotCertified" : "matchDms\.enabled";/);
    const [fr, en] = [(await import("@/messages/fr/profile.json")).default.matchDms, (await import("@/messages/en/profile.json")).default.matchDms];
    expect(fr.enabledNotCertified).toBe("Messages privés de match activés : ils partiront une fois ton tag Discord certifié.");
    expect(en.enabledNotCertified).toBe("Match direct messages turned on: they'll be sent once your Discord tag is verified.");
    expect(source).toMatch(/initial !== shown && !busy && \(!chosenHere \|\| initial === undefined\)/);
  });

  it("aide Discord des push : renvoie au choix des messages privés de match (FR et EN)", async () => {
    const fr = (await import("@/messages/fr/push.json")).default.panel.discordHint;
    const en = (await import("@/messages/en/push.json")).default.panel.discordHint;
    expect(fr).toContain("pour tes matchs, ne partent qu'à un tag certifié et suivent la case « Messages privés Discord de mes matchs » (Mon profil, section Notifications)");
    expect(en).toContain("for your matches, only go to a verified tag and follow the “Discord direct messages about my matches” box (My profile, Notifications section)");
  });

  it("pendant l'envoi : focus gardé et champ utilisable (aria-busy seul, ni disabled ni aria-disabled), second choix envoyé à la suite", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const field = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/_components/AccountLocaleField.tsx"), "utf8");
    expect(field).not.toContain("aria-disabled={");
    expect(field).toContain("aria-busy={busy || undefined}");
    expect(field).not.toMatch(/\sdisabled=\{/);
    // Un second choix pendant l'envoi n'est pas perdu : affiché, puis envoyé à la suite.
    expect(field).toMatch(/if \(busyRef\.current\) \{\s*queued\.current = value;\s*setLocale\(value\);\s*return;/);
    expect(field).toContain("const outcome = await runQueuedSaves<Locale>({");
    // Une langue relue ailleurs est reprise sans remonter le champ (ni perdre l'envoi ou le focus).
    expect(field).toContain("if (initial !== shown && !busy && !chosenHere) {");
    // Un seul toast de succès par geste, après le dernier envoi, et aucun au fil des envois.
    expect(field.match(/showSuccess\(/g)).toHaveLength(1);
    expect(field).toContain('if (outcome.confirmed) showSuccess(t("accountLocale.saved"));');
    expect(field).toContain("if (outcome.upToDate) fieldErrors.clear();");
    // Une erreur n'est rattachée (focus repris) que si le champ a encore le focus.
    expect(field).toContain("if (document.activeElement?.id === FIELD_ID) fieldErrors.report(code, message);");
    expect(readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/page.tsx"), "utf8")).toContain(
      "<AccountLocaleField initial={data.accountLocale} />",
    );
    // Détachée du réglage des notifications qui la précède (passe d'auto-contrôle).
    expect(field).toContain("s.accountLocale");
    expect(readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/profil.module.css"), "utf8")).toMatch(/\.accountLocale \{\s*margin-top: 14px;/);
    // Au repos, rien d'occupé ni de désactivé.
    const html = renderToStaticMarkup(<AccountLocaleField initial="fr" />);
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("disabled");
  });

  it("pendant l'envoi : seul le curseur dit l'attente, le champ ne se donne pas pour inerte", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/profil.module.css"), "utf8");
    expect(css).toMatch(/\.accountLocale select\[aria-busy="true"\] \{\s*cursor: progress;\s*\}/);
    expect(css).not.toMatch(/accountLocale[^{]*\{[^}]*opacity/);
    // Le commentaire de `.hint` reste collé à sa règle.
    expect(css).toMatch(/12 px et `--ink-soft`[^*]*avant\. \*\/\s*\.hint \{/);
  });

  it("une langue refusée : phrase dans la langue de la page, rattachée au champ", async () => {
    expect(profileErrorMessage("INVALID_LOCALE", EN_PROFILE)).toBe("The language sent is invalid. Reload the page, then try again.");
    expect(profileErrorMessage("INVALID_LOCALE")).toBe("La langue envoyée est invalide. Recharge la page puis réessaie.");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const field = readFileSync(join(__dirname, "..", "..", "app/(secured)/profil/_components/AccountLocaleField.tsx"), "utf8");
    expect(field).toContain('{ INVALID_LOCALE: "locale" }');
    expect(field).toContain('{...fieldErrors.aria("locale", HINT_ID)}');
    expect(field).toContain('<FieldErrorText fieldId={FIELD_ID} message={fieldErrors.message("locale")} />');
  });

  it("en français : libellé et règle", () => {
    const html = renderToStaticMarkup(<AccountLocaleField initial="fr" />);
    expect(html).toContain(">Langue des notifications</label>");
    expect(html).toContain("prochaine connexion faite dans l&#x27;autre langue");
    expect(html).toContain('<option value="fr" lang="fr" selected="">Français</option>');
  });
});

describe("anglais — écrans", () => {
  it("profil : chargement, sections, déconnexion", () => {
    const html = inEnglish(
      <>
        <ProfilePage />
        {PROFILE_SECTIONS.map((section) => (
          <ProfileSection key={section.id} section={section}>
            <span />
          </ProfileSection>
        ))}
        <LogoutButton />
      </>,
    );
    expect(html).toContain("Loading your profile…");
    expect(html).toContain("Connected apps");
    expect(html).toContain("Log out");
    expectEnglish(html);
  });

  it("applications connectées, chaque état", () => {
    for (const set of CONNECTION_SETS) {
      const html = inEnglish(<ConnectedAppsSection connections={set} reload={async () => undefined} />);
      expect(html).toContain("Discord bot (direct-message code)");
      expectEnglish(html);
    }
    expect(inEnglish(<ConnectedAppsSection connections={null} reload={async () => undefined} />)).toContain("Loading…");
    // Pseudo du fournisseur et pseudo vu par le bot, nettoyés (commande de direction, largeur nulle) : revue de sécurité du lot 9-2.
    const trapped = inEnglish(
      <ConnectedAppsSection
        connections={[connection("GOOGLE", { linked: true }), connection("DISCORD", { linked: true, method: "OAUTH", handle: "no\u202Eva\u200B" }), connection("BLIZZARD", { linked: true, handle: "\u202ENova#1234" })]}
        reload={async () => undefined}
      />,
    );
    expect(trapped).not.toMatch(/[\u202E\u200B]/u);
    // Anglais du profil non chargé (texte retombé sur le français) sous /en : le retour OAuth suit l'adresse, pas le texte.
    const fallback = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <ProfileTextProvider locale="fr">
          <ConnectedAppsSection connections={CONNECTION_SETS[0]} reload={async () => undefined} />
        </ProfileTextProvider>
      </AppLocaleProvider>,
    );
    expect(fallback).toContain("Rattacher");
    expect(fallback).toMatch(/href="\/api\/auth\/[a-z]+\/start\?lang=en&amp;intent=link"/u);
    expect(trapped).toContain("nova");
    expect(discordBotRowText(FR_PROFILE, { noteCode: "HANDLE", handle: "kery\u202Ean", refusalCode: null }).note).not.toMatch(/\u202E/u);
    const linkHtml = inEnglish(<ConnectedAppsSection connections={CONNECTION_SETS[0]} reload={async () => undefined} />);
    // Le rattachement emporte la langue : retour sur `/en/profil`.
    expect(linkHtml).toContain("/api/auth/google/start?lang=en&amp;intent=link");
    expect(inEnglish(<OtherSessionsPanel version={0} />)).toContain("Log out my other sessions");
  });

  it("fenêtres du profil", () => {
    const notice = inEnglish(<BattletagVisibilityNotice onClose={() => undefined} />);
    expect(notice).toContain("Hidden, but not from everyone");
    expectEnglish(notice);
    for (const props of [
      { initialTag: "nova", linked: true, attested: true },
      { initialTag: "", linked: true, attested: false },
      { initialTag: "nova", linked: false, attested: false },
    ]) {
      effects.armed = true;
      const html = inEnglish(<DiscordVerificationDialog {...props} onClose={() => undefined} onVerified={() => undefined} />);
      expect(html).toContain("Verify my Discord tag");
      // Sans certification, aucun message privé de match : le dialogue le dit.
      expect(html).toContain("It also lets the bot send you direct messages about your matches (times, reminders): without it, the bot sends you none.");
      expectEnglish(html);
    }
    // Un tag enregistré avec une commande de direction ne réordonne pas la phrase.
    effects.armed = true;
    const attested = inEnglish(
      <DiscordVerificationDialog initialTag={"no\u202Eva\u200B"} linked attested onClose={() => undefined} onVerified={() => undefined} />,
    );
    expect(attested).toContain("<strong>nova</strong>");
    expect(attested).not.toMatch(/[\u202E\u200B]/u);
    for (const mode of ["LINK", "UPDATE"] as const) {
      effects.armed = true;
      const html = inEnglish(<DiscordBotHandleDialog mode={mode} onClose={() => undefined} onUpdated={() => undefined} />);
      expect(html).toContain(mode === "LINK" ? "Link Discord by code" : "Update my Discord username");
      expectEnglish(html);
    }
  });

  it("modale de recadrage : la langue de la page, ou le français imposé", () => {
    const file = new File(["x"], "logo.png", { type: "image/png" });
    globalThis.URL.createObjectURL ??= () => "blob:x";
    effects.armed = true;
    const html = inEnglish(<ImageCropDialog file={file} kind="avatar" title="Crop your avatar" onCancel={() => undefined} onConfirm={() => undefined} englishMessages={EN.imageCrop} />);
    expect(html).toContain("Confirm crop");
    expectEnglish(html);
    effects.armed = true;
    const staff = inEnglish(<ImageCropDialog file={file} kind="avatar" title="Recadrer" onCancel={() => undefined} onConfirm={() => undefined} lang="fr" englishMessages={EN.imageCrop} />);
    expect(staff).toContain("Valider le recadrage");
    expect(staff).toMatch(/role="dialog"[^>]*lang="fr"/);
  });

  it("formulaire de signalement : chaque catégorie, connecté ou non", () => {
    const choice = inEnglish(<ReportProblemDialog pathname="/equipes/4" authenticated={false} onClose={() => undefined} />);
    expect(choice).toContain("Report a problem");
    expect(choice).toContain("A player&#x27;s behavior");
    expectEnglish(choice);
    for (const category of REPORT_CATEGORIES.filter((key): key is Exclude<ReportCategory, "CONTEST"> => key !== "CONTEST")) {
      for (const authenticated of [true, false]) {
        const html = inEnglish(
          <ReportProblemDialog pathname="/equipes/4" authenticated={authenticated} initialCategory={category} onClose={() => undefined} />,
        );
        expect(html).toContain("Your data");
        expectEnglish(html);
      }
    }
    const contest = inEnglish(<ReportProblemDialog pathname="/signalements/9" authenticated contestOf={9} onClose={() => undefined} />);
    expect(contest).toContain("You&#x27;re appealing report no. 9.");
    expectEnglish(contest);
  });

  it("page d'un signalement pour la personne visée", () => {
    const report: ConcernedReportView = {
      id: 9,
      category: "COPYRIGHT",
      status: "RESOLVED",
      description: "Logo copied",
      createdAt: "2026-03-01T10:00:00.000Z",
      targets: [{ type: "TEAM", id: 4, label: "Glaciers", exists: true, imageUrl: null, detail: null }],
      myContests: [{ id: 3, createdAt: "2026-03-02T10:00:00.000Z", description: "We made it" }],
      quarantines: [
        { id: 1, targetType: "TEAM", targetId: 4, targetName: "Glaciers", reportId: 9, status: "HIDDEN", hiddenAt: "2026-03-01T10:00:00.000Z", purgeAfter: "2026-09-01T10:00:00.000Z", closedAt: null },
        { id: 2, targetType: "USER", targetId: 5, targetName: "Nova", reportId: 9, status: "PURGED", hiddenAt: "2026-03-01T10:00:00.000Z", purgeAfter: "2026-09-01T10:00:00.000Z", closedAt: "2026-03-01T10:00:00.000Z" },
      ],
    };
    const html = inEnglish(<ConcernedReport report={report} onContest={() => undefined} />);
    expect(html).toContain("A report concerns you");
    expect(html).toContain("permanently deleted on September 1, 2026");
    expect(html).toContain("deleted</strong> immediately on March 1, 2026");
    expect(html).toContain('href="/en/equipes/4"');
    expectEnglish(html.replace("Logo copied", "").replace("We made it", ""));
  });

  it("page d'un signalement : un nom enregistré avant visibleText ne réordonne pas la phrase (revue de sécurité du lot 9-2)", () => {
    // U+202E (commande de direction) et U+200B (largeur nulle) dans un nom resté tel quel en base.
    const legacy = "Gla\u202Eciers\u200B";
    const report: ConcernedReportView = {
      id: 9,
      category: "COPYRIGHT",
      status: "RESOLVED",
      description: "",
      createdAt: "2026-03-01T10:00:00.000Z",
      targets: [
        { type: "TEAM", id: 4, label: legacy, exists: true, imageUrl: null, detail: null },
        { type: "USER", id: 6, label: legacy, exists: false, imageUrl: null, detail: null },
      ],
      myContests: [],
      quarantines: [
        { id: 1, targetType: "TEAM", targetId: 4, targetName: legacy, reportId: 9, status: "HIDDEN", hiddenAt: "2026-03-01T10:00:00.000Z", purgeAfter: "2026-09-01T10:00:00.000Z", closedAt: null },
        { id: 2, targetType: "TEAM", targetId: 4, targetName: legacy, reportId: 9, status: "PURGED", hiddenAt: "2026-03-01T10:00:00.000Z", purgeAfter: "2026-09-01T10:00:00.000Z", closedAt: "2026-03-01T10:00:00.000Z" },
      ],
    };
    const html = inEnglish(<ConcernedReport report={report} onContest={() => undefined} />);
    expect(html).not.toMatch(/[\u202E\u200B]/u);
    expect(html.split("Glaciers").length - 1).toBeGreaterThanOrEqual(4);
    // Textes libres (signalement, contestations) : direction isolée, sauts de ligne gardés.
    const withText = inEnglish(
      <ConcernedReport
        report={{ ...report, description: "a\u202Eb", myContests: [{ id: 3, createdAt: "2026-03-02T10:00:00.000Z", description: "c\u202Ed" }] }}
        onContest={() => undefined}
      />,
    );
    expect(withText).toMatch(/<blockquote[^>]*dir="auto"[^>]*>a\u202Eb<\/blockquote>/u);
    expect(withText).toContain('<p dir="auto">c\u202Ed</p>');
  });

  it("choix des cibles : vignette tirée du nom nettoyé", () => {
    const html = renderToStaticMarkup(<TargetThumb option={{ label: "\u200B\u202Eabc", imageUrl: null }} />);
    expect(html).toContain(">A<");
  });

  it("réglage des notifications, chaque état de l'appareil", () => {
    const server = { publicKey: "k", topics: [...PUSH_TOPIC_KEYS], disabledTopics: [], devices: 2 };
    const states: Partial<PushState>[] = [
      { support: null, server: null, loadFailed: false },
      { support: "AVAILABLE", server: { ...server, publicKey: null }, checked: true, subscribed: false },
      { support: "IOS_NEEDS_INSTALL", server, checked: true, subscribed: false },
      { support: "AVAILABLE", server, checked: false, subscribed: false },
      { support: "AVAILABLE", server, checked: true, subscribed: true },
      { support: "AVAILABLE", server, checked: true, subscribed: false, busy: true },
      { support: null, server: null, loadFailed: true },
    ];
    for (const state of states) {
      mockPush = state;
      const html = inEnglish(<PushNotificationsPanel />);
      expectEnglish(html);
    }
    mockPush = states[4];
    expect(inEnglish(<PushNotificationsPanel />)).toContain("2 devices subscribed to your account");
  });
});

function reportsMetadata(id: string) {
  return reportMetadata({ params: Promise.resolve({ id }) });
}

describe("équivalence avec next-intl, message par message", () => {
  function leaves(tree: object, prefix = ""): Array<{ key: string; source: string }> {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [{ key: `${prefix}${key}`, source: value }] : leaves(value as object, `${prefix}${key}.`),
    );
  }

  type Namespace = "profile" | "reports" | "imageCrop" | "push";
  const NAMESPACES: Namespace[] = ["profile", "reports", "imageCrop", "push"];
  const CASES: Array<[(typeof LOCALES)[number], Namespace]> = LOCALES.flatMap((locale) =>
    NAMESPACES.map((ns): [(typeof LOCALES)[number], Namespace] => [locale, ns]),
  );

  it.each(CASES)(
    "%s · %s",
    (locale, namespace) => {
      for (const { key, source } of leaves(messagesFor(locale)[namespace])) {
        if (source.includes("<")) continue;
        const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
        for (const count of [0, 1, 2]) {
          const values = {
            count, max: 32, min: 20, label: "Discord", handle: "nova", time: "10:00", tag: "nova", purpose: "P", audience: "A", rename: "R",
            change: "C", removed: "Removed.", backupDays: 30, journalDays: 90, logDays: 365, days: 30, months: 6, channel: "here", id: "9",
            category: "Bug", date: "May 1", status: "Open", length: 3, picker: "Teams", name: "Glaciers", since: "May 1", purge: "Nov 1",
            width: 50, height: 50, left: 10, top: 10, team: "Glaciers",
          };
          expect(`${key}: ${formatMessage(locale, source, values)}`).toBe(`${key}: ${reference("m", values)}`);
        }
      }
    },
  );
});
