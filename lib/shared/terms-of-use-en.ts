/**
 * English translation of the terms of use (lot 7b, D1) — pure module.
 *
 * The **French** text (`TERMS_SECTIONS`, `terms-of-use.ts`) is the reference
 * and the version accounts accept (`TERMS_VERSION`); this translation follows
 * it section by section, same identifiers, same order, and **does not** change
 * the version: accepting on `/en` accepts the same `TERMS_VERSION`. Any
 * substantive change is made in both languages in the same PR (parity test,
 * `tests/app/site-legal-i18n.test.tsx`).
 */

import { LOGO_QUARANTINE_MONTHS } from "./logo-quarantine";
import { SUSPENSION_MAX_DAYS } from "./account-suspension";
import { SITE_MINIMUM_AGE } from "./legal-durations";
import { STREAM_NOTICE_PRIVACY_PATH } from "./stream-notice";
import { ASSOCIATION_CONTACT_PATH, type TermsSection } from "./terms-of-use";
import {
  NOTIFIER_FOLLOW_UP_EN,
  STREAM_NOTICE_OBJECTION_EN,
  STREAM_NOTICE_SHOWN_EN,
  copyrightNoticeElementsTextEn,
} from "./legal-text-en";

/** `TERMS_SECTIONS`, translated — same `id` for each section, in the same order. */
export const TERMS_SECTIONS_EN: readonly TermsSection[] = [
  {
    id: "objet",
    title: "Purpose",
    paragraphs: [
      "These terms govern the use of the BlueGenji Esport site, published by the **Bluegenji Esport association** (a French nonprofit under the law of 1901), which organizes amateur Overwatch and Marvel Rivals tournaments and provides players with profile, team and tournament pages.",
      "They supplement the **rules of each tournament** and the **privacy policy**, which describes how personal data is processed. In case of conflict regarding how a tournament is run, its rules prevail.",
    ],
  },
  {
    id: "acceptation",
    title: "Acceptance",
    paragraphs: [
      "The terms are accepted when **creating an account**, when **creating a team** and when **being given the management of a team** (ownership transferred or manager role). Without this acceptance, the account cannot be created and the team cannot be managed.",
      "The association may amend these terms. A substantive change gives rise to a **new version**, presented for acceptance to the users concerned before they can continue to manage a team.",
    ],
  },
  {
    id: "compte",
    title: "Account",
    paragraphs: [
      "An account is created by logging in with Google, Discord or Battle.net, or with a code received by Discord direct message. It is **personal**: it may not be lent, shared or resold.",
      `You must be **at least ${SITE_MINIMUM_AGE} years old** to create an account. By accepting these terms, the user declares that they have reached this age.`,
      "An account does not make its holder a **member of the association**: membership is a separate process, subject to the conditions of its bylaws, including a minimum age of their own.",
      "The chosen username must not impersonate another person, infringe their rights, or be insulting, discriminatory or sexual in nature.",
      "Each user can export their data and delete their account at any time from their profile.",
    ],
  },
  {
    id: "comportement",
    title: "Conduct",
    paragraphs: [
      "On the site as on the association's Discord servers, everyone agrees to respect other players, the staff and the referees: **no harassment, hate speech, cheating, impersonation or attempt to rig a tournament**.",
      "It is forbidden to try to circumvent the site's protections, to access another user's account or to disrupt the service (automated submissions, deliberate overloading).",
    ],
  },
  {
    id: "contenus",
    title: "Content published by users",
    paragraphs: [
      "Users publish certain content themselves: **avatar, team logo, team name and tag, description, in-game usernames**. Whoever publishes content is **responsible** for it.",
      "By publishing content, the user **warrants that they hold the rights to it** (personal creation, free license, written authorization from the rights holder) and that it infringes neither copyright, nor trademark law, nor the rights of any third party. The logo of a professional club, of a game publisher or of a brand may not be used without the agreement of its rights holder.",
      "They grant the association, **free of charge and on a non-exclusive basis**, the right to **reproduce and display** this content, and to adapt its format (resizing, cropping, image conversion) without altering its meaning, **on the site and in its tournament-related communications** (live streams and replays, announcements, social networks), **worldwide** — the site and these communications being accessible online —, and **for as long as it is published on the site** — and, for the streams, replays and posts made during that period, for as long as they remain online. For the **avatar** and **in-game usernames**, which are personal data, this license applies **on the site only**, which displays them only according to the player's visibility settings and the privacy policy. The username the game itself displays during a streamed match is not content published on the site.",
      "They can remove this content at any time, by the means the site offers them (a team name can be replaced and only disappears with the team; a BattleTag received from Battle.net can only be erased once the Battle.net account is unlinked, which requires another means of logging in). Removal applies to the future: the content stops being displayed on the site and being used in new communications, but streams, replays and posts **already made** before the removal are not affected.",
      "For a team, besides their author, the following are also answerable for its content: the **owner** for the team's name, tag and description, which only they can change; the owner and the **managers** for its logo, which either of them can change. A **ghost team**, created and managed by the association's staff for a tournament, has no owner: the association is answerable for its content.",
    ],
  },
  {
    id: "retransmission",
    title: "Match streaming",
    paragraphs: [
      `A tournament match may be **streamed live and recorded** (YouTube, Twitch or Kick), on the association's channel or a caster's. ${STREAM_NOTICE_SHOWN_EN}`,
      `${STREAM_NOTICE_OBJECTION_EN} The stream is watched on the platform that publishes it: the site only links to the channel.`,
    ],
    links: [{ href: STREAM_NOTICE_PRIVACY_PATH, label: "Privacy policy — match streaming" }],
  },
  {
    id: "signalement",
    title: "Reporting and moderation",
    paragraphs: [
      `Anyone, whether or not they hold an account, can report content that is illegal or contrary to these terms with the **“Report a problem”** button at the bottom of every page. A copyright notice must state ${copyrightNoticeElementsTextEn()}. ${NOTIFIER_FOLLOW_UP_EN}`,
      "The association acts as the **hosting provider** of its users' content: it does not review it before publication, but **promptly removes** any manifestly illegal content reported to it.",
      "Depending on the seriousness, the association may **remove content** (for example a logo or an avatar), **withdraw a team from a tournament**, or **suspend an account**. Each decision is taken by a person in charge of moderation, **never by automated processing**, and the **reasons are given** to the person concerned: what is decided, the facts relied on, the clause of these terms on which it is based, and the means of redress.",
      `**Suspending an account** immediately closes all its sessions and prevents logging into it, by any means of logging in, for as long as it lasts. It is imposed for a **fixed period** (${SUSPENSION_MAX_DAYS} days at most) or **indefinitely**, until the association lifts it. The holder receives the statement of reasons by Discord direct message if their account is linked to Discord, and, in any case, at each login attempt during the suspension. They can contest it without having to log in, with the “Report a problem” button (“Other” category, « Autre »), quoting the reference of the decision.`,
      "**Redress**: any moderation decision can first be contested with the association, which **reviews** it — from the report's page or the “Appeal” category (« Contestation ») of the form for a decision taken on a report, through the “Other” category (« Autre ») for a suspension or a decision taken without a report. The person concerned can then, or at any time, bring the decision before the **competent court**.",
      "The processing of data required to moderate content and accounts contrary to these terms (reviewing content, hiding, removal, suspension, keeping the decision while it can be contested) is based on the association's **legitimate interest** in enforcing its rules; the privacy policy sets out the retention periods.",
      "Players targeted by a report, and the members of the teams targeted, are **notified by Discord direct message** (if they have linked their Discord account or certified their tag). On the report's page they can read what they are accused of — never who reported it — and can **contest** it from that page or through the “Appeal” category (« Contestation ») of the same form; contesting an archived report reopens it.",
      `A reported team logo or player avatar may be **hidden** rather than deleted: it is no longer online, and the team or the player has **${LOGO_QUARANTINE_MONTHS} months** to contest. Without a challenge, the image is permanently deleted when that period ends; if the challenge succeeds, it is restored. Manifestly illegal content may be deleted without delay: the team or the player is notified in the same way and can contest the decision.`,
    ],
  },
  {
    id: "responsabilite",
    title: "Liability",
    paragraphs: [
      "The site is provided by an association of volunteers, **without any guarantee of availability**. The association cannot be held liable for an interruption, a loss of game data or a result distorted by an outage, within the limits permitted by law.",
      "The Overwatch (Blizzard Entertainment) and Marvel Rivals (NetEase, Marvel) trademarks and visuals belong to their owners; the site is neither affiliated with nor endorsed by these publishers.",
    ],
  },
  {
    id: "droit-applicable",
    title: "Governing law",
    paragraphs: [
      "These terms are governed by **French law**. A dispute is first brought before the association, through its Discord server or at the association's email address given in the legal notice, with a view to an amicable solution; failing that, the French courts have jurisdiction, without prejudice to the rules that allow a consumer to bring proceedings before the court of their place of residence or to rely on the mandatory provisions of the law of their country of residence.",
      "The service is **free** and the association sells nothing on the site: no sales or service contract is concluded there with a consumer, so no **consumer mediator** has been appointed.",
    ],
    links: [{ href: ASSOCIATION_CONTACT_PATH, label: "Contact details of the association (legal notice)" }],
  },
];
