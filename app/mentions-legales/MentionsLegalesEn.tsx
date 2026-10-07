import type { ReactNode } from "react";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { EnglishLegalLink } from "@/components/legal/EnglishLegalLink";
import { TranslationNotice } from "@/components/legal/TranslationNotice";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { DATA_CONTACT_NAME } from "@/lib/shared/legal-contact";
import { WEB_ACCESS_LOG_RETENTION_DAYS } from "@/lib/shared/legal-durations";
import {
  AUTHORITY_CONTACT_LANGUAGES_EN,
  DATA_CONTACT_ROLE_EN,
  NOTIFIER_FOLLOW_UP_EN,
  REPORT_FORM_NAME_EN,
  WEB_ACCESS_LOG_FIELDS_EN,
  copyrightNoticeElementsTextEn,
} from "@/lib/shared/legal-text-en";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import {
  ASSOCIATION_EMAIL_ENCODED,
  ASSOCIATION_PHONE_ENCODED,
  DATA_CONTACT_EMAIL_ENCODED,
  DATA_CONTACT_PHONE_ENCODED,
} from "@/lib/shared/obfuscated-contact";
import { SITE_HOST } from "@/lib/shared/site-host";
import {
  CODE_COPYRIGHT_HOLDER,
  CODE_LICENSE_NAME,
  CODE_LICENSE_SPDX,
  CODE_LICENSE_URL,
  SOURCE_CODE_URL,
} from "@/lib/shared/source-code";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import styles from "./page.module.css";

/**
 * The legal notice in English (lot 7b, D1): a translation of the French page,
 * which prevails. Same sections, same order, same anchors — the terms of use
 * link to `#editeur`, the bot's documents to `#hebergement`. Addresses and the
 * names of French bodies stay in French (`lang="fr"`), followed by an English
 * gloss where needed.
 */
