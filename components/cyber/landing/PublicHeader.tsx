import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import Image from "next/image";
import { AccountMenu } from "@/components/account-menu";
import { CyberButton } from "@/components/cyber";
import { getCurrentUser } from "@/lib/server/auth";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { languageSwitcherLabel } from "@/lib/server/i18n-labels";
import { PublicNavMenu } from "./PublicNavMenu";
import styles from "./PublicHeader.module.css";

/**
 * En-tête public des pages vitrine (landing, asso, bot…).
 *
 * À gauche : le menu burger (`PublicNavMenu`) puis la marque — le menu est placé
 * avant le logo pour rester repérable au lieu d'être noyé parmi les CTA.
 *
 * Actions à droite selon l'état de session :
 * - **Connecté** : bouton « Accéder à la partie compétitive » (→ `/tournois`,
 *   l'espace sécurisé) suivi du menu du compte (`AccountMenu` : profil,
 *   équipe, déconnexion).
 * - **Déconnecté** : un seul bouton « Rejoindre » (primary) vers `/connexion`,
 *   qui sert aussi de page de connexion.
 *
 * Server component : lit la session via `getCurrentUser()` (retombe sur `null`
 * si la session est absente ou invalide).
 */
export async function PublicHeader() {
  const user = await getCurrentUser().catch(() => null);
  // L'équipe n'alimente qu'une entrée du menu du compte : une lecture ratée
  // la retire, elle ne fait pas tomber l'en-tête.
  const team = user ? await getUserActiveTeam(user.id).catch(() => null) : null;
  const activeTeam = team ? { teamId: team.teamId, teamName: team.teamName } : null;
  const switcherLabel = await languageSwitcherLabel();
  const t = await getTranslations("shell.header");

  return (
    <header className={styles.root} data-sticky-header>
      <div className={styles.inner}>
        <div className={styles.left}>
          <PublicNavMenu />
          {/*
            Aucun `aria-label` ici, et l'emblème est décoratif : le nom
            accessible du lien doit **descendre de son contenu visible**. Un
            libellé posé à la main (« BlueGenji Esport ») ne recouvrait pas le
            texte affiché — « BlueGenji » et « ESPORT » sont deux éléments, donc
            deux mots collés à la lecture —, et un lien dont le nom accessible ne
            contient pas ce qu'on lit dessus est inutilisable à la commande
            vocale : on prononce ce qui est écrit, rien ne répond (WCAG 2.5.3).
          */}
          <LocaleLink href="/" className={styles.brand}>
            <span className={styles.logo}>
              <Image src="/logo_bg.webp" alt="" width={28} height={28} />
            </span>
            <span className={styles.brandText}>
              <span className="logotype">{t("brandName")}</span>
              <span className="mono">{t("brandTagline")}</span>
            </span>
          </LocaleLink>
        </div>

        <div className={styles.actions}>
          {/* Même page dans l'autre langue — muet tant que la route n'est pas traduite. */}
          <LanguageSwitcher label={switcherLabel} />
          {user ? (
            <>
              <CyberButton variant="primary" asChild>
                <LocaleLink href="/tournois">
                  <span className={styles.ctaFull}>{t("competitionFull")}</span>
                  <span className={styles.ctaShort}>{t("competitionShort")}</span>
                </LocaleLink>
              </CyberButton>
              {/* Profil, équipe et déconnexion : le même menu que dans
                  l'espace connecté. Son nom accessible commence par le pseudo
                  affiché (WCAG 2.5.3). */}
              <AccountMenu pseudo={user.pseudo} avatarUrl={user.avatarUrl} activeTeam={activeTeam} />
            </>
          ) : (
            <CyberButton variant="primary" asChild>
              <LocaleLink href="/connexion">{t("join")}</LocaleLink>
            </CyberButton>
          )}
        </div>
      </div>
    </header>
  );
}

