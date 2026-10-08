import type { ReactNode } from "react";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { TranslationNotice } from "@/components/legal/TranslationNotice";
import { EnglishLegalLink } from "@/components/legal/EnglishLegalLink";
import { EnglishLegalText } from "@/components/legal/EnglishLegalText";
import { AudienceOptOutControl } from "@/components/privacy/AudienceOptOutControl";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { messagesFor } from "@/lib/server/i18n-messages";
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import {
  MODERATION_SUPPORT_PORTAL_URL,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  REPORT_TARGET_NOTICE_COOLDOWN_HOURS,
} from "@/lib/shared/content-reports";
import { ASSOCIATION_NAME, ASSOCIATION_SEAT, DATA_CONTACT_NAME } from "@/lib/shared/legal-contact";
import { SUPPORT_TICKET_RETENTION_MONTHS, WEB_ACCESS_LOG_RETENTION_DAYS } from "@/lib/shared/legal-durations";
import {
  DATA_CONTACT_ROLE_EN,
  NOTIFIER_FOLLOW_UP_EN,
  REPORT_FORM_NAME_EN,
  STREAM_NOTICE_OBJECTION_EN,
  STREAM_NOTICE_SHOWN_EN,
  WEB_ACCESS_LOG_FIELDS_EN,
  copyrightNoticeElementsTextEn,
  monthsEn,
} from "@/lib/shared/legal-text-en";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import {
  ASSOCIATION_EMAIL_ENCODED,
  ASSOCIATION_PHONE_ENCODED,
  DATA_CONTACT_EMAIL_ENCODED,
  DATA_CONTACT_PHONE_ENCODED,
} from "@/lib/shared/obfuscated-contact";
import { formatPrivacyChangeDateIn, type PrivacyChange } from "@/lib/shared/privacy-changes";
import { ALL_TRANSFER_RECIPIENTS } from "@/lib/shared/processing-register";
import {
  HETZNER_BACKUP_FRAMEWORK_EN,
  PROCESSING_ACTIVITIES_EN,
  REGISTER_SCOPE_DETAIL_EN,
  REGISTER_SCOPE_EN,
  SPICEWORKS_PROCESSOR_FRAMEWORK_EN,
  SPICEWORKS_SCC_FALLBACK_EN,
  transferBasisEn,
} from "@/lib/shared/processing-register-en";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import type { DonneEntry } from "@/lib/shared/rgpd-policy";
import {
  DONNEES_PROFIL_EN,
  DONNEE_CONNEXIONS_EN,
  DONNEE_SAUVEGARDES_EN,
  DONNEE_TOURNOIS_EN,
  DROITS_EN,
  LEGAL_BASE_EN,
} from "@/lib/shared/rgpd-policy-en";
import {
  AUDIENCE_OPT_OUT_MAX_AGE_DAYS,
  SITE_VISITOR_RETENTION_MONTHS,
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
  type AudienceOptOutReason,
} from "@/lib/shared/site-visits";
import { SITE_MINIMUM_AGE, TERMS_PATH } from "@/lib/shared/terms-of-use";
import styles from "./page.module.css";

/** Column headings of the data table, repeated by each mobile card. */
const DATA_COLUMNS = ["Data", "Purpose", "Legal basis", "Retention"] as const;

/** A cell of the data table (same markup as the French page). */
function DataCell({ column, children }: Readonly<{ column: 0 | 1 | 2 | 3; children: ReactNode }>) {
  return (
    <td role="cell">{/* NOSONAR S6843 — cellule de tableau de données, non de grille : `display: block` retire la sémantique */}
      <span className={styles.cellLabel} aria-hidden="true">
        {DATA_COLUMNS[column]}
      </span>
      {children}
    </td>
  );
}

function DataRow({ entry, accent = false, mark = "" }: Readonly<{ entry: DonneEntry; accent?: boolean; mark?: string }>) {
  return (
    <tr role="row">
      <DataCell column={0}>{entry.donnee}</DataCell>
      <DataCell column={1}>
        <EnglishLegalText text={entry.finalite} />
      </DataCell>
      <DataCell column={2}>
        <span className={accent ? `${styles.badge} ${styles.badgeAccent}` : styles.badge}>{LEGAL_BASE_EN[entry.base]}</span>
        {entry.extraBases?.map((extra) => (
          <span key={extra.base} className={styles.extraBase}>
            <span className={styles.badge}>{LEGAL_BASE_EN[extra.base]}</span> {extra.scope}
          </span>
        ))}
      </DataCell>
      <DataCell column={3}>
        {entry.duree}
        {mark}
      </DataCell>
    </tr>
  );
}

/** `2026-09-23` → `September 23, 2026`. */
const englishDay = (iso: string) => formatPrivacyChangeDateIn(iso, "en");

