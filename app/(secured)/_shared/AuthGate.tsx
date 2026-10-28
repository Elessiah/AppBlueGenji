"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { splitLocalePrefix } from "@/lib/shared/locales";
import { spectatorTournamentPath, tournamentIdFromMemberPath } from "@/lib/shared/spectator-view";
import { matchPageIdsFromMemberPath, matchPagePath } from "@/lib/shared/match-page";
import { CyberButton, CyberCard } from "@/components/cyber";
import frLogin from "@/messages/fr/login.json";
import styles from "./AuthGate.module.css";

/** Textes de la carte (`login.authGate`), posés par la mise en page dans la langue de la page. */
export type AuthGateText = typeof frLogin.authGate;

/**
 * Lien du bouton « Se connecter » : la page demandée — chemin, requête **et
 * ancre** — repassée à `/connexion?redirect=`. L'ancre compte : le lien de fin
 * des messages privés de match mène à `/profil#notifications`, et sans elle le
 * joueur, une fois connecté, retombait en haut de son profil, loin de
 * l'interrupteur. Elle ne se lit qu'au navigateur (jamais envoyée au serveur).
 */
export function authGateLoginHref(pathname: string, query: string, hash: string): string {
  const search = query ? `?${query}` : "";
  const anchor = hash.length > 1 && hash.startsWith("#") ? hash : "";
  const destination = pathname + search + anchor;
  return `/connexion?redirect=${encodeURIComponent(destination)}`;
}

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
  const memberPath = splitLocalePrefix(pathname).path;
  const spectatorId = tournamentIdFromMemberPath(memberPath);
  // La page d'un match se suit de même, sur sa page sans compte (`MATCH_PAGE.md`).
  const matchPage = matchPageIdsFromMemberPath(memberPath);
  let spectatorPath: string | null = null;
  if (spectatorId !== null) spectatorPath = spectatorTournamentPath(spectatorId);
  else if (matchPage !== null) spectatorPath = matchPagePath(matchPage.tournamentId, matchPage.matchId, true);
  // Ancre lue après hydratation (le rendu serveur ne la connaît pas), relue à
  // chaque changement de page ou d'ancre native — elle pose le `href` du lien
  // (clic du milieu, copie). Une navigation client qui ne change que l'ancre ne
  // déclenche ni l'un ni l'autre (`pushState`) : le clic relit donc l'ancre du
  // moment ({@link goToLogin}).
  const query = searchParams.toString();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(globalThis.location.hash);
    read();
    globalThis.addEventListener("hashchange", read);
    return () => globalThis.removeEventListener("hashchange", read);
  }, [pathname, query]);
  useEffect(() => {
    if (spectatorPath === null) return;
    // Lu à l'instant du relais : l'état `hash` n'est pas encore posé au premier effet.
    const { search, hash: anchor } = globalThis.location;
    router.replace(`${spectatorPath}${search}${anchor}`);
  }, [spectatorPath, router]);
  // Pendant le relais, aucune carte « Connexion requise » : la fiche se lit
  // sans compte, l'annoncer fermée le temps d'un rendu serait faux. Un état
  // annoncé plutôt qu'une page vide, si le relais tarde.
  if (spectatorPath !== null) {
    return (
      <output className={styles.shell}>
        <p className={styles.body}>{text.redirecting}</p>
      </output>
    );
  }

  // On ne reconstitue qu'un chemin **du site** : il vient de `usePathname`, pas
  // d'un paramètre d'URL, donc il ne peut pas désigner un autre domaine.
  // `pathname` garde le préfixe de langue (`/en/…`) : la destination revient
  // dans la langue lue, et `LocaleLink` mène à la page de connexion de cette
  // même langue (`/en/connexion` depuis une page anglaise, lot 6).
  const loginHref = authGateLoginHref(pathname, query, hash);
  const goToLogin = (event: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/Cmd/Maj-clic (nouvel onglet) : le navigateur garde la main sur le `href`.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const fresh = authGateLoginHref(pathname, query, globalThis.location.hash);
    if (fresh === loginHref) return;
    event.preventDefault();
    router.push(fresh);
  };

  return (
    <div className={styles.shell}>
      <CyberCard as="section" ticks className={styles.card}>
        <span className="eyebrow">{text.eyebrow}</span>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.body}>{text.body}</p>
        <div className={styles.actions}>
          <CyberButton asChild>
            <LocaleLink href={loginHref} onClick={goToLogin}>{text.login}</LocaleLink>
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
