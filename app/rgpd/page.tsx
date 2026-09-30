import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import {
  DONNEES_PROFIL,
  DONNEE_CONNEXIONS,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
} from "@/lib/shared/rgpd-policy";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_LABEL,
  DATA_CONTACT_NAME,
  DATA_CONTACT_ROLE,
  REPORT_FORM_NAME,
} from "@/lib/shared/legal-contact";
import {
  ASSOCIATION_EMAIL_ENCODED,
  ASSOCIATION_PHONE_ENCODED,
  DATA_CONTACT_EMAIL_ENCODED,
  DATA_CONTACT_PHONE_ENCODED,
} from "@/lib/shared/obfuscated-contact";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";
import { getCurrentUser } from "@/lib/server/auth";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import {
  ALL_TRANSFER_RECIPIENTS,
  ONEDRIVE_BACKUP_FRAMEWORK,
  PROCESSING_ACTIVITIES,
  REGISTER_NOT_YET_COVERED,
  REGISTER_SCOPE,
  transferBasis,
} from "@/lib/shared/processing-register";
import {
  privacyChangeDay,
  privacyPolicyUpdatedLabel,
  publishedPrivacyChanges,
} from "@/lib/shared/privacy-changes";
import {
  MODERATION_SUPPORT_PORTAL_URL,
  NOTIFIER_FOLLOW_UP,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  REPORT_TARGET_NOTICE_COOLDOWN_HOURS,
  copyrightNoticeElementsText,
} from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { SITE_MINIMUM_AGE, TERMS_PATH } from "@/lib/shared/terms-of-use";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { SITE_VISIT_DETAIL_RETENTION_DAYS, SITE_VISIT_WINDOW_MINUTES } from "@/lib/shared/site-visits";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Politique de confidentialité (RGPD)",
  description:
    "Politique de confidentialité de BlueGenji : données collectées, droits des utilisateurs, durées de conservation et contact RGPD.",
  path: "/rgpd",
});

/** Intitulés des colonnes du tableau des données, repris par chaque fiche mobile. */
const DATA_COLUMNS = ["Donnée", "Finalité", "Base légale", "Conservation"] as const;

/**
 * Cellule du tableau des données. Son intitulé n'est affiché qu'en fiche
 * (sous 640 px) et reste masqué des technologies d'assistance, qui lisent
 * déjà l'en-tête de colonne.
 */
function DataCell({ column, children }: { column: 0 | 1 | 2 | 3; children: ReactNode }) {
  return (
    <td role="cell">
      <span className={styles.cellLabel} aria-hidden="true">
        {DATA_COLUMNS[column]}
      </span>
      {children}
    </td>
  );
}

