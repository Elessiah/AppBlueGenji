"use client";

import { useState } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber/CyberButton";
import { TERMS_CHECKBOX_LABEL, TERMS_PATH } from "@/lib/shared/terms-of-use";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";

interface RgpdConsentModalProps {
  onAccept: () => void;
  onRefuse: () => void;
}

/**
 * Popup d'entrée de `/connexion`, affichée avant toute création de compte.
 *
 * **Une information, pas un consentement** — sauf pour ce qui est réellement
 * facultatif. Les données sans lesquelles un compte n'existe pas (pseudo,
 * identifiant du fournisseur de connexion) reposent sur l'exécution du service
 * demandé (art. 6.1.b RGPD) : les faire « accepter » serait demander un
 * consentement qui n'est pas libre, puisque le refuser interdit le service. La
 * modale **informe** (art. 13) et renvoie à la politique ; ce qui s'accepte vraiment
 * a sa propre case : les conditions d'utilisation (preuve serveur,
 * `bg_terms_acceptances`).
 *
 * Revenir en arrière (`onRefuse`) ne déclenche aucune requête
 * d'authentification : rien n'est enregistré.
 */
export function RgpdConsentModal({ onAccept, onRefuse }: RgpdConsentModalProps) {
  // Les conditions d'utilisation s'acceptent **ici**, avec le traitement des
  // données : le site n'a pas de formulaire d'inscription, un compte naît à la
  // première connexion — l'entrée de cette page est donc le seul endroit où les
  // présenter avant qu'il existe. Une case à part, et non un « en continuant,
  // tu acceptes » : c'est une acceptation qu'on doit pouvoir prouver.
  const [termsChecked, setTermsChecked] = useState(false);
  // Focus initial dans la modale, tabulation piégée et défilement figé : sans
  // eux, le clavier atteignait le formulaire de connexion derrière le voile
  // avant tout consentement. `locked` : Échap ne tranche pas un consentement,
  // il faut l'un des deux boutons. Pas de portail — la modale est rendue dès
  // le rendu serveur, au niveau de `<main>`, qui ne crée aucun contexte
  // d'empilement.
  const dialogRef = useDialogBehavior({ open: true, onClose: onRefuse, locked: true });

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rgpd-consent-title"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 32,
        }}
      >
        <span className="eyebrow">PROTECTION DES DONNÉES · RGPD</span>
        <h2
          id="rgpd-consent-title"
          className="display"
          style={{ fontSize: 24, margin: "12px 0 16px" }}
        >
          Avant de continuer
        </h2>

        <p style={{ color: "var(--ink-mute)", fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
          Pour faire fonctionner ton compte, BlueGenji traite les données strictement
          nécessaires au service que tu demandes :
        </p>

        <ul
          style={{
            color: "var(--ink-mute)",
            fontSize: 13.5,
            lineHeight: 1.7,
            margin: "0 0 16px",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <li>
            Uniquement des <strong>pseudonymes</strong> (pseudo site, Discord, jeux) et un
            avatar — aucun nom réel, téléphone ni adresse : un compte créé par Google reçoit
            désormais un pseudo neutre, jamais ton nom, et la photo copiée depuis Google ou Discord reste
            masquée tant que tu ne l&apos;affiches pas. L&apos;<strong>identifiant</strong> du
            fournisseur par lequel tu te connectes (Google, Discord ou Blizzard) est aussi
            conservé pour l&apos;authentification.
          </li>
          <li>
            Tes pseudos <strong>Overwatch</strong> et <strong>Marvel Rivals</strong> servent
            seulement à permettre aux autres joueurs de t&apos;ajouter en jeu, jamais à
            établir des statistiques.
          </li>
          <li>
            <strong>Aucune revente</strong> de données, aucun traceur publicitaire, aucune
            publicité ciblée.
          </li>
          <li>
            Te connecter par Discord enregistre ton pseudo Discord <strong>sans le
            certifier</strong> : personne ne le voit tant que tu ne le certifies pas toi-même
            dans ton profil.
          </li>
          <li>
            Tu peux à tout moment exporter ou supprimer tes données depuis ton profil.
          </li>
        </ul>

        <p style={{ color: "var(--ink-dim)", fontSize: 12.5, lineHeight: 1.6, margin: "0 0 24px" }}>
          Détail complet dans notre{" "}
          <Link
            href="/rgpd"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--blue-300)", textDecoration: "underline" }}
          >
            politique de confidentialité
          </Link>
          . Si tu reviens en arrière, aucune donnée ne sera enregistrée.
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            margin: "0 0 20px",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={termsChecked}
            onChange={(event) => setTermsChecked(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            {TERMS_CHECKBOX_LABEL} (
            <Link
              href={TERMS_PATH}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue-300)", textDecoration: "underline" }}
            >
              lire les conditions
            </Link>
            ).
          </span>
        </label>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <CyberButton
            variant="primary"
            type="button"
            onClick={onAccept}
            disabled={!termsChecked}
            style={{ flex: 1, minWidth: 160 }}
          >
            Continuer
          </CyberButton>
          <CyberButton
            variant="ghost"
            type="button"
            onClick={onRefuse}
            style={{ flex: 1, minWidth: 120 }}
          >
            Revenir en arrière
          </CyberButton>
        </div>
      </div>
    </div>
  );
}