const NOTE_STYLE = { fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" } as const;

/**
 * The privacy policy in English (lot 7b-2, D1): a translation of the French
 * page, which prevails — the notice says so and links to it. Same sections,
 * same anchors (`#audience`, `#signalements`, `#exercer-vos-droits`…), same
 * constants for every duration; the history lists the published changes with
 * their English titles.
 */
export function RgpdEn({
  authenticated,
  audienceOptOut,
  updatedLabel,
  history,
}: Readonly<{
  authenticated: boolean;
  audienceOptOut: AudienceOptOutReason | null;
  updatedLabel: string;
  history: readonly PrivacyChange[];
}>) {
  const { audience } = messagesFor("en").legal;
  return (
    <>
      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">DATA PROTECTION · GDPR</span>
        <h1 className="display" style={{ marginTop: 16, maxWidth: 600 }}>
          Privacy<br /><span className="text-gradient">policy</span>
        </h1>
        <p style={{ marginTop: 20, fontSize: 15, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 560 }}>
          BlueGenji only collects the data needed to run the platform and to measure how much it is visited.
          No resale of data, no advertising tracker, no third-party analytics tool, no targeted advertising.
          Site traffic is measured by the site itself: see <a href="#audience">Audience measurement</a>.
        </p>
        <TranslationNotice frenchHref="/rgpd" />
      </section>

      {/* SECTION 01 — CONTROLLER */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 01</span>
            <h2 className={styles.sectionTitle}>Data controller</h2>
          </div>
          <span className={styles.meta}>WHO PROCESSES YOUR DATA</span>
        </header>
        <div className={styles.prose}>
          <p>
            The <strong>{ASSOCIATION_NAME}</strong> association — a French nonprofit (law of 1901),
            registered office: <span lang="fr">{ASSOCIATION_SEAT}</span>.
          </p>
          <p>
            Email: <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="of the association" />
            {" · "}Phone: <ProtectedContact encoded={ASSOCIATION_PHONE_ENCODED} kind="phone" owner="of the association" />
          </p>
          <p>
            Person to contact for your requests regarding your data: <strong>{DATA_CONTACT_NAME}</strong>,{" "}
            {DATA_CONTACT_ROLE_EN}. Email:{" "}
            <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`of ${DATA_CONTACT_NAME}`} />
            {" · "}Phone:{" "}
            <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`of ${DATA_CONTACT_NAME}`} />
          </p>
          <p>
            He is not a data protection officer within the meaning of Article 37 of the GDPR: the association
            remains the data controller. You can also make a request by the means given in section&nbsp;11.
          </p>
        </div>
      </section>

      {/* SECTION 02 — DATA COLLECTED */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 02</span>
            <h2 className={styles.sectionTitle}>Data collected</h2>
          </div>
          <span className={styles.meta}>WHAT WE STORE</span>
        </header>
        <div className={styles.prose}>
          <p>
            The player account asks for no real name, no phone number, no postal address: it relies on game
            usernames. Three exceptions, outside the account: a copyright report states its author&apos;s name; a
            request regarding your data sent by email or by phone carries its sender&apos;s address or number,
            and often their name; and the board members and volunteers presented on the site appear there under
            their name, with their agreement (register, T07 and T11). Google sends the name of your account with
            your picture: since September 30, 2026, it is neither used nor kept, an account created through
            Google receives a neutral username that you replace in My profile, and the picture copied from
            Google or Discord stays hidden until you choose to show it. An account created through Google
            before that date may have received the name of that account as its username, and its Google picture
            may have been copied and displayed: nothing was changed there automatically. Each account linked to
            Google and created before that date is informed of this once at its next visit, and can change its
            username and picture, or hide the latter, in My profile.
          </p>
          <p>
            <strong>Mandatory and optional data.</strong> To exist, an account only needs a means of logging in
            — the Google, Discord or Blizzard identifier of the chosen provider — and a site username, assigned
            automatically at creation. Without a means of logging in, no account can be created: public pages
            remain readable, but you can neither join a team nor register for a tournament. The provider also
            sends what the table describes for it, which comes with the login: the Discord username from
            Discord, the BattleTag from Blizzard (kept up to date at each login as long as the Battle.net
            account is linked), the picture from Google or Discord (copied, and hidden until you show it). What
            you fill in yourself (game usernames entered, certification of the Discord tag, uploaded avatar,
            adulthood) is optional, and the account works without it, with two limits: a tournament may require,
            to register, a certified Discord tag or a linked Battle.net account, and a member of the streaming
            staff cannot register as the caster of a match without both.
          </p>
          <p id="age-minimum">
            <strong>Minimum age.</strong> You must be at least {SITE_MINIMUM_AGE} years old to create an account
            (<LocaleLink href={`${TERMS_PATH}#compte`}>terms of use</LocaleLink>). This is the association&apos;s
            choice: it uses the threshold below which a minor cannot consent alone to processing based on their
            consent for an online service (article 45 of the French Data Protection Act,{" "}
            <span lang="fr">loi Informatique et Libertés</span>), which is the case of the optional profile data;
            the account itself is based on the performance of the terms of use. The site does not ask for a date
            of birth and does not check age; adulthood, which is optional, remains a mere declaration. Membership
            of the association, separate from the account, follows the age requirement of its bylaws.
          </p>
        </div>
        <table role="table" className={styles.dataTable} style={{ marginTop: 24 }}>
          <thead role="rowgroup">{/* NOSONAR S6822 — `display: block` retire la sémantique de tableau */}
            <tr role="row">
              {DATA_COLUMNS.map((column) => (
                <th key={column} role="columnheader" scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">{/* NOSONAR S6822 — `display: block` retire la sémantique de tableau */}
            {DONNEES_PROFIL_EN.map((entry) => (
              <DataRow key={entry.donnee} entry={entry} />
            ))}
            <DataRow entry={DONNEE_TOURNOIS_EN} accent />
            <DataRow entry={DONNEE_SAUVEGARDES_EN} accent mark=" **" />
            <DataRow entry={DONNEE_CONNEXIONS_EN} accent mark=" ***" />
          </tbody>
        </table>
        <p style={{ marginTop: 16, ...NOTE_STYLE }}>
          * An account that has played no match, organized no tournament, owns no team and is registered for no
          solo tournament is <strong>entirely erased</strong> when it is deleted, apart from connection data
          (***). Otherwise, its profile data is erased immediately and its username replaced by a borrowed
          username. Sessions (<code>bg_session</code> cookie) expire 30 days after login.
        </p>
        <p style={{ marginTop: 8, ...NOTE_STYLE }}>
          ** Deleted data remains for up to {BACKUP_RETENTION_DAYS} days in the encrypted backup copies, which
          cannot be edited one by one. If one of them ever had to be restored, the <strong>account
          deletions</strong> made since are applied again before the service resumes; other erasures after the
          archive (a tag or BattleTag removed, a means of logging in unlinked, a visibility or notification
          setting changed, a report purged…) are not, and would come back with it. Uploaded images (avatar,
          logo) are removed from the backup within the hour.
        </p>
        <p id="donnees-connexion" style={{ marginTop: 8, ...NOTE_STYLE }}>
          *** At each login, the site notes the IP address retained by its proxy server, the date and time, and
          the means of logging in used. This data is kept for {CONNECTION_LOG_RETENTION_DAYS} days,{" "}
          <strong>even after the account is deleted</strong>, then erased: the association keeps it as the
          hosting provider of the content its members publish (logos, avatars, team names). No screen of the
          site displays it; it is only disclosed to a judicial authority that requests it. You find it in the
          export of your data as long as your account exists. Only logins are recorded: neither the source port
          of the connection, nor the creation or modification of content. The information provided when the
          account was created (username, provider identifiers) leaves with it; apart from this log, only the
          anonymized account (borrowed username) survives, with its tournament and team history, if it has one
          — subject to the encrypted backup copies (**), which erase themselves after {BACKUP_RETENTION_DAYS}{" "}
          days, to the record of the deletion in the log that replays it after a restoration (account number and
          creation date, {ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days), and to the reports you sent, detached
          from your account but kept until their own deadline (section <a href="#signalements">“Reports”</a>);
          for a staff member, their refereeing actions remain named in the server logs, according to their
          rotation (<LocaleLink href="/rgpd/registre#t05">register, T05</LocaleLink>). The web server also keeps,
          for {WEB_ACCESS_LOG_RETENTION_DAYS} days at most, a technical log of each request (
          {WEB_ACCESS_LOG_FIELDS_EN}), for its security (<LocaleLink href="/rgpd/registre#t17">register, T17</LocaleLink>
          ).
        </p>
      </section>

      {/* SECTION 03 — HISTORY & ACHIEVEMENTS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 03</span>
            <h2 className={styles.sectionTitle}>Tournament history & achievements</h2>
          </div>
          <span className={styles.meta}>LEGITIMATE INTEREST</span>
        </header>
        <div className={styles.prose}>
          <p>
            Competition results (scores, rankings, brackets) form a <strong>sporting record</strong>. As such,
            keeping them indefinitely is based on the association&apos;s <strong>legitimate interest</strong> and
            the collective memory of the French-speaking esports scene.
          </p>
          <p>
            Since October 2026, a score is entered <strong>map by map</strong>: each map carries the{" "}
            <strong>replay code</strong> of the game (the referees may do without it when the replay is lost), which
            makes it possible to watch it again in game — and so
            to read there the in-game identifiers of the players present, including a BattleTag hidden on the
            site. These codes are visible to the site&apos;s logged-in members on the tournament page once
            recorded by the referees or retained as the result, so that a match streamed live and one that is not
            offer the same information — while a team proposal is pending, only the two teams of the match and
            the referees can read it —, and kept with the result they document (a detail that no longer explains
            it is erased); the account that entered them is only linked internally, and that link disappears
            when the account is deleted. The game itself is kept by the game&apos;s publisher: deleting your
            account here does not erase your in-game identifiers from a replay, and the codes remain attached to
            the result they document. The maps you entered appear in the export of your data.
          </p>
          <p id="suivi-sans-compte">
            <strong>Following a tournament without an account.</strong> Since October 2026, the page of a
            published tournament can also be viewed without logging in, at <code>/suivre/tournois/…</code>:
            bracket, scores, rankings, names of the teams and usernames of the players taking part, username of a
            match&apos;s caster — what streams and Discord already show. Replay codes are not shown there: they
            remain reserved to logged-in members. This page is excluded from search engines (<code>noindex</code>)
            and opens no session; the visitor&apos;s IP address is only used there, in memory, to limit the number
            of reads, and is not recorded. You can object to your username being displayed (see “Your rights”).
          </p>
        </div>
        <div className={styles.highlight} style={{ marginTop: 20 }}>
          <strong>What this means in practice:</strong> statistics (number of tournaments played, scores,
          placements) are not erased when the account is deleted. On the other hand, everything that identifies
          the person is erased (Discord and game tags, login accounts, avatar, adulthood, roles — the only
          exception being the replay codes described above) and the username is replaced by a randomly drawn{" "}
          <strong>borrowed username</strong>: the record remains under this false name, and the player&apos;s
          page states that the account has been deleted. An account that has never played a match has no record
          to preserve: it is erased entirely, with no remaining row — with three exceptions, where its row
          remains because it is the holder of something that survives: if it has <strong>organized</strong> a
          tournament, if it is the <strong>owner of a team</strong> (transferring or disbanding the team before
          deletion restores complete erasure), or if it is registered for a <strong>solo tournament</strong>,
          whose entry bears its name.
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            <strong>Why legitimate interest.</strong> The interest pursued is to keep accurate the results,
            rankings and achievements, which also belong to the teams and players who competed for them: erasing a
            player&apos;s matches would rewrite the record of their teammates and opponents. What you should know:
          </p>
          <ul>
            <li>
              <strong>Pseudonymization, not anonymization:</strong> a username, a BattleTag or a Discord tag are
              personal data (online identifiers). The borrowed username replaces yours, but the record kept remains
              attached to rosters and to a team history through which you can, sometimes, still be recognized.
            </li>
            <li>
              <strong>Period:</strong> no retention period is defined for these results: they remain as long as the
              site exists. When an account is deleted, they are anonymized — the borrowed username described above
              replaces yours.
            </li>
            <li>
              <strong>Prior information:</strong> this policy informs users before any registration.
            </li>
            <li>
              <strong>Right to object:</strong> you can object to this retention by contacting us. Each request is
              examined in the light of article 21 of the GDPR: retention stops, unless there are compelling
              legitimate grounds that override your interests, rights and freedoms.
            </li>
          </ul>
        </div>
      </section>

      {/* SECTION 04 — YOUR RIGHTS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 04</span>
            <h2 className={styles.sectionTitle}>Your rights</h2>
          </div>
          <span className={styles.meta}>GDPR ART. 7.3, 15–21 · FRENCH DATA PROTECTION ACT ART. 85</span>
        </header>
        <ul className={styles.rightsList}>
          {DROITS_EN.map((droit, i) => (
            <li key={droit.title} className={styles.rightItem}>
              <span className={styles.rightNum}>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className={styles.rightTitle}>{droit.title}</h3>
                <p className={styles.rightText}>{droit.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* SECTION 05 — COOKIES */}
      <section id="cookies" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 05</span>
            <h2 className={styles.sectionTitle}>Cookies & trackers</h2>
          </div>
          <span className={styles.meta}>NO THIRD-PARTY COOKIES</span>
        </header>
        <div className={styles.prose}>
          <p>
            BlueGenji uses <strong>no advertising cookie, no third-party analytics tracker</strong> (Google
            Analytics, Meta Pixel, etc.). The site&apos;s audience measurement sets no measurement cookie (only
            your possible objection is remembered by a cookie): it is described <a href="#audience">below</a>.
          </p>
          <p>
            Here is the list of everything the site sets or reads in your browser (cookies, local storage, session
            storage, cache):
          </p>
          <ul>
            <li>
              <strong>bg_session</strong> — httpOnly, sameSite=lax session cookie, lasting 30 days, set{" "}
              <strong>at login</strong>. It only contains a random token, which says nothing about you and allows
              you to be recognized on the platform; our servers only keep its hash (SHA-256), never the token
              itself. It is deleted at logout.
            </li>
            <li>
              <strong>bg_oauth</strong> — set <strong>for the duration of a login</strong> through Google, Discord
              or Blizzard, and deleted on return. It lasts ten minutes at most and only contains a single-use random
              token (anti-CSRF protection), the provider&apos;s name, the page to bring you back to, the purpose of
              the login (logging in or linking an account) and whether you accepted the terms of use. No personal
              identifier.
            </li>
            <li>
              <strong>bg_suspension_notice</strong> — set only <strong>if a login is refused because your account
              is suspended</strong>, to display the decision on the login page, which erases it as soon as it is
              first read (ten minutes at most if it is never read). It only contains the reference of the decision,
              the facts relied on, the clause invoked and the expiry; it is readable only by the server (httpOnly).
            </li>
            <li>
              <strong>bg_recr_modal</strong> and <strong>bg_recr_banner</strong> — set only{" "}
              <strong>when the window of urgent recruitment announcements is shown to you</strong> (the first) or{" "}
              <strong>if you close the recruitment banner</strong> (the second), so as not to show them to you
              again. They only contain the numbers of the announcements concerned, never a personal identifier:
              they allow neither recognizing you nor following you from one site to another (sameSite=strict). The
              first lasts seven days, the second the duration of your visit.
            </li>
            <li>
              <strong>bg_terms_later</strong> — set only <strong>if you postpone accepting the terms of
              use</strong> (“Later” button), so as not to ask you again on every page. It only contains the value
              “1”, never a personal identifier, lasts twelve hours at most, and disappears earlier at each login or
              logout, or as soon as you accept.
            </li>
            <li>
              <strong>bg_a11y</strong> — set only <strong>if you turn on an accessibility setting</strong> (button
              on the left edge of the screen: contrast, font, focus…), to apply it as soon as the following pages
              are displayed. It only contains the list of chosen settings, never a personal identifier, lasts one
              year and disappears when you turn them all off.
            </li>
            <li>
              <strong>bg_match_focus</strong> and <strong>bg_power_ignore_perf</strong> — two values of your
              browser&apos;s local storage, <strong>never sent</strong> to the server. The first lightens the
              site&apos;s other tabs during your match (a randomly drawn tab number and a deadline of twenty minutes
              at most); the second remembers your choice to ignore the eco mode&apos;s performance detection.
            </li>
            <li>
              <strong>bg:last-visit-ping</strong> — a session storage value, erased when the tab is closed: the time
              of the last visit report, so as not to count the same load twice. It identifies no one and is never
              sent; what the server receives from a visit is described under{" "}
              <a href="#audience">Audience measurement</a>.
            </li>
            <li>
              <strong>bg_audience_optout</strong> — set only <strong>if you object to audience
              measurement</strong> (button of the <a href="#audience">Audience measurement</a> section), so as to
              stop reporting and recording your visits. It only contains the value “1”, never a personal
              identifier, lasts {AUDIENCE_OPT_OUT_MAX_AGE_DAYS} days (thirteen months) and disappears if you turn
              measurement back on.
            </li>
            <li>
              <strong>bg_match_launch_dismissed</strong> — a session storage value, erased when the tab is closed,
              set <strong>if you close the launch window of a match</strong>: the match number and the step of its
              launch, so as not to reopen it in that tab. Never sent to the server.
            </li>
            <li>
              <strong>bg_lazy_chunk_reload_at</strong> — a session storage value, erased when the tab is closed,
              set only <strong>if part of a tournament page could not load</strong> (after an update of the site):
              the time of the automatic reload that followed, so as not to reload more than once a minute. Never
              sent to the server.
            </li>
            <li>
              <strong>bg_rgpd_consent</strong> and <strong>bg_terms_consent</strong> — two local storage values,
              set on the login page <strong>when you continue</strong> after reading the information about your
              data and accepting the terms of use, so as not to present them to you again. They only contain a
              version number: a new version presents them to you again. The acceptance of the terms is also kept
              on our servers, with its version number, as soon as your account exists.
            </li>
            <li>
              <strong>Service worker and “bg-offline” cache</strong> — the site installs in your browser,{" "}
              <strong>for every visitor</strong>, a small program (
              {/* NOSONAR S6772 — accolé voulu : « (/push-sw.js) » */}
              <code>/push-sw.js</code>) that caches a single page, the site&apos;s “offline” page, displayed instead
              of the browser&apos;s error when the network is down. This cache only contains that page, identical
              for everyone: no data about you. The same program receives notifications, only if you turn them on
              (see <a href="#notifications">Notifications</a>). It remains until you clear the site&apos;s data in
              your browser.
            </li>
          </ul>
          <p>
            <strong>bg:last-visit-ping</strong> is part of audience measurement, whose conditions are described
            below: it falls within the exemption provided by the CNIL (the French data protection authority) for
            audience measurement trackers (guidelines of September 17, 2020), which requires a means of objecting
            and limited retention periods — both are described below. The other items do not require your
            consent: article 82 of the French Data Protection Act (<span lang="fr">loi Informatique et
            Libertés</span>) exempts trackers that are strictly necessary for the service you request, or whose
            sole purpose is to enable it. None of them is used for advertising or for tracking from one site to
            another.
          </p>
          <p>
            <strong>No third-party service is loaded in your browser</strong>, and no third-party cookie is set.
            Logging in through Google, Discord or Blizzard takes you to the provider&apos;s page, which brings you
            back here: the exchange that follows takes place between our server and theirs.
          </p>
        </div>
      </section>

      {/* AUDIENCE MEASUREMENT — register T06 */}
      <section id="audience" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 06 · AUDIENCE MEASUREMENT</span>
            <h2 className={styles.sectionTitle}>Audience measurement</h2>
          </div>
          <span className={styles.meta}>REGISTER T06</span>
        </header>
        <div className={styles.prose}>
          <p>
            <strong>Purpose.</strong> Knowing how much the site is visited: number of visits over 24 hours, 7
            days, 30 days and since the launch, and of unique visitors over 24 hours, 7 days, 30 days and{" "}
            {SITE_VISITOR_RETENTION_MONTHS} months. No third-party tool is used, and none of it is used for
            advertising.
          </p>
          <p>
            <strong>What is sent.</strong> When you arrive on the site, through any page (including the login
            page, before any account is created), your browser reports the path of that page to the server,
            without its parameters. Navigating from one page to another does not do so, and the same tab normally
            does not do it again for {SITE_VISIT_WINDOW_MINUTES} minutes; on the server side, several arrivals within{" "}
            {SITE_VISIT_WINDOW_MINUTES} minutes count as a single visit.
          </p>
          <p>
            <strong>What is recorded.</strong> The server computes a hash (SHA-256) mixed with a secret that only it
            holds: it is derived from your account if you are logged in, otherwise from your IP address and your
            browser (user-agent). It records this hash, the page, the date and a “logged-in visitor” indicator (yes
            or no). Your IP address, your browser and your account identifier are never recorded as such.
          </p>
          <p>
            <strong>Pseudonymized data, not anonymous.</strong> Without the secret, no one can link a hash to a
            person. But the association holds it: it can recompute the hash of an account, or of an IP address
            combined with a browser, and find the corresponding visits. These hashes are therefore personal data
            within the meaning of the GDPR.
          </p>
          <p>
            <strong>Legal basis.</strong> The association&apos;s legitimate interest in knowing how much its site is
            visited (art. 6.1.f of the GDPR).
          </p>
          <p>
            <strong>Retention period.</strong> Visit details (hash, page, date) are erased after{" "}
            {SITE_VISIT_DETAIL_RETENTION_DAYS} days, after being added to a daily counter that only keeps the number
            of visits. To count unique visitors, the site also keeps one hash per visitor, without page but with the
            “logged-in visitor” indicator and the date of the last visit: it is erased{" "}
            <strong>{SITE_VISITOR_RETENTION_MONTHS} months after that last visit</strong> — including after an
            account is deleted, which does not erase it sooner. Hashes recorded before this rule are dated from when
            it was introduced, as their last visit had not been kept.
          </p>
          <p>
            <strong>Recipients.</strong> The association&apos;s staff. The totals (numbers of visits and visitors,
            without any hash) are also displayed by the Discord bot&apos;s <code>/stats-site</code> command, open to
            any member of a server where the bot is installed.
          </p>
          <p>
            <strong>Your right to object.</strong> You can object to this measurement (art. 21 of the GDPR) without
            having to ask. The site respects your browser&apos;s <strong>Global Privacy Control</strong> and{" "}
            <strong>Do Not Track</strong> signals, and the button below remembers your choice in this browser
            (<strong>bg_audience_optout</strong> cookie). A refused visit is not recorded: the server reads these
            signals itself. It is not even reported to the server when your browser exposes them to the page, as
            most do (an extension that only adds the header lets the report go, which the server then discards
            without computing anything). The objection applies to your future visits; for visits already recorded,
            the right is exercised like your other rights, by the means given in the{" "}
            <a href="#exercer-vos-droits">“Exercising your rights”</a> section.
          </p>
          <AudienceOptOutControl initialReason={audienceOptOut} text={audience} />
        </div>
      </section>

      {/* REPORTS — copyright, appeals, hiding a logo or an avatar */}
      <section id="signalements" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 07 · REPORTS</span>
            <h2 className={styles.sectionTitle}>Reports, copyright and appeals</h2>
          </div>
          <span className={styles.meta}>DSA ART. 16 AND 20</span>
        </header>
        <div className={styles.prose}>
          <h3>1. Reporting a problem</h3>
          <p>
            The <strong>“{REPORT_FORM_NAME_EN}”</strong> button, at the bottom of every page, is open to{" "}
            <strong>everyone</strong>, with or without an account. You choose a category — copyright (
            <span lang="fr">« Droit d&apos;auteur »</span>), moderation (<span lang="fr">« Modération »</span>), bug,
            GDPR (<span lang="fr">« RGPD »</span>), host (<span lang="fr">« Hébergeur »</span>), other (
            <span lang="fr">« Autre »</span>) —, describe the problem and, when logged in, designate the players, teams or
            tournaments concerned. A <strong>copyright</strong> report states {copyrightNoticeElementsTextEn()}: this
            is what the EU Digital Services Act requires of a notice of illegal content (art. 16).{" "}
            <EnglishLegalText text={NOTIFIER_FOLLOW_UP_EN} /> <strong>In-game behavior</strong> (insults, cheating, unsportsmanlike play, dispute on
            Discord) is not reported through this form but on the{" "}
            <a href={MODERATION_SUPPORT_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              association&apos;s support portal
            </a>{" "}
            (hosted by Spiceworks): the site sends nothing there, it is reached through a simple link. A ticket is
            kept there for as long as it takes to handle it, then {monthsEn(SUPPORT_TICKET_RETENTION_MONTHS)} after
            it is closed (<LocaleLink href="/rgpd/registre#t15">register, T15</LocaleLink>).
          </p>
          <ul>
            <li>
              <strong>Data</strong>: the category, the description, the items designated, the page the report comes
              from, the reporter&apos;s account if they are logged in, and the name and email address they provide.
            </li>
            <li>
              <strong>Legal basis</strong>: <strong>legal obligation</strong> for a request to exercise rights (GDPR
              category — GDPR, art. 6.1.c and 12), a notice of illegal content (copyright or moderation of content on
              the site — EU Digital Services Act, art. 16), a request sent to the hosting provider (art. 11 and 16) and an appeal
              (art. 20): no agreement box is asked for, the request is handled. For the other categories (bug,
              other), <strong>consent</strong>, collected by a box when sending and withdrawable through the GDPR
              category. The moderation decisions that follow on content or an account contrary to the terms of use
              (hiding, removal, suspension) are based, for their part, on the association&apos;s{" "}
              <strong>legitimate interest</strong> in enforcing its rules.
            </li>
            <li>
              <strong>Reply</strong>: a GDPR request, a request sent to the hosting provider, or an appeal requires an email
              address, except from an account whose Discord tag is certified — the site sends no email, the reply
              comes from the association, to the address provided or on Discord.
            </li>
            <li>
              <strong>Recipients</strong>: the association&apos;s administrators. An alert goes out on Discord (staff
              channel, direct message to the owner and the president) without the reporter&apos;s name, address or
              description, and without any player&apos;s username.
            </li>
            <li>
              <strong>Period</strong>: the time it takes to handle it, then {REPORT_RETENTION_DAYS_AFTER_RESOLUTION}{" "}
              days after archiving — extended as long as a logo or avatar hidden or deleted on the basis of the report
              can still be contested by its team or player, and raised to {LOGO_QUARANTINE_MONTHS} calendar months
              after archiving for a copyright or moderation report sent from an account, so that its author can
              contest the decision. A deleted account does not leave its username there.
            </li>
          </ul>

          <h3>2. The persons targeted are notified</h3>
          <p>
            The players designated and the members of the teams designated receive a{" "}
            <strong>Discord direct message</strong> (if they have linked their Discord account or certified their
            tag) that leads to the report&apos;s page. There they read the reason and the description —{" "}
            <strong>never the reporter&apos;s identity</strong> (neither account, nor name, nor email address) — and only
            the items that concern them. So that repeated sending does not make the bot write in a loop, a person
            already targeted by another report less than {REPORT_TARGET_NOTICE_COOLDOWN_HOURS} hours earlier is not
            notified a second time: the new report remains viewable and can be contested through the form (“Appeal”
            category, <span lang="fr">« Contestation »</span>).
          </p>

          <h3>3. The right to contest</h3>
          <p>
            A person targeted can contest — a designated player, or a current member of a designated team —, from
            the report&apos;s page or through the <strong>“Appeal”</strong> category (
            <span lang="fr">« Contestation »</span>) of the same form. The author of a copyright or moderation report
            can, for their part, contest the decision taken — including a decision not to act — through the same
            category, once the report has been archived, if they sent it from their account. The appeal is filed
            under the original report and read by the administrators, who are notified of it on Discord. Contesting
            an <strong>already archived report reopens it</strong>. Neither the author of the report nor the persons
            targeted are informed of the appeal; it is kept and erased with the report it concerns.
          </p>

          <h3>4. A reported logo or avatar: hidden, then restored or deleted</h3>
          <p>
            Rather than immediately deleting a reported team logo or player avatar, the association can{" "}
            <strong>hide</strong> it: it immediately stops being online (the file leaves the folder served by the
            site), and it is kept separately, offline. The team members, or the player, receive a direct message
            setting out the reasons for the decision (reason, facts relied on, clause of the terms of use invoked),
            the means of redress and the <strong>date of permanent deletion</strong>.
          </p>
          <ul>
            <li>
              <strong>Period</strong>: {LOGO_QUARANTINE_MONTHS} calendar months, counted from the hiding — the period
              for contesting a moderation decision that the EU Digital Services Act sets for online platforms (art.
              20.1), and that the association applies.
            </li>
            <li>
              <strong>Without a challenge</strong>, the image is permanently deleted when the period ends, from the
              site as from its backups.
            </li>
            <li>
              <strong>If contested</strong>, it is never deleted automatically: it awaits the association&apos;s
              decision. If the challenge succeeds, it is <strong>restored</strong> as it was and the person
              concerned is notified.
            </li>
            <li>
              <strong>Manifestly illegal</strong> content can be deleted without a hiding period. The team or the
              player is notified in the same way and can contest the decision within the same period; if the
              challenge succeeds, the image can be uploaded again.
            </li>
          </ul>
          <p>
            When removed from a team&apos;s or a player&apos;s page, outside any report, an image is removed on a{" "}
            <strong>reason entered</strong> by moderation: it is sent to the team or the player with the decision,
            and the site does not keep it.
          </p>

          <h3>5. Suspending an account</h3>
          <p>
            A member of moderation can <strong>suspend an account</strong> contrary to the terms of use, for a fixed
            or indefinite period: all its sessions are closed and no login is possible while the suspension runs.
          </p>
          <ul>
            <li>
              <strong>Data</strong>: the account targeted, the facts relied on, the clause invoked, the dates of
              start, expiry and lifting, and the member of moderation who imposed or lifted it.
            </li>
            <li>
              <strong>Legal basis</strong>: the association&apos;s <strong>legitimate interest</strong> in
              enforcing its terms of use.
            </li>
            <li>
              <strong>Information</strong>: the holder receives the decision, the facts relied on, the clause
              invoked and the means of contesting it, by Discord direct message if their account is linked to it,
              and at each login attempt during the suspension. They contest it without logging in, through “
              {REPORT_FORM_NAME_EN}” (“Other” category, <span lang="fr">« Autre »</span>), quoting the reference of
              the decision; the association reviews it, and the matter can then be brought before the competent court. The staff&apos;s
              log on Discord carries neither their username nor the reason.
            </li>
            <li>
              <strong>Period</strong>: while it runs, then {SUSPENSION_RETENTION_MONTHS} months after it is lifted or
              expires — the period for contesting —, before being erased at the first login to the site after that
              period; also erased with the account, or when it is anonymized. It appears in the export of your data,
              without the name of who imposed it.
            </li>
          </ul>
          <p>
            These rules also apply under the{" "}
            <LocaleLink href="/conditions-utilisation#signalement">terms of use</LocaleLink>, which everyone accepts
            when creating an account or a team.
          </p>
        </div>
      </section>

      <section id="notifications" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 08 · WITH YOUR AGREEMENT</span>
            <h2 className={styles.sectionTitle}>Push notifications</h2>
          </div>
        </header>
        <div className={styles.prose}>
          <p>
            You can be notified on your phone or computer of the start of your matches, of a score to confirm, of a
            tournament&apos;s kick-off, of match reminders and of what concerns your account or your team.{" "}
            <strong>Nothing is sent without your action</strong>: notifications are turned on device by device,
            from <EnglishLegalLink href="/profil#notifications">My profile</EnglishLegalLink>, where you also choose the topics.
          </p>
          <ul>
            <li>
              <strong>What the site keeps</strong>: the subscription address your browser gives it, its encryption
              keys, the date of subscription and of the last notification delivered, and the topics you have turned
              off.
            </li>
            <li>
              <strong>Where the message goes</strong>: your browser&apos;s push service (Google, Mozilla, Apple or
              Microsoft), which receives it <strong>encrypted for your device only</strong> and cannot read it. No
              notification carries a player&apos;s username.
            </li>
            <li>
              <strong>For how long</strong>: until you turn them off, your browser revokes the subscription or you
              delete your account — and at most {PUSH_SUBSCRIPTION_RETENTION_DAYS} days without a notification
              delivered.
            </li>
          </ul>
        </div>
      </section>

      {/* RECIPIENTS AND TRANSFERS — art. 13.1.e and f */}
      <section id="destinataires" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 09 · GDPR · ARTICLES 13 AND 44 TO 46</span>
            <h2 className={styles.sectionTitle}>Recipients and transfers</h2>
          </div>
        </header>
        <div className={styles.prose}>
          <p>
            The association&apos;s site and Discord bot are hosted <strong>in France</strong>, on a Raspberry Pi
            installed in Caen, by a volunteer of the association (see the{" "}
            <LocaleLink href="/mentions-legales#hebergement">legal notice</LocaleLink>), and their encrypted backups
            are stored <strong>in Germany</strong>. Your data only leaves them for the following recipients — the
            last three only see what you exchange yourself, by email or by phone, with the association or with the
            person to contact for your requests regarding your data, without going through the site:
          </p>
          <ul>
            <li>
              <strong>Discord</strong> (United States): the bot&apos;s direct messages (login code, match reminders,
              notifications) and the staff-only channels, which carry no player username; and logging in through
              Discord, if you choose it.
            </li>
            <li>
              <strong>Google and Blizzard</strong> (United States): only if you log in through one of them, which
              authenticates you as the controller of its own processing.
            </li>
            <li>
              <strong>Your browser&apos;s push service</strong> (Google, Mozilla, Apple or Microsoft): only if you
              turn on notifications, and it only receives encrypted messages it cannot read.
            </li>
            <li>
              <strong>Hetzner</strong> (Germany): the backups, <strong>encrypted before upload</strong> with keys
              Hetzner does not hold — Hetzner stores them without being able to read them, in the European Union.
            </li>
            <li>
              <strong>Spiceworks</strong> (United States): the association&apos;s support portal, only if you open
              a ticket there or are named in one. Spiceworks is {SPICEWORKS_PROCESSOR_FRAMEWORK_EN} (
              <LocaleLink href="/rgpd/registre#t15">register, T15</LocaleLink>).
            </li>
            <li>
              <strong>Microsoft</strong> (Outlook.com): the personal mailbox of the person to contact for your
              requests regarding your data is hosted by Microsoft on a personal account, without a processing
              agreement. An email you send to {DATA_CONTACT_NAME}, and the reply he sends you by email, go through it
              without encryption of the association&apos;s own: Microsoft can therefore read them (period: section{" "}
              <a href="#exercer-vos-droits">“Exercising your rights”</a>).
            </li>
            <li>
              <strong>Google</strong> (Gmail): the association&apos;s email is a Gmail mailbox. An email you send it,
              and its reply, go through it without encryption of the association&apos;s own: Google can therefore
              read them (period: section <a href="#exercer-vos-droits">“Exercising your rights”</a>).
            </li>
            <li>
              <strong>The telephone operators</strong> of the person to contact and of the association: only if you
              call them or leave them a text or a voice message.
            </li>
          </ul>
          <p>
            <strong>Safeguards for transfers.</strong> Among these services, those that may process or host data in
            the United States — not the telephone operators — do so on the following basis:{" "}
            {transferBasisEn(ALL_TRANSFER_RECIPIENTS)}; for Spiceworks, {SPICEWORKS_SCC_FALLBACK_EN}. As for the
            streaming platforms, the site only links to their channels: it sends them nothing and embeds none of
            their players (“Match streaming” paragraph below).
          </p>
          <p>
            <strong>Backups.</strong> They are stored with {HETZNER_BACKUP_FRAMEWORK_EN}:{" "}
            <strong>no transfer outside the Union</strong>. Database archives, images, hidden logos and the deletion
            log are moreover <strong>encrypted on the Raspberry Pi before any upload</strong>, with keys held only
            by the site&apos;s host, {DATA_CONTACT_NAME}, and never sent to Hetzner; the upload is encrypted in
            transit (HTTPS/TLS).
          </p>
          <p id="retransmission">
            <strong>Match streaming.</strong> A tournament match may be streamed live and recorded on{" "}
            <strong>YouTube, Twitch or Kick</strong>, on the association&apos;s channel or a caster&apos;s.{" "}
            {STREAM_NOTICE_SHOWN_EN} This processing is based on the association&apos;s legitimate interest in
            promoting its competitions. <EnglishLegalText text={STREAM_NOTICE_OBJECTION_EN} /> A replay link that shows the player is then
            removed from the site, and a video published by the association&apos;s channel is hidden or deleted.
            Viewers, for their part, watch the stream on the platform, which processes their data as the controller
            of its own processing (<LocaleLink href="/rgpd/registre#t16">register, T16</LocaleLink>).
          </p>
          <p>The details, processing activity by processing activity, are given in the register below.</p>
        </div>
      </section>

      {/* REGISTER — public, without having to ask */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 10 · GDPR · ARTICLE 30</span>
            <h2 className={styles.sectionTitle}>Record of processing activities</h2>
          </div>
          <span className={styles.meta}>{PROCESSING_ACTIVITIES_EN.length} PROCESSING ACTIVITIES</span>
        </header>
        <div className={styles.prose}>
          <p>
            {REGISTER_SCOPE_EN}: purposes, data, retention periods, recipients, transfers and security measures. It
            is <strong>public</strong> — viewable and downloadable by anyone, without an account or a request. Here
            is each of its processing activities, with its legal basis and retention period; the details are in the
            register.
          </p>
          <p>{REGISTER_SCOPE_DETAIL_EN}</p>
          <ul className={styles.registerSummary}>
            {PROCESSING_ACTIVITIES_EN.map((activity) => (
              <li key={activity.ref}>
                <LocaleLink href={`/rgpd/registre#${activity.ref.toLowerCase()}`}>
                  <strong>
                    {activity.ref} — {activity.name}
                  </strong>
                </LocaleLink>
                : {activity.purpose}. <em>Legal basis</em>: <EnglishLegalText text={activity.legalBasis} />. <em>Retention</em>:{" "}
                <EnglishLegalText text={activity.retention.join("; ")} />.
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.registerActions}>
          <CyberButton asChild variant="primary">
            <a href="/rgpd/registre.csv" download hrefLang="fr">
              Download the register (CSV spreadsheet, in French)
            </a>
          </CyberButton>
          <LocaleLink className={styles.registerBack} href="/rgpd/registre">
            View online →
          </LocaleLink>
        </div>
      </section>

      {/* SECTION 11 — CONTACT */}
      <section id="exercer-vos-droits" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 11</span>
            <h2 className={styles.sectionTitle}>Exercising your rights</h2>
          </div>
          <span className={styles.meta}>LEGAL DEADLINE: 1 MONTH</span>
        </header>
        <div className={styles.prose}>
          <p>
            To exercise one of your rights or ask a question about the processing of your data, write to or phone
            the person the association has appointed for these requests, <strong>{DATA_CONTACT_NAME}</strong>,{" "}
            {DATA_CONTACT_ROLE_EN} (contact details below). The “{REPORT_FORM_NAME_EN}” form, at the bottom of every
            page, <strong>GDPR</strong> category (<span lang="fr">« RGPD »</span>), and the association&apos;s contact details (section&nbsp;01) also
            remain open. We answer within <strong>one month</strong> at most (art. 12 GDPR).
          </p>
          <p>
            A request received by email or by phone (call, text, voicemail) — its content, your address or your
            number, and often your name —, as well as the reply sent by email or by text, are kept for as long as it
            takes to handle it, then {REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed, before being
            deleted from the mailbox or phone of the person to contact (register, T11). The same applies to a request
            sent to the association&apos;s email (Gmail) or phone: kept for as long as it takes to handle it, then{" "}
            {REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed. A request made through the form follows
            the rule of the <a href="#signalements">“Reports”</a> section.
          </p>
          <p>
            This person is not a data protection officer within the meaning of Article 37 of the GDPR: the
            association remains the data controller and responsible for the answer given to your request.
          </p>
        </div>
        <div className={styles.contactBlock} style={{ marginTop: 24 }}>
          <span className={styles.contactLabel}>Person to contact for your requests regarding your data</span>
          <span className={styles.contactValue}>
            {DATA_CONTACT_NAME}, {DATA_CONTACT_ROLE_EN}
          </span>
          <span className={styles.contactSub}>
            Email:{" "}
            <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`of ${DATA_CONTACT_NAME}`} />
            {" · "}Phone:{" "}
            <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`of ${DATA_CONTACT_NAME}`} />
          </span>
          <span className={styles.contactSub}>Or the “{REPORT_FORM_NAME_EN}” form, “GDPR” category (<span lang="fr">« RGPD »</span>):</span>
          <div style={{ marginTop: 12 }}>
            <ReportProblemButton authenticated={authenticated} initialCategory="RGPD" label="Make a GDPR request" cyber />
          </div>
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            You can at any time, without first contacting us, lodge a complaint with the <strong>CNIL</strong> (
            <span lang="fr">Commission Nationale de l&apos;Informatique et des Libertés</span>, the French data
            protection authority) at{" "}
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noreferrer"
              hrefLang="fr"
              style={{ color: "var(--blue-300)", textDecoration: "underline", textDecorationColor: "rgba(90,200,255,0.3)" }}
            >
              cnil.fr
            </a>
            {/* NOSONAR S6772 — le point final suit le lien sans espace */}
            .
          </p>
          <p>
            <strong>When this policy changes</strong>, every user registered before the change is informed at their
            next visit, by a window that summarizes what changes, and, if they do not come back, by Discord direct
            message or by push notification if they have turned them on. This is information: no agreement is
            requested, and reading it does not take away any of the rights described above. What is based on your
            consent is set in “My profile”, without losing your account.
          </p>
        </div>
        <div className={styles.updateLine}>Last updated: {updatedLabel}</div>
        {history.length > 0 && (
          <details className={styles.history}>
            <summary>Version history ({history.length} changes)</summary>
            <ul>
              {history.map((change) => (
                <li key={change.id}>
                  <time dateTime={change.publishedAt}>{englishDay(change.publishedAt)}</time> — {change.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