/** `2026-09-23` → `23/09/2026`. */
function frenchDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function RgpdPage() {
  // Le formulaire laisse un membre connecté désigner son compte ; un visiteur
  // l'ouvre aussi, sans cela.
  const user = await getCurrentUser().catch(() => null);
  // La date suit le dernier changement présenté aux joueurs
  // (`lib/shared/privacy-changes.ts`) : écrite à la main, elle restait en juin
  // pendant que la politique changeait.
  const today = privacyChangeDay(new Date());
  // L'historique des versions : chaque changement publié, présenté aux joueurs
  // à sa date. « Applicable depuis la création de la plateforme » disait le
  // contraire d'une politique qui a changé plusieurs fois.
  // Une entrée à public restreint (`audience`) est un avis personnel, pas une
  // version de la politique : elle ne paraît pas dans l'historique public, ni
  // dans la date qui le coiffe — les deux lisent la même liste.
  const history = publishedPrivacyChanges(today).filter((change) => !change.audience);
  const updatedLabel = privacyPolicyUpdatedLabel(today, history) ?? "septembre 2026";
  return (
    <PublicPageShell>
      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">PROTECTION DES DONNÉES · RGPD</span>
        <h1 className="display" style={{ marginTop: 16, maxWidth: 600 }}>
          Politique de<br />confidentialité
        </h1>
        <p style={{ marginTop: 20, fontSize: 15, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 560 }}>
          BlueGenji ne collecte que les données nécessaires au fonctionnement de la
          plateforme et à la mesure de sa fréquentation. Aucune revente de données, aucun traceur publicitaire, aucun
          outil d&apos;analyse tiers, aucune publicité ciblée. La fréquentation du site est
          mesurée par le site lui-même : voir{" "}
          <Link href="#audience">Mesure d&apos;audience</Link>.
        </p>
      </section>

      {/* SECTION 01 — RESPONSABLE */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 01</span>
            <h2 className={styles.sectionTitle}>Responsable du traitement</h2>
          </div>
          <span className={styles.meta}>QUI TRAITE VOS DONNÉES</span>
        </header>
        <div className={styles.prose}>
          <p>
            L&apos;association <strong>{ASSOCIATION_NAME}</strong> — association loi 1901, siège
            social : {ASSOCIATION_SEAT}.
          </p>
          <p>
            Courriel :{" "}
            <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="de l'association" />
            {" · "}Téléphone :{" "}
            <ProtectedContact encoded={ASSOCIATION_PHONE_ENCODED} kind="phone" owner="de l'association" />
          </p>
          <p>
            {DATA_CONTACT_LABEL} : <strong>{DATA_CONTACT_NAME}</strong>, {DATA_CONTACT_ROLE}.
            Courriel :{" "}
            <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`de ${DATA_CONTACT_NAME}`} />
            {" · "}Téléphone :{" "}
            <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`de ${DATA_CONTACT_NAME}`} />
          </p>
          <p>
            Il n&apos;est pas délégué à la protection des données au sens de l&apos;article 37 du
            RGPD : l&apos;association reste responsable du traitement. Les autres moyens de
            faire une demande sont indiqués en section&nbsp;11.
          </p>
        </div>
      </section>

      {/* SECTION 02 — DONNÉES COLLECTÉES */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 02</span>
            <h2 className={styles.sectionTitle}>Données collectées</h2>
          </div>
          <span className={styles.meta}>CE QUE NOUS STOCKONS</span>
        </header>
        <div className={styles.prose}>
          <p>
            Le compte joueur ne demande aucun nom réel, aucun numéro de téléphone, aucune
            adresse postale : il repose sur des pseudonymes de jeu. Deux exceptions, hors du
            compte : un signalement de droit d&apos;auteur indique le nom de son auteur, et les
            membres du bureau et les bénévoles présentés sur le site y figurent sous leur nom,
            avec leur accord (registre, T07 et T11).
            Google transmet le nom de votre compte avec votre photo : depuis le 30 septembre
            2026, il n&apos;est ni repris ni conservé, un compte créé par Google reçoit un
            pseudo neutre que vous remplacez dans Mon profil, et la photo copiée depuis
            Google ou Discord reste masquée tant que vous ne choisissez pas de l&apos;afficher.
            Un compte créé par Google avant cette date a pu recevoir le nom de ce compte
            pour pseudo, et sa photo Google a pu être copiée et affichée : rien n&apos;y a
            été changé d&apos;office. Chaque compte relié à Google et créé avant cette date
            en est informé une fois à sa prochaine visite, et peut changer son pseudo et
            sa photo, ou masquer celle-ci, dans Mon profil.
          </p>
          <p>
            <strong>Données obligatoires et facultatives.</strong> Un compte n&apos;a besoin,
            pour exister, que d&apos;un moyen de connexion — l&apos;identifiant Google, Discord
            ou Blizzard du fournisseur choisi — et d&apos;un pseudo site, attribué d&apos;office à
            la création. Sans moyen de connexion, aucun compte ne peut être créé : les pages
            publiques restent lisibles, mais on ne peut ni rejoindre une équipe ni
            s&apos;inscrire à un tournoi. Le fournisseur transmet en outre ce que le tableau
            décrit pour lui, qui vient avec la connexion : le pseudo Discord par Discord, le
            BattleTag par Blizzard (tenu à jour à chaque connexion tant que le compte
            Battle.net est rattaché), la photo par Google ou Discord (copiée, et masquée
            tant que vous ne l&apos;affichez pas). Ce que vous renseignez vous-même (pseudos de jeu
            saisis, certification du tag Discord, avatar téléversé, majorité) est facultatif,
            et le compte fonctionne sans, à deux limites près : un tournoi peut exiger, pour s&apos;y inscrire, un tag Discord certifié ou un
            compte Battle.net rattaché, et un membre du staff de diffusion ne peut
            s&apos;inscrire comme caster d&apos;un match sans les deux.
          </p>
          <p id="age-minimum">
            <strong>Âge minimum.</strong> Il faut avoir au moins {SITE_MINIMUM_AGE} ans pour
            créer un compte (<Link href={`${TERMS_PATH}#compte`}>conditions d&apos;utilisation</Link>).
            C&apos;est un choix de l&apos;association : il reprend
            le seuil en dessous duquel un mineur ne peut consentir seul à un traitement fondé sur
            son consentement pour un service en ligne (article 45 de la loi Informatique et
            Libertés), ce qui est le cas des données de profil facultatives ; le compte
            lui-même repose sur l&apos;exécution des conditions d&apos;utilisation. Le site ne
            demande pas de date de naissance et ne vérifie pas l&apos;âge ; la majorité,
            facultative, reste une simple déclaration. L&apos;adhésion à l&apos;association, distincte du
            compte, obéit à la condition d&apos;âge de ses statuts.
          </p>
        </div>
        {/* Sous 640 px, chaque ligne devient une fiche : les cellules s'empilent
            et portent leur intitulé (`DataCell`), rien n'est masqué et la page
            ne défile plus en largeur. Les rôles explicites gardent la sémantique
            de tableau que `display: block` retire dans certains navigateurs. */}
        <table role="table" className={styles.dataTable} style={{ marginTop: 24 }}>
          <thead role="rowgroup">
            <tr role="row">
              {DATA_COLUMNS.map((column) => (
                <th key={column} role="columnheader" scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {DONNEES_PROFIL.map((d, i) => (
              <tr key={i} role="row">
                <DataCell column={0}>{d.donnee}</DataCell>
                <DataCell column={1}>{d.finalite}</DataCell>
                <DataCell column={2}>
                  <span className={styles.badge}>{d.base}</span>
                </DataCell>
                <DataCell column={3}>{d.duree}</DataCell>
              </tr>
            ))}
            <tr role="row">
              <DataCell column={0}>{DONNEE_TOURNOIS.donnee}</DataCell>
              <DataCell column={1}>{DONNEE_TOURNOIS.finalite}</DataCell>
              <DataCell column={2}>
                <span className={styles.badgeAmber}>{DONNEE_TOURNOIS.base}</span>
              </DataCell>
              <DataCell column={3}>{DONNEE_TOURNOIS.duree}</DataCell>
            </tr>
            <tr role="row">
              <DataCell column={0}>{DONNEE_SAUVEGARDES.donnee}</DataCell>
              <DataCell column={1}>{DONNEE_SAUVEGARDES.finalite}</DataCell>
              <DataCell column={2}>
                <span className={styles.badgeAmber}>{DONNEE_SAUVEGARDES.base}</span>
              </DataCell>
              <DataCell column={3}>{DONNEE_SAUVEGARDES.duree} **</DataCell>
            </tr>
            <tr role="row">
              <DataCell column={0}>{DONNEE_CONNEXIONS.donnee}</DataCell>
              <DataCell column={1}>{DONNEE_CONNEXIONS.finalite}</DataCell>
              <DataCell column={2}>
                <span className={styles.badgeAmber}>{DONNEE_CONNEXIONS.base}</span>
              </DataCell>
              <DataCell column={3}>{DONNEE_CONNEXIONS.duree} ***</DataCell>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          * Un compte qui n'a joué aucun match, n'a organisé aucun tournoi, n'est
          propriétaire d'aucune équipe et n'est inscrit à aucun tournoi individuel est{" "}
          <strong>entièrement effacé</strong> à sa suppression, hors données de connexion (***).
          Sinon, ses données de profil sont effacées immédiatement et son pseudo remplacé par un
          pseudo d'emprunt. Les sessions
          (cookie <code>bg_session</code>) expirent 30 jours après la connexion.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          ** Une donnée supprimée subsiste jusqu'à {BACKUP_RETENTION_DAYS} jours dans les copies
          de sauvegarde chiffrées, qu'on ne peut pas modifier une à une. Si l'une d'elles devait
          être restaurée, les <strong>suppressions de compte</strong> intervenues depuis sont
          réappliquées avant la remise en service ; les autres effacements postérieurs à
          l'archive (un tag ou un BattleTag retiré, un moyen de connexion détaché, un réglage de
          visibilité ou de notification modifié, un signalement purgé…) ne le sont pas, et
          reviendraient avec elle. Les images téléversées (avatar, logo) sont retirées de la sauvegarde dans
          l'heure.
        </p>
        <p id="donnees-connexion" style={{ marginTop: 8, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          *** À chaque connexion, le site note l&apos;adresse IP retenue par son serveur mandataire, la
          date et l&apos;heure, et le moyen de connexion utilisé. Ces données sont gardées{" "}
          {CONNECTION_LOG_RETENTION_DAYS} jours, <strong>même après la suppression du compte</strong>,
          puis effacées : l&apos;association les conserve en tant qu&apos;hébergeur des contenus que
          ses membres publient (logos, avatars, noms d&apos;équipe). Aucun écran du site ne les
          affiche ; elles ne sont communiquées qu&apos;à une autorité judiciaire qui les requiert.
          Vous les retrouvez dans l&apos;export de vos données tant que votre compte existe.
        </p>
      </section>

      {/* SECTION 03 — HISTORIQUE & PALMARÈS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 03</span>
            <h2 className={styles.sectionTitle}>Historique de tournois & palmarès</h2>
          </div>
          <span className={styles.meta}>INTÉRÊT LÉGITIME</span>
        </header>
        <div className={styles.prose}>
          <p>
            Les résultats de compétitions (scores, classements, brackets) constituent
            un <strong>palmarès sportif</strong>. À ce titre, leur conservation indéfinie
            est fondée sur l'<strong>intérêt légitime</strong> de l'association et la
            mémoire collective de la scène esport francophone.
          </p>
        </div>
        <div className={styles.highlight} style={{ marginTop: 20 }}>
          <strong>Ce que cela signifie concrètement :</strong> les statistiques
          (nombre de tournois joués, scores, placements) ne sont pas effacées lors de
          la suppression du compte. En revanche, tout ce qui désigne la personne est effacé
          (tags Discord et de jeu, comptes de connexion, avatar, majorité, rôles) et le pseudo
          est remplacé par un <strong>pseudo d'emprunt</strong> tiré au hasard : le palmarès
          subsiste sous ce faux nom, et la fiche du joueur indique que le compte a été supprimé.
          Un compte qui n'a jamais disputé de match n'a, lui, aucun palmarès à préserver : il est effacé
          entièrement, sans ligne résiduelle — à trois réserves près, où sa ligne reste parce
          qu'elle est le titulaire de quelque chose qui survit : s'il a{" "}
          <strong>organisé</strong> un tournoi, s'il est{" "}
          <strong>propriétaire d'une équipe</strong> (transférer ou
          dissoudre l'équipe avant la suppression rétablit l'effacement complet), ou s'il est
          inscrit à un <strong>tournoi individuel</strong>, dont l'engagé porte son nom.
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            <strong>Pourquoi l&apos;intérêt légitime.</strong> L&apos;intérêt
            poursuivi est de garder exacts les résultats, classements et palmarès, qui appartiennent
            aussi aux équipes et aux joueurs qui les ont disputés : effacer les matchs d&apos;un
            joueur réécrirait le bilan de ses coéquipiers et de ses adversaires. Ce qu&apos;il faut en
            savoir :
          </p>
          <ul>
            <li>
              <strong>Pseudonymisation, pas anonymisation :</strong> un pseudo, un BattleTag ou un
              tag Discord sont des données personnelles (des identifiants en ligne). Le pseudo
              d&apos;emprunt remplace le vôtre, mais le palmarès conservé reste rattaché à des
              rosters et à un historique d&apos;équipe par lesquels on peut, parfois, encore vous
              reconnaître.
            </li>
            <li>
              <strong>Durée :</strong> aucune durée de conservation n&apos;est définie pour ces
              résultats : ils restent tant que le site existe. À la suppression d&apos;un compte,
              ils sont anonymisés — le pseudo d&apos;emprunt décrit ci-dessus remplace le vôtre.
            </li>
            <li>
              <strong>Information préalable :</strong> la présente politique informe les
              utilisateurs avant toute inscription.
            </li>
            <li>
              <strong>Droit d&apos;opposition :</strong> vous pouvez vous opposer à cette
              conservation en nous contactant. Chaque demande est examinée au regard de
              l&apos;article 21 du RGPD : la conservation cesse, sauf motifs légitimes et
              impérieux qui prévaudraient sur vos intérêts, droits et libertés.
            </li>
          </ul>
        </div>
      </section>

      {/* SECTION 04 — VOS DROITS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 04</span>
            <h2 className={styles.sectionTitle}>Vos droits</h2>
          </div>
          <span className={styles.meta}>RGPD ART. 7.3, 15–21 · LOI I&amp;L ART. 85</span>
        </header>
        <ul className={styles.rightsList}>
          {DROITS.map((droit, i) => (
            <li key={i} className={styles.rightItem}>
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
            <h2 className={styles.sectionTitle}>Cookies & traceurs</h2>
          </div>
          <span className={styles.meta}>AUCUN COOKIE TIERS</span>
        </header>
        <div className={styles.prose}>
          <p>
            BlueGenji n'utilise <strong>aucun cookie publicitaire, aucun traceur
            analytique tiers</strong> (Google Analytics, Meta Pixel, etc.). La mesure
            d&apos;audience du site n&apos;emploie aucun cookie : elle est décrite{" "}
            <Link href="#audience">plus bas</Link>.
          </p>
          <p>
            Voici la liste de tout ce que le site dépose ou lit dans votre navigateur
            (cookies, stockage local, stockage de session, cache) :
          </p>
          <ul>
            <li>
              <strong>bg_session</strong> — cookie de session httpOnly, sameSite=lax,
              durée 30 jours, déposé <strong>à la connexion</strong>. Il contient
              uniquement un jeton aléatoire, qui ne dit rien de vous et permet de vous
              reconnaître sur la plateforme ; nos serveurs n&apos;en gardent que
              l&apos;empreinte (SHA-256), jamais le jeton lui-même. Il est supprimé à la
              déconnexion.
            </li>
            <li>
              <strong>bg_oauth</strong> — déposé <strong>le temps d&apos;une connexion</strong>{" "}
              par Google, Discord ou Blizzard, et supprimé dès le retour. Il dure dix minutes
              au plus et ne contient qu&apos;un jeton aléatoire à usage unique (protection
              anti-CSRF), le nom du fournisseur, la page où vous ramener, l&apos;objet de la
              connexion (se connecter ou rattacher un compte) et si vous avez accepté les conditions
              d&apos;utilisation. Aucun identifiant de personne.
            </li>
            <li>
              <strong>bg_recr_modal</strong> et <strong>bg_recr_banner</strong> — déposés
              uniquement <strong>quand la fenêtre des annonces de recrutement urgentes vous
              est montrée</strong> (le premier) ou <strong>si vous fermez la banderole de
              recrutement</strong> (le second), pour ne pas vous les réafficher. Ils ne
              contiennent que les numéros des annonces concernées, jamais d'identifiant de
              personne : ils ne permettent ni de vous reconnaître, ni de vous suivre d'un site
              à l'autre (sameSite=strict). Le premier dure sept jours, le second le temps de
              votre visite.
            </li>
            <li>
              <strong>bg_terms_later</strong> — déposé uniquement <strong>si vous reportez
              l&apos;acceptation des conditions d&apos;utilisation</strong> (bouton « Plus tard »),
              pour ne pas vous la redemander à chaque page. Il ne contient que la valeur « 1 »,
              jamais d&apos;identifiant de personne, dure douze heures au plus, et disparaît plus
              tôt à chaque connexion ou déconnexion, ou dès que vous acceptez.
            </li>
            <li>
              <strong>bg_a11y</strong> — déposé uniquement <strong>si vous activez un réglage
              d&apos;accessibilité</strong> (bouton au bord gauche de l&apos;écran : contraste, police, focus…),
              pour l&apos;appliquer dès l&apos;affichage des pages suivantes. Il ne contient que la
              liste des réglages choisis, jamais d&apos;identifiant de personne, dure un an et
              disparaît quand vous les désactivez tous.
            </li>
            <li>
              <strong>bg_match_focus</strong> et <strong>bg_power_ignore_perf</strong> — deux
              valeurs du stockage local de votre navigateur, <strong>jamais transmises</strong> au
              serveur. La première allège les autres onglets du site pendant votre match (un
              numéro d&apos;onglet tiré au hasard et une échéance de vingt minutes au plus) ; la
              seconde retient votre choix d&apos;ignorer la détection de performances du mode éco.
            </li>
            <li>
              <strong>bg:last-visit-ping</strong> — une valeur du stockage de session, effacée à la
              fermeture de l&apos;onglet : l&apos;heure du dernier signalement de visite, pour ne pas
              compter deux fois le même chargement. Elle n&apos;identifie personne et
              n&apos;est jamais transmise ; ce que le serveur reçoit d&apos;une visite est
              décrit sous <Link href="#audience">Mesure d&apos;audience</Link>.
            </li>
            <li>
              <strong>bg_match_launch_dismissed</strong> — une valeur du stockage de session,
              effacée à la fermeture de l&apos;onglet, posée <strong>si vous fermez la fenêtre de
              lancement d&apos;un match</strong> : le numéro du match et l&apos;étape de son
              lancement, pour ne pas vous la rouvrir dans cet onglet. Jamais transmise au
              serveur.
            </li>
            <li>
              <strong>bg_lazy_chunk_reload_at</strong> — une valeur du stockage de session,
              effacée à la fermeture de l&apos;onglet, posée seulement <strong>si une partie
              de la page d&apos;un tournoi n&apos;a pas pu se charger</strong> (après une mise à
              jour du site) : l&apos;heure du rechargement automatique qui a suivi, pour ne pas
              recharger plus d&apos;une fois par minute. Jamais transmise au serveur.
            </li>
            <li>
              <strong>bg_rgpd_consent</strong> et <strong>bg_terms_consent</strong> — deux valeurs
              du stockage local, posées sur la page de connexion <strong>quand vous continuez</strong>{" "}
              après avoir lu l&apos;information sur vos données et accepté les conditions
              d&apos;utilisation, pour ne pas vous les représenter. Elles ne contiennent qu&apos;un
              numéro de version : une nouvelle version vous les présente de nouveau.
              L&apos;acceptation des conditions est aussi conservée sur nos serveurs, avec son
              numéro de version, dès que votre compte existe.
            </li>
            <li>
              <strong>Service worker et cache « bg-offline »</strong> — le site installe dans
              votre navigateur, <strong>pour tout visiteur</strong>, un petit programme (
              <code>/push-sw.js</code>) qui met en cache une seule page, la page « hors
              ligne » du site, affichée à la place de l&apos;erreur du navigateur quand le réseau
              manque. Ce cache ne contient que cette page, identique pour tous : aucune donnée
              vous concernant. Le même programme reçoit les notifications, seulement si vous
              les activez (voir <Link href="#notifications">Notifications</Link>). Il reste
              jusqu&apos;à ce que vous effaciez les données du site dans votre navigateur.
            </li>
          </ul>
          <p>
            <strong>bg:last-visit-ping</strong> relève de la mesure d&apos;audience, dont les
            conditions sont décrites ci-dessous. Les autres éléments ne demandent pas votre
            consentement : l&apos;article 82 de la loi
            Informatique et Libertés en dispense les traceurs qui sont strictement nécessaires
            au service que vous demandez, ou qui ont pour seule finalité de le permettre. Aucun
            d&apos;entre eux ne sert à la publicité ni au suivi d&apos;un site à l&apos;autre.
          </p>
          <p>
            <strong>Aucun service tiers n&apos;est chargé dans votre navigateur</strong>, et aucun
            cookie tiers n&apos;est déposé. Se connecter par Google, Discord ou Blizzard vous mène
            sur la page du fournisseur, qui vous ramène ici : l&apos;échange qui suit se fait entre
            notre serveur et le sien.
          </p>
        </div>
      </section>

      {/* MESURE D'AUDIENCE — registre T06 */}
      <section id="audience" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 06 · MESURE D&apos;AUDIENCE</span>
            <h2 className={styles.sectionTitle}>Mesure d&apos;audience</h2>
          </div>
          <span className={styles.meta}>REGISTRE T06</span>
        </header>
        <div className={styles.prose}>
          <p>
            <strong>Finalité.</strong> Connaître la fréquentation du site : nombre de visites
            et de visiteurs uniques sur 24 heures, 7 jours, 30 jours et depuis la mise en
            service. Aucun outil tiers n&apos;est employé, et rien n&apos;en sert à la publicité.
          </p>
          <p>
            <strong>Ce qui est transmis.</strong> Quand vous arrivez sur le site, par
            n&apos;importe quelle page (y compris la page de connexion, avant toute création de
            compte), votre navigateur signale au serveur le chemin de cette page, sans ses
            paramètres. La navigation d&apos;une page à l&apos;autre ne le fait pas, et un même
            onglet ne le refait normalement pas avant {SITE_VISIT_WINDOW_MINUTES} minutes ; côté serveur,
            plusieurs arrivées en {SITE_VISIT_WINDOW_MINUTES} minutes ne comptent qu&apos;une
            visite.
          </p>
          <p>
            <strong>Ce qui est enregistré.</strong> Le serveur calcule une empreinte
            (SHA-256) mêlée à un secret qu&apos;il est seul à détenir : elle est dérivée de
            votre compte si vous êtes connecté, sinon de votre adresse IP et de votre
            navigateur (user-agent). Il enregistre cette empreinte, la page, la date et un
            indicateur « visiteur connecté » (oui ou non). Votre adresse IP, votre navigateur
            et l&apos;identifiant de votre compte ne sont jamais enregistrés tels quels.
          </p>
          <p>
            <strong>Une donnée pseudonymisée, pas anonyme.</strong> Sans le secret, personne
            ne peut rattacher une empreinte à une personne. Mais l&apos;association le détient :
            elle peut recalculer l&apos;empreinte d&apos;un compte, ou d&apos;une adresse IP
            associée à un navigateur, et retrouver les visites correspondantes. Ces
            empreintes sont donc des données personnelles au sens du RGPD.
          </p>
          <p>
            <strong>Base légale.</strong> L&apos;intérêt légitime de l&apos;association à
            connaître la fréquentation de son site (art. 6.1.f du RGPD).
          </p>
          <p>
            <strong>Durée de conservation.</strong> Le détail des visites (empreinte, page,
            date) est effacé au bout de {SITE_VISIT_DETAIL_RETENTION_DAYS} jours, après avoir
            été reporté dans un compteur par jour qui ne garde que le nombre de visites. Pour
            compter les visiteurs uniques depuis la mise en service, le site garde en outre
            une empreinte par visiteur, sans page ni date mais avec l&apos;indicateur
            « visiteur connecté »,{" "}
            <strong>sans limite de durée</strong> — y compris après la suppression d&apos;un
            compte.
          </p>
          <p>
            <strong>Destinataires.</strong> Le staff de l&apos;association. Les totaux
            (nombres de visites et de visiteurs, sans aucune empreinte) sont aussi affichés
            par la commande <code>/stats-site</code> du bot Discord, ouverte à tout membre d&apos;un serveur où le bot est installé.
          </p>
          <p>
            <strong>Votre droit d&apos;opposition.</strong> Le droit de vous opposer à cette
            mesure (art. 21 du RGPD) s&apos;exerce, comme vos autres droits, par le formulaire
            « {REPORT_FORM_NAME} », catégorie RGPD, ou par le courriel de l&apos;association
            (section&nbsp;01). Le site ne sait pas encore
            l&apos;appliquer de lui-même : aucun réglage ne permet de désactiver la mesure, ni
            d&apos;en exclure vos visites à venir.
          </p>
        </div>
      </section>

      {/* SIGNALEMENTS — droit d'auteur, contestation, masquage d'un logo ou d'un avatar */}
      <section id="signalements" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 07 · SIGNALEMENTS</span>
            <h2 className={styles.sectionTitle}>Signalements, droit d&apos;auteur et contestation</h2>
          </div>
          <span className={styles.meta}>DSA ART. 16 ET 20</span>
        </header>
        <div className={styles.prose}>
          <h3>1. Signaler un problème</h3>
          <p>
            Le bouton <strong>« Signaler un problème »</strong>, en bas de chaque page, est ouvert à{" "}
            <strong>tous</strong>, avec ou sans compte. On y choisit une catégorie — droit
            d&apos;auteur, modération, bug, RGPD, hébergeur, autre —, on décrit le problème et, connecté, on désigne les
            joueurs, équipes ou tournois concernés. Un signalement de <strong>droit d&apos;auteur</strong>{" "}
            indique {copyrightNoticeElementsText()} : c&apos;est ce que le règlement européen sur les
            services numériques demande à une notification de contenu illicite (art. 16).{" "}
            {NOTIFIER_FOLLOW_UP} Un <strong>comportement en jeu</strong> (insulte, triche, anti-jeu, litige sur
            Discord) ne se signale pas par ce formulaire mais sur le{" "}
            <a href={MODERATION_SUPPORT_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              portail de support de l&apos;association
            </a>{" "}
            (hébergé par Spiceworks) : le site n&apos;y transmet rien, on le rejoint par un simple lien.
          </p>
          <ul>
            <li>
              <strong>Données</strong> : la catégorie, la description, les éléments désignés, la page
              d&apos;où part le signalement, le compte du signalant s&apos;il est connecté, et le nom et
              l&apos;adresse qu&apos;il indique.
            </li>
            <li>
              <strong>Base légale</strong> : l&apos;<strong>obligation légale</strong> pour une demande
              d&apos;exercice des droits (catégorie RGPD — RGPD, art. 6.1.c et 12), une notification de
              contenu illicite (droit d&apos;auteur ou modération d&apos;un contenu du site — règlement
              européen sur les services numériques, art. 16), une demande adressée à l&apos;hébergeur (art. 11 et 16) et une contestation
              (art. 20) : aucune case d&apos;accord n&apos;y est demandée, la demande est traitée. Pour
              les autres catégories (bug, autre), le <strong>consentement</strong>,
              recueilli par une case à l&apos;envoi et retirable par la catégorie RGPD.
            </li>
            <li>
              <strong>Réponse</strong> : une demande RGPD, adressée à l&apos;hébergeur, ou une contestation exige une
              adresse électronique, sauf d&apos;un compte dont le tag Discord est certifié — le site n&apos;envoie aucun courriel, la réponse part de l&apos;association,
              à l&apos;adresse indiquée ou sur Discord.
            </li>
            <li>
              <strong>Destinataires</strong> : les administrateurs de l&apos;association. Une alerte
              part sur Discord (salon du staff, message privé au propriétaire et au président) sans le
              nom, l&apos;adresse ni la description du signalant, et sans le pseudo d&apos;aucun joueur.
            </li>
            <li>
              <strong>Durée</strong> : le temps du traitement, puis{" "}
              {REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après l&apos;archivage — prolongée tant
              qu&apos;un logo ou un avatar masqué ou supprimé au titre du signalement peut encore être
              contesté par son équipe ou son joueur, et portée à {LOGO_QUARANTINE_MONTHS} mois civils
              après l&apos;archivage pour un signalement de droit d&apos;auteur ou de modération envoyé
              depuis un compte, le temps que son auteur puisse contester la décision. Un compte
              supprimé n&apos;y laisse pas son pseudo.
            </li>
          </ul>

          <h3>2. Les personnes visées sont prévenues</h3>
          <p>
            Les joueurs désignés et les membres des équipes désignées reçoivent un{" "}
            <strong>message privé Discord</strong> (s&apos;ils ont rattaché leur compte Discord ou
            certifié leur tag) qui mène à la page du signalement. Ils y lisent le motif et la
            description — <strong>jamais l&apos;identité du signalant</strong> (ni compte, ni nom, ni
            adresse) — et seulement les éléments qui les concernent. Pour qu&apos;un envoi répété ne
            fasse pas écrire le bot en boucle, une personne déjà visée par un autre signalement depuis
            moins de {REPORT_TARGET_NOTICE_COOLDOWN_HOURS} heures n&apos;est pas prévenue une seconde
            fois : le nouveau signalement reste consultable et contestable depuis le formulaire
            (catégorie « Contestation »).
          </p>

          <h3>3. Le droit de contestation</h3>
          <p>
            Une personne visée peut contester — un joueur désigné, ou un membre actuel d&apos;une
            équipe désignée —, depuis la page du signalement ou par la catégorie{" "}
            <strong>« Contestation »</strong> du même formulaire. L&apos;auteur d&apos;un signalement
            de droit d&apos;auteur ou de modération peut, lui, contester la décision prise — y compris
            celle de ne pas agir — par la même catégorie, une fois le signalement archivé, s&apos;il
            l&apos;a envoyé depuis son compte. La contestation est rangée sous le
            signalement d&apos;origine et lue par les administrateurs, qui en sont prévenus sur Discord.
            Contester un signalement <strong>déjà archivé le rouvre</strong>. Ni l&apos;auteur du
            signalement ni les personnes visées ne sont informés de la contestation ; elle est conservée et effacée avec
            le signalement qu&apos;elle vise.
          </p>

          <h3>4. Un logo ou un avatar signalé : masqué, puis rétabli ou supprimé</h3>
          <p>
            Plutôt que de supprimer tout de suite un logo d&apos;équipe ou un avatar de joueur signalé,
            l&apos;association peut le <strong>masquer</strong> : il cesse aussitôt d&apos;être en ligne
            (le fichier quitte le dossier servi par le site), et il est gardé à part, hors ligne. Les
            membres de l&apos;équipe, ou le joueur, reçoivent un message privé qui expose les motifs de
            la décision (motif, faits retenus, clause des conditions d&apos;utilisation invoquée), les
            voies de recours et la <strong>date de suppression définitive</strong>.
          </p>
          <ul>
            <li>
              <strong>Délai</strong> : {LOGO_QUARANTINE_MONTHS} mois civils, comptés du masquage — le
              délai de contestation d&apos;une décision de modération que le règlement européen sur les
              services numériques fixe aux plateformes en ligne (art. 20.1), et que l&apos;association
              applique.
            </li>
            <li>
              <strong>Sans contestation</strong>, l&apos;image est supprimée définitivement à
              l&apos;échéance, du site comme de ses sauvegardes.
            </li>
            <li>
              <strong>Contestée</strong>, elle n&apos;est jamais supprimée d&apos;office : elle attend la
              décision de l&apos;association. Si la contestation aboutit, elle est{" "}
              <strong>rétablie</strong> telle quelle et la personne concernée en est prévenue.
            </li>
            <li>
              Un contenu <strong>manifestement illicite</strong> peut être supprimé sans délai de
              masquage. L&apos;équipe ou le joueur en est prévenu de la même façon et peut contester la
              décision pendant le même délai ; si elle aboutit, l&apos;image peut être renvoyée.
            </li>
          </ul>
          <p>
            Ces règles s&apos;appliquent aussi au regard des{" "}
            <Link href="/conditions-utilisation#signalement">conditions d&apos;utilisation</Link>, que
            chacun accepte en créant un compte ou une équipe.
          </p>
        </div>
      </section>

      <section id="notifications" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 08 · SUR VOTRE ACCORD</span>
            <h2 className={styles.sectionTitle}>Notifications push</h2>
          </div>
        </header>
        <div className={styles.prose}>
          <p>
            Vous pouvez être prévenu sur votre téléphone ou votre ordinateur du départ de vos matchs, d&apos;un
            score à confirmer, du coup d&apos;envoi d&apos;un tournoi, des rappels de match et de ce
            qui concerne votre compte ou votre équipe. <strong>Rien ne part sans votre geste</strong> :
            les notifications s&apos;activent appareil par appareil, depuis{" "}
            <Link href="/profil#notifications">Mon profil</Link>, où vous choisissez aussi les sujets.
          </p>
          <ul>
            <li>
              <strong>Ce que le site garde</strong> : l&apos;adresse d&apos;abonnement que votre
              navigateur lui donne, ses clés de chiffrement, la date d&apos;abonnement et de la
              dernière notification remise, et les sujets que vous avez coupés.
            </li>
            <li>
              <strong>Par où passe le message</strong> : le service de push de votre navigateur
              (Google, Mozilla, Apple ou Microsoft), qui le reçoit{" "}
              <strong>chiffré pour votre seul appareil</strong> et ne peut pas le lire. Aucune
              notification ne porte le pseudo d&apos;un joueur.
            </li>
            <li>
              <strong>Combien de temps</strong> : jusqu&apos;à ce que vous les désactiviez, que votre
              navigateur révoque l&apos;abonnement ou que vous supprimiez votre compte — et au plus{" "}
              {PUSH_SUBSCRIPTION_RETENTION_DAYS} jours sans notification remise.
            </li>
          </ul>
        </div>
      </section>

      {/* DESTINATAIRES ET TRANSFERTS — art. 13.1.e et f */}
      <section id="destinataires" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 09 · RGPD · ARTICLES 13 ET 44 À 46</span>
            <h2 className={styles.sectionTitle}>Destinataires et transferts</h2>
          </div>
        </header>
        <div className={styles.prose}>
          <p>
            Le site et le bot Discord de l&apos;association sont hébergés{" "}
            <strong>en France</strong>, sur un Raspberry Pi installé à Caen, par un bénévole de
            l&apos;association (voir les{" "}
            <Link href="/mentions-legales#hebergement">mentions légales</Link>). Vos données
            n&apos;en sortent que vers les destinataires suivants :
          </p>
          <ul>
            <li>
              <strong>Discord</strong> (États-Unis) : les messages privés du bot (code de
              connexion, rappels de match, notifications) et les salons réservés au staff, qui ne
              portent aucun pseudo de joueur ; et la connexion par Discord, si vous la choisissez.
            </li>
            <li>
              <strong>Google et Blizzard</strong> (États-Unis) : seulement si vous vous connectez
              par l&apos;un d&apos;eux, qui vous authentifie en responsable de son propre traitement.
            </li>
            <li>
              <strong>Le service de push de votre navigateur</strong> (Google, Mozilla, Apple ou
              Microsoft) : seulement si vous activez les notifications, et il ne reçoit que des
              messages chiffrés qu&apos;il ne peut pas lire.
            </li>
            <li>
              <strong>Microsoft</strong> (OneDrive) : les sauvegardes, <strong>chiffrées avant
              envoi</strong> avec une clé que Microsoft ne détient pas — Microsoft les
              stocke sans pouvoir les lire.
            </li>
          </ul>
          <p>
            <strong>Encadrement des transferts.</strong> Ces services peuvent traiter ou héberger
            des données aux États-Unis. Le transfert y repose, pour chacun, sur :{" "}
            {transferBasis(ALL_TRANSFER_RECIPIENTS)}.
          </p>
          <p>
            <strong>Sauvegardes.</strong> Elles sont déposées sur le OneDrive d&apos;un{" "}
            {ONEDRIVE_BACKUP_FRAMEWORK} : le site n&apos;affirme donc aucun lieu de stockage, et un
            transfert vers les États-Unis repose sur le mécanisme de Microsoft Corporation (
            {transferBasis(["MICROSOFT"])}). Le chiffrement est une
            mesure de sécurité, qui ne tient lieu ni de contrat ni de mécanisme de transfert :
            archives de la base, images, logos masqués et journal
            des suppressions sont <strong>chiffrés sur le Raspberry Pi avant tout envoi</strong>,
            avec une clé que détient le seul responsable technique de l&apos;association — qui est
            aussi l&apos;hébergeur du site — et qui n&apos;est jamais transmise à Microsoft. Le chiffrement au repos de ses serveurs par Microsoft et le chiffrement en
            transit (HTTPS/TLS) s&apos;y ajoutent comme mesures complémentaires.
          </p>
          <p>Le détail, par traitement, figure au registre ci-dessous.</p>
        </div>
      </section>

      {/* REGISTRE — public, sans demande à faire */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 10 · RGPD · ARTICLE 30</span>
            <h2 className={styles.sectionTitle}>Registre des traitements</h2>
          </div>
          <span className={styles.meta}>{PROCESSING_ACTIVITIES.length} TRAITEMENTS</span>
        </header>
        <div className={styles.prose}>
          <p>
            {REGISTER_SCOPE} : finalités, données, durées de conservation, destinataires,
            transferts et mesures de sécurité. Il est <strong>public</strong> — consultable et
            téléchargeable par tous, sans compte ni demande. Voici chacun de ses traitements,
            avec sa base légale et sa durée de conservation ; le détail est au registre.
          </p>
          <p>{REGISTER_NOT_YET_COVERED}</p>
          {/* Lu du registre, jamais recopié : une fiche ajoutée y paraît d'elle-même. */}
          <ul className={styles.registerSummary}>
            {PROCESSING_ACTIVITIES.map((activity) => (
              <li key={activity.ref}>
                <Link href={`/rgpd/registre#${activity.ref.toLowerCase()}`}>
                  <strong>
                    {activity.ref} — {activity.name}
                  </strong>
                </Link>{" "}
                : {activity.purpose}. <em>Base légale</em> : {activity.legalBasis}.{" "}
                <em>Conservation</em> : {activity.retention.join(" ; ")}.
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.registerActions}>
          <CyberButton asChild variant="primary">
            <a href="/rgpd/registre.csv" download>
              Télécharger le registre (tableur CSV)
            </a>
          </CyberButton>
          <Link className={styles.registerBack} href="/rgpd/registre">
            Consulter en ligne →
          </Link>
        </div>
      </section>

      {/* SECTION 11 — CONTACT */}
      <section id="exercer-vos-droits" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 11</span>
            <h2 className={styles.sectionTitle}>Exercer vos droits</h2>
          </div>
          <span className={styles.meta}>DÉLAI LÉGAL : 1 MOIS</span>
        </header>
        <div className={styles.prose}>
          <p>
            Pour exercer l'un de vos droits ou poser une question relative au
            traitement de vos données, écrivez ou téléphonez à la personne que
            l&apos;association a chargée de ces demandes, <strong>{DATA_CONTACT_NAME}</strong>,{" "}
            {DATA_CONTACT_ROLE} (coordonnées ci-dessous). Le formulaire
            « {REPORT_FORM_NAME} », présent en bas de chaque page, catégorie{" "}
            <strong>RGPD</strong>, et les coordonnées de l&apos;association (section&nbsp;01)
            restent aussi ouverts. Nous répondons dans un délai maximum
            d'<strong>un mois</strong> (art. 12 RGPD).
          </p>
          <p>
            Cette personne n&apos;est pas un délégué à la protection des données au sens de
            l&apos;article 37 du RGPD : l&apos;association reste responsable du traitement et
            de la réponse apportée à votre demande.
          </p>
        </div>
        <div className={styles.contactBlock} style={{ marginTop: 24 }}>
          <span className={styles.contactLabel}>{DATA_CONTACT_LABEL}</span>
          <span className={styles.contactValue}>
            {DATA_CONTACT_NAME}, {DATA_CONTACT_ROLE}
          </span>
          <span className={styles.contactSub}>
            Courriel :{" "}
            <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`de ${DATA_CONTACT_NAME}`} />
            {" · "}Téléphone :{" "}
            <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`de ${DATA_CONTACT_NAME}`} />
          </span>
          <span className={styles.contactSub}>
            Ou formulaire « {REPORT_FORM_NAME} », catégorie RGPD :
          </span>
          <div style={{ marginTop: 12 }}>
            <ReportProblemButton
              authenticated={Boolean(user)}
              initialCategory="RGPD"
              label="Faire une demande RGPD"
              cyber
            />
          </div>
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            Vous pouvez à tout moment, sans démarche préalable auprès de nous,
            introduire une réclamation auprès de la <strong>CNIL</strong> (Commission Nationale
            de l'Informatique et des Libertés) sur{" "}
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue-300)", textDecoration: "underline", textDecorationColor: "rgba(90,200,255,0.3)" }}
            >
              cnil.fr
            </a>
            .
          </p>
          <p>
            <strong>Quand cette politique change</strong>, chaque utilisateur inscrit
            avant le changement en est informé à sa visite suivante, par une
            fenêtre qui résume ce qui change, et, s&apos;il ne revient pas, en message
            privé Discord ou par notification push s&apos;il les a activées. C&apos;est une information : aucun accord n&apos;est demandé, et la
            lire ne retire aucun des droits décrits ci-dessus. Ce qui repose sur votre
            consentement se règle dans « Mon profil », sans perdre votre compte.
          </p>
        </div>
        <div className={styles.updateLine}>
          Dernière mise à jour : {updatedLabel}
        </div>
        {history.length > 0 && (
          <details className={styles.history}>
            <summary>Historique des versions ({history.length} changements)</summary>
            <ul>
              {history.map((change) => (
                <li key={change.id}>
                  <time dateTime={change.publishedAt}>{frenchDay(change.publishedAt)}</time> —{" "}
                  {change.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </PublicPageShell>
  );
}
