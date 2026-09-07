"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CyberButton, CyberCard } from "@/components/cyber";
import styles from "./AuthGate.module.css";

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
 */
export function AuthGate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // On ne reconstitue qu'un chemin **du site** : il vient de `usePathname`, pas
  // d'un paramètre d'URL, donc il ne peut pas désigner un autre domaine.
  const query = searchParams.toString();
  const destination = `${pathname}${query ? `?${query}` : ""}`;
  const loginHref = `/connexion?redirect=${encodeURIComponent(destination)}`;

  return (
    <div className={styles.shell}>
      <CyberCard as="section" ticks className={styles.card}>
        <span className="eyebrow">BlueGenji · Accès membre</span>
        <h1 className={styles.title}>Connexion requise</h1>
        <p className={styles.body}>
          Cette page fait partie de l&apos;espace compétitif. Connecte-toi pour la consulter : tu
          reviendras ici automatiquement.
        </p>
        <div className={styles.actions}>
          <CyberButton asChild>
            <Link href={loginHref}>Se connecter</Link>
          </CyberButton>
          <CyberButton variant="ghost" asChild>
            <Link href="/">Retour à l&apos;accueil</Link>
          </CyberButton>
        </div>
        <Link href="/regles" className={`${styles.back} entity-link`}>
          Découvrir les règles des tournois
        </Link>
      </CyberCard>
    </div>
  );
}