export function MentionsLegalesEn({ reglementUrl }: Readonly<{ reglementUrl: string }>) {
  return (
    <>
      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LEGAL · FRENCH NONPROFIT</span>
        <div className={styles.heroGrid}>
          <div>
            <h1 className={`display ${styles.heroTitle}`}>
              <span className="text-gradient">Legal notice</span>
            </h1>
            <TranslationNotice frenchHref="/mentions-legales" />
          </div>
          <div className={styles.heroSide}>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>PUBLISHER</span>
              <span style={{ fontSize: 17 }}>Bluegenji Esport</span>
            </div>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>STATUS</span>
              <span style={{ fontSize: 17 }}>French nonprofit (law of 1901)</span>
            </div>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>UPDATED</span>
              <span style={{ fontSize: 17 }}>September 2026</span>
            </div>
          </div>
        </div>
      </section>

      {SECTIONS_EN.map((section, index) => (
        <section key={section.title} id={section.id} className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION {String(index + 1).padStart(2, "0")}</span>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
            </div>
            <span className={styles.meta}>{section.meta}</span>
          </header>
          <div className={styles.prose}>{section.body}</div>
        </section>
      ))}

      {/* DOCUMENTS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION {String(SECTIONS_EN.length + 1).padStart(2, "0")}</span>
            <h2 className={styles.sectionTitle}>Official documents</h2>
          </div>
          <span className={styles.meta}>BYLAWS · MEMBERSHIP</span>
        </header>
        <ul className={styles.docList}>
          <li>
            <a
              href="/statuts.pdf"
              target="_blank"
              rel="noreferrer"
              hrefLang="fr"
              className={styles.docItem}
              aria-label="Bylaws of the association (in French) (PDF, new tab)"
            >
              <span>Bylaws of the association (in French)</span>
              <span className={styles.docMeta}>PDF →</span>
            </a>
          </li>
          <li>
            <a
              href={reglementUrl}
              target="_blank"
              rel="noreferrer"
              hrefLang="fr"
              className={styles.docItem}
              aria-label="Internal rules (in French) (Google Docs, new tab)"
            >
              <span>Internal rules (in French)</span>
              <span className={styles.docMeta}>DOC →</span>
            </a>
          </li>
          <li>
            <a
              href="/bulletin_adhesion.docx"
              download
              hrefLang="fr"
              className={styles.docItem}
              aria-label="Membership form (in French) (DOCX, download)"
            >
              <span>Membership form (in French)</span>
              <span className={styles.docMeta}>DOCX →</span>
            </a>
          </li>
        </ul>
        <div className={styles.ctaRow}>
          <CyberButton variant="ghost" asChild>
            <LocaleLink href="/association">Learn more about the association →</LocaleLink>
          </CyberButton>
        </div>
        <div className={styles.legal}>
          Bluegenji Esport · French nonprofit (law of 1901) · Registered office:{" "}
          <span lang="fr">4 impasse des Cyprès, 51210 Janvilliers</span>
        </div>
      </section>
    </>
  );
}

const SECTIONS_EN: { title: string; meta: string; body: ReactNode; id?: string }[] = [
  {
    // Anchor targeted by the terms of use (`ASSOCIATION_CONTACT_PATH`).
    id: "editeur",
    title: "Publisher of the site",
    meta: "PUBLICATION MANAGER",
    body: (
      <>
        <p>
          The platform is published by the <strong>Bluegenji Esport</strong> association, a
          nonprofit association governed by the French law of July 1, 1901 (
          <span lang="fr">
            loi du 1<sup>er</sup> juillet 1901
          </span>
          ) and the decree of August 16, 1901.
        </p>
        <p>
          <strong>Registered office:</strong> <span lang="fr">4 impasse des Cyprès, 51210 Janvilliers</span>, France.
        </p>
        <p>
          <strong>Registration:</strong> the association has neither an RNA number (French national
          register of associations) nor a SIREN number (French business identification number).
        </p>
        <p>
          <strong>Purpose:</strong> organizing online and LAN esports events and tournaments,
          bringing together the participating teams, training and showcasing the people of the scene,
          and live streaming the events and tournaments.
        </p>
        <p>
          <strong>Email:</strong>{" "}
          <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="of the association" />
          <br />
          <strong>Phone:</strong>{" "}
          <ProtectedContact encoded={ASSOCIATION_PHONE_ENCODED} kind="phone" owner="of the association" />
          <br />
          <strong>Discord:</strong>{" "}
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
            the association&apos;s server (new tab)
          </a>
        </p>
      </>
    ),
  },
  {
    title: "Publication director",
    meta: "PRESIDENT",
    body: (
      <p>
        The publication director is <strong>Léo Perreaut</strong>, in his capacity as President of the
        Bluegenji Esport association.
      </p>
    ),
  },
  {
    id: "hebergement",
    title: "Technical hosting",
    meta: "TECHNICAL HOST",
    body: (
      <>
        <p>
          The site and the association&apos;s Discord bot run on {SITE_HOST.machineEn}, provided and
          administered by its <strong>technical host</strong>:
        </p>
        <p>
          <strong>{SITE_HOST.name}</strong> — Private individual, volunteer of the association
          <br />
          <span lang="fr">{SITE_HOST.address}</span>
          <br />
          Phone: <ProtectedContact encoded={SITE_HOST.phoneEncoded} kind="phone" owner="of the host" />
        </p>
        <p>
          The technical host provides the machine. It should not be confused with the association,
          which is the <a href="#contenus-membres">hosting provider of its users&apos; content</a>{" "}
          within the meaning of the EU Digital Services Act.
        </p>
        <p>
          To write to the host or the publisher: <strong>“{REPORT_FORM_NAME_EN}”</strong> button at
          the bottom of every page, “Host” category (<span lang="fr">« Hébergeur »</span>).
        </p>
      </>
    ),
  },
  {
    id: "propriete-intellectuelle",
    title: "Intellectual property",
    meta: `CODE UNDER ${CODE_LICENSE_SPDX.toUpperCase()}`,
    body: (
      <>
        <p>
          <strong>Source code.</strong> The site&apos;s code is published under the free license{" "}
          <a href={CODE_LICENSE_URL} target="_blank" rel="noreferrer">
            {CODE_LICENSE_NAME} (new tab)
          </a>{" "}
          ({CODE_LICENSE_SPDX}). The copyright in this code belongs to{" "}
          <strong>{CODE_COPYRIGHT_HOLDER}</strong>. Anyone may view, copy, modify and redistribute it
          under the terms of this license, which require in particular, for a modified version offered
          online, that its source code be made available to its users under the same license. The source
          code is available on{" "}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
            GitHub (new tab)
          </a>
          {/* NOSONAR S6772 — le point suit le lien sans espace */}
          . It includes third-party components — libraries, fonts — which remain under their own
          licenses.
        </p>
        <p>
          <strong>Other elements.</strong> The editorial texts, the name, the logo and the visual
          identity of the association, as well as its official documents, are not covered by this
          license: reproducing, displaying, modifying or distributing them, in whole or in part,
          requires the permission of their rights holders.
        </p>
        <p>
          <strong>Neither the association nor the author of the code owns</strong> the content
          published by users (avatars, logos, team names and descriptions, usernames), which remains the
          property of its authors or rights holders, nor the trademarks and visuals of the games
          Overwatch (Blizzard Entertainment) and Marvel Rivals (NetEase, Marvel), which belong to their
          owners. The site is not affiliated with any of these publishers.
        </p>
      </>
    ),
  },
  {
    id: "contenus-membres",
    title: "User content and reporting",
    meta: "HOSTING PROVIDER OF CONTENT · DSA ART. 16",
    body: (
      <>
        <p>
          For the content its users publish, the association acts as the{" "}
          <strong>hosting provider of that content</strong> — distinct from the technical host, which
          provides the machine (French Act on Confidence in the Digital Economy,{" "}
          <span lang="fr">loi pour la confiance dans l&apos;économie numérique</span> or LCEN, art. 6; EU
          Digital Services Act, art. 6): it does not review it before publication, and each user
          warrants that they hold the rights to what they publish, as provided by the{" "}
          <EnglishLegalLink href={TERMS_PATH}>terms of use</EnglishLegalLink>.
        </p>
        <p>
          <strong>Anyone</strong>, user or not, can report illegal content — copyright infringement in
          particular — with the <strong>“{REPORT_FORM_NAME_EN}”</strong> button at the bottom of
          every page. A copyright notice states {copyrightNoticeElementsTextEn()}. {NOTIFIER_FOLLOW_UP_EN}
        </p>
        <p>
          A reported team logo or player avatar can be <strong>hidden</strong> without delay: it is no
          longer online, and the team or the player is notified. They then have{" "}
          <strong>{LOGO_QUARANTINE_MONTHS} months</strong> to contest from the report&apos;s page;
          without a challenge, the image is permanently deleted, and if the challenge succeeds, it is
          restored. How your data is processed in this context is detailed in the{" "}
          <EnglishLegalLink href="/rgpd#signalements">privacy policy</EnglishLegalLink>.
        </p>
        <p>
          As the hosting provider of that content, the association keeps its users&apos; connection
          data (IP address, date and time, means of logging in) for{" "}
          <strong>{CONNECTION_LOG_RETENTION_DAYS} days</strong>, including after an account is
          deleted, so that the author of content can be identified at the request of a judicial
          authority (LCEN, art. 6; French Decree No. 2021-1362). This log only records logins — neither
          the source port, nor the creation or modification of content —, and the information provided
          when an account is created is not kept after it is deleted, apart from the encrypted backup
          copies and the log that replays deletions (
          <EnglishLegalLink href="/rgpd#donnees-connexion">details</EnglishLegalLink>). The web server
          also keeps, for {WEB_ACCESS_LOG_RETENTION_DAYS} days at most and for its security only, a
          technical log of each request ({WEB_ACCESS_LOG_FIELDS_EN}), without the source port (
          <EnglishLegalLink href="/rgpd/registre#t17">register, T17</EnglishLegalLink>). This data is
          only disclosed to the authorities that request it; details are given in the{" "}
          <EnglishLegalLink href="/rgpd#donnees-connexion">privacy policy</EnglishLegalLink>.
        </p>
      </>
    ),
  },
  {
    id: "autorites",
    title: "Point of contact for authorities",
    meta: "DSA ART. 11",
    body: (
      <>
        <p>
          The authorities of the Member States, the European Commission and the European Board for
          Digital Services reach the association, as the hosting provider of its users&apos; content,
          through a <strong>single point of contact</strong>: its email,{" "}
          <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="of the association" />
          , or the <strong>“{REPORT_FORM_NAME_EN}”</strong> button at the bottom of every page, “Host”
          category (<span lang="fr">« Hébergeur »</span>).
        </p>
        <p>Accepted languages: {AUTHORITY_CONTACT_LANGUAGES_EN.join(" and ")}.</p>
      </>
    ),
  },
  {
    id: "donnees-personnelles",
    title: "Personal data",
    meta: "GDPR · REGULATION (EU) 2016/679",
    body: (
      <>
        <p>
          The information collected when an account is created and when the site is used is processed by
          the Bluegenji Esport association, the data controller, to manage your participation in its
          activities. It is not reserved to the association: what the site publishes can be read by other
          players and the public, and some data is disclosed to third-party services — Discord, Google,
          Blizzard, your browser&apos;s push service, Hetzner (Germany) for encrypted backups,
          Microsoft, without encryption of the association&apos;s own, for the mailbox of the person to
          contact for your requests, Google (Gmail) for the association&apos;s email, as well as the
          telephone operators of that person and of the association if you call them or leave them a text
          or voice message, and Spiceworks for the support portal —, within the limits described in the{" "}
          <EnglishLegalLink href="/rgpd#destinataires">“Recipients and transfers”</EnglishLegalLink>{" "}
          section of the privacy policy and, processing activity by processing activity, in its register.
        </p>
        <p>
          In accordance with the General Data Protection Regulation (GDPR — Regulation (EU) 2016/679),
          you have the right to access, rectify, erase, restrict and port the data concerning you, as
          well as the right to object to its processing, and you can set instructions regarding what
          happens to it after your death (art. 85 of the French Data Protection Act,{" "}
          <span lang="fr">loi Informatique et Libertés</span>).
        </p>
        <p>
          <strong>Person to contact for your requests regarding your data:</strong> {DATA_CONTACT_NAME},{" "}
          {DATA_CONTACT_ROLE_EN} — email:{" "}
          <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`of ${DATA_CONTACT_NAME}`} />
          , phone:{" "}
          <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`of ${DATA_CONTACT_NAME}`} />
          . Your rights can also be exercised with the “{REPORT_FORM_NAME_EN}” button at the bottom of
          every page, “GDPR” category (<span lang="fr">« RGPD »</span>), or with the association, using
          the contact details given above. This person is not a data protection officer within the
          meaning of Article 37 of the GDPR: the association remains the data controller. The details of
          the processing activities, their retention periods and their register are given in the{" "}
          <EnglishLegalLink href="/rgpd">privacy policy</EnglishLegalLink>.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    meta: "TECHNICAL COOKIES",
    body: (
      <>
        <p>
          The site only uses <strong>technical</strong> cookies: a logged-in user&apos;s session, the
          state of a login in progress, your accessibility settings and the memory of recruitment
          announcements already seen. None of them allows advertising tracking. Their full list, with the
          other data the site keeps in your browser (local storage, session storage, cache of the offline
          page) and how long it is kept, is given in the{" "}
          <EnglishLegalLink href="/rgpd#cookies">privacy policy</EnglishLegalLink>.
        </p>
        <p>
          No advertising tracker, external audience measurement tool or third-party cookie is used. Site
          traffic is measured by the site itself, without cookies: see{" "}
          <EnglishLegalLink href="/rgpd#audience">audience measurement</EnglishLegalLink>. Communication
          between your browser and the server is encrypted (HTTPS).
        </p>
      </>
    ),
  },
];
