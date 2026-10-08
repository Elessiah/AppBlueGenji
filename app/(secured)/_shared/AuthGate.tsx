"use client";

import { useEffect } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { splitLocalePrefix } from "@/lib/shared/locales";
import { spectatorTournamentPath, tournamentIdFromMemberPath } from "@/lib/shared/spectator-view";
import { CyberButton, CyberCard } from "@/components/cyber";
import frLogin from "@/messages/fr/login.json";
import styles from "./AuthGate.module.css";

/** Textes de la carte (`login.authGate`), posés par la mise en page dans la langue de la page. */
export type AuthGateText = typeof frLogin.authGate;

/**
 * Ce qu'un visiteur non connecté voit à la place d'une page sécurisée.
 *
 * L'espace sécurisé répondait jusqu'ici par une **redirection** vers
 * `/connexion`. Deux conséquences, l'une pour les humains et l'autre pour les
 * robots :
 *
 * - la destination était perdue en route — `redirect("/connexion")` ne portait
 *   aucun `?redirect=`, alors que la page de connexion sait le lire depuis
 *   toujours — si bien qu'un lien de tournoi partagé déposait son destinataire
 *   sur l'accueil, sans le tournoi ;
 * - une redirection n'a pas de `<head>`, donc aucun aperçu : Discord suivait le
 *   307 et affichait l'encart de la page de connexion. Aucune métadonnée écrite
 *   sur la fiche d'un tournoi n'aurait pu être vue.
 *
 * D'où cette carte, servie en `200` : l'URL demandée est conservée (le bouton
 * la repasse à `/connexion`), et les métadonnées de la page demandée sont bien
 * émises — Next résout `generateMetadata` de tout l'arbre de segments, y compris
 * quand une mise en page de tête choisit de ne pas rendre ses enfants.
 *
 * Rien du contenu protégé ne fuit : les enfants ne sont pas rendus du tout.
 *
 * Textes dans la langue de la page (lot 8a) : la mise en page serveur les lit
 * dans `login.authGate` et les passe en prop — une page anglaise n'existe que
 * pour une route traduite (`/en/tournois`), les autres restent françaises.
 * Sans prop (tests), le français.
 */
export function AuthGate({ text = frLogin.authGate }: Readonly<{ text?: AuthGateText }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useLocaleRouter();

  // La fiche d'un tournoi se suit sans compte (`docs/features/SPECTATOR_VIEW.md`).
  // L'espace sécurisé redirige déjà côté serveur ; ce relais couvre la carte
  // venue d'un **préchargement**, que Next sert sans le chemin demandé
  // (`x-pathname`) et réutilise à la navigation. Requête et ancre `#match-…`
  // suivent.
  const spectatorId = tournamentIdFromMemberPath(splitLocalePrefix(pathname).path);
  useEffect(() => {
    if (spectatorId === null) return;
    const { search, hash } = globalThis.location;
    router.replace(`${spectatorTournamentPath(spectatorId)}${search}${hash}`);
  }, [spectatorId, router]);

  // On ne reconstitue qu'un chemin **du site** : il vient de `usePathname`, pas
  // d'un paramètre d'URL, donc il ne peut pas désigner un autre domaine.
  const query = searchParams.toString();
  const search = query ? `?${query}` : "";
  const destination = `${pathname}${search}`;
  // `pathname` garde le préfixe de langue (`/en/…`) : la destination revient
  // dans la langue lue, et `LocaleLink` mène à la page de connexion de cette
  // même langue (`/en/connexion` depuis une page anglaise, lot 6).
  const loginHref = `/connexion?redirect=${encodeURIComponent(destination)}`;

  return (
    <div className={styles.shell}>
      <CyberCard as="section" ticks className={styles.card}>
        <span className="eyebrow">{text.eyebrow}</span>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.body}>{text.body}</p>
        <div className={styles.actions}>
          <CyberButton asChild>
            <LocaleLink href={loginHref}>{text.login}</LocaleLink>
          </CyberButton>
          <CyberButton variant="ghost" asChild>
            <LocaleLink href="/">{text.home}</LocaleLink>
          </CyberButton>
        </div>
        <LocaleLink href="/regles" className={`${styles.back} entity-link`}>
          {text.rules}
        </LocaleLink>
      </CyberCard>
    </div>
  );
}
