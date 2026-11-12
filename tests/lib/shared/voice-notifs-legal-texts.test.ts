import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * VOICE-NOTIFS-LOT (#595), revue juridique : la reprise d'équipe ne cite plus
 * « un admin » (D4), plafonds des avis de reprise et de propriété, fiche de
 * membre du bot (T08) et messages du bot au journal du staff (T18) déclarés.
 */
const ENTRY_ID = "2026-11-reprise-d-equipe-et-fiche-de-membre-du-bot";
const V11_ID = "2026-11-conditions-v11-diffusion-sous-le-pseudo";
const entryFr = PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID);
const entryEn = PRIVACY_CHANGES_EN[ENTRY_ID];
const voiceSummary = (source: string) =>
  source.slice(source.indexOf('<p id="donnees-salons-vocaux">'), source.indexOf('<p id="age-minimum">'));

describe("entrée PRIVACY_CHANGES de la reprise d'équipe (#595)", () => {
  it("privacyChange_takeoverEntry_isLastDated20261113ForAllAccounts", () => {
    // Suivie, le même jour, de l'entrée des avis d'équipe (TEAMS-LOT).
    expect(PRIVACY_CHANGES.at(-2)?.id).toBe(ENTRY_ID);
    expect(entryFr?.publishedAt).toBe("2026-11-13");
    expect(entryFr?.audience).toBeUndefined();
    expect(entryFr?.asksTermsAcceptance).toBeUndefined();
    expect(entryEn?.details).toHaveLength(entryFr?.details.length ?? -1);
  });

  it("privacyChange_takeoverEntry_saysNoMoreAnAdminAndCapsFrAndEn", () => {
    const fr = entryFr?.details.join(" ") ?? "";
    const en = entryEn?.details.join(" ") ?? "";
    expect(fr).toContain("ne disent plus « un admin »");
    expect(fr).toContain("en 24 heures, une même personne du staff ne fait prévenir que 10 joueurs au plus, et un joueur n'est prévenu que de 3 reprises au plus");
    expect(fr).toContain("une fois par équipe et par joueur toutes les 24 heures");
    expect(fr).toContain("« Invitations et propriété d'équipe »");
    expect(en).toContain("no longer say “an admin”");
    expect(en).toContain("within 24 hours, the same staff member only has 10 players notified at most, and a player is only notified of 3 takeovers at most");
    expect(en).toContain("once per team and per player every 24 hours");
    expect(en).toContain("“Team invitations and ownership”");
  });

  it("privacyChange_takeoverEntry_declaresMemberProfileAndStaffLogFrAndEn", () => {
    const fr = entryFr?.details.join(" ") ?? "";
    const en = entryEn?.details.join(" ") ?? "";
    expect(fr).toContain("le bot tient en mémoire la fiche de membre que Discord lui transmet");
    expect(fr).toContain("le registre (T08) le disent maintenant");
    expect(fr).toContain("la politique et le registre (T18) le disent maintenant");
    expect(en).toContain("the bot holds in memory the member profile Discord sends it");
    expect(en).toContain("the register (T08) now say so");
    expect(en).toContain("the policy and the register (T18) now say so");
  });

  it("privacyChangeV11_botBullet_noLongerCitesAnAdminFrAndEn", () => {
    const v11Fr = PRIVACY_CHANGES.find((c) => c.id === V11_ID)?.details.join(" ") ?? "";
    const v11En = PRIVACY_CHANGES_EN[V11_ID]?.details.join(" ") ?? "";
    expect(v11Fr).toContain("Bot Discord : sa politique de confidentialité dit désormais, comme notre politique, que le caster concerné");
    expect(v11Fr).not.toContain("un admin");
    expect(v11En).toContain("Discord bot: its privacy policy now says, like our policy, that the caster concerned");
    expect(v11En).not.toContain("an admin");
  });
});

describe("politique du bot — fiches de membre (T08)", () => {
  it("botPrivacyPolicy_memberProfiles_heldInMemoryNeverRecordedFrAndEn", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);
    expect(fr).toContain("Le Bot la tient en mémoire, à jour de Discord, sans jamais l'enregistrer, pour lire les membres dont il a besoin : adhésions à l'association, rôle d'arbitrage, commandes, remise des messages privés du site et recherche du compte Discord à qui envoyer un code.");
    expect(en).toContain("The Bot holds them in memory, kept up to date by Discord, without ever recording them, to read the members it needs: memberships of the association, refereeing role, commands, delivery of the website's direct messages and finding the Discord account a code goes to.");
  });
});

describe("/rgpd — salons vocaux", () => {
  it("rgpdPages_voiceSummary_noLongerSaysNoUserDataFrAndEn", () => {
    const fr = voiceSummary(readSource("app/rgpd/page.tsx"));
    const en = voiceSummary(readSource("app/rgpd/RgpdEn.tsx"));
    expect(fr).toContain("le site n&apos;enregistre jamais qui s&apos;y trouve");
    expect(fr).toContain("seul le vidage d&apos;un salon par l&apos;arbitrage peut nommer son auteur, dans les journaux du serveur");
    expect(fr).not.toContain("aucune donnée");
    expect(en).toContain("the site never records who is in them");
    expect(en).toContain("of a channel by the referees or administrators can name its author, in the server logs");
    expect(en).not.toContain("no user data");
  });

  it("rgpdPages_voiceParagraph_mentionsStaffLogMessagesFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain(
      "le bot écrit aussi au salon de journal privé du staff, que lit le staff, des messages techniques sur les salons (identifiant d&apos;un salon et erreur de Discord quand sa suppression ou son suivi échoue, bilan ou échec d&apos;un balayage, alerte de permission manquante), sans donnée de joueur, gardés un an.",
    );
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain(
      "the bot also writes to the staff&apos;s private log channel, read by staff, technical messages about the channels (identifier of a channel and Discord&apos;s error when its deletion or tracking fails, sweep report or failure, missing-permission alert), without any player data, kept for one year.",
    );
  });
});

describe("registre T03 — avis d'équipe", () => {
  it("register_t03_takeoverCapsWithoutAnAdminFrAndEn", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === "T03"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T03"));
    expect(fr).not.toContain("un admin");
    expect(fr).toContain("(une fois par équipe et par joueur, 10 joueurs par auteur et 3 reprises par joueur dans ce délai)");
    expect(fr).toContain("compté en mémoire sur les avis réellement partis (un redémarrage du site, ou plus de mille avis dans ce délai, peut en laisser partir un de plus)");
    expect(en).not.toContain("an admin");
    expect(en).toContain("(once per team and per player, 10 players per author and 3 takeovers per player within that time)");
    expect(en).toContain("counted in memory on the notices actually sent (a restart of the site, or more than a thousand notices within that time, may let one more through)");
  });
});
