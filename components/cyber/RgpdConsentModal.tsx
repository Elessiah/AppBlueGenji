"use client";

import Link from "next/link";
import { CyberButton } from "@/components/cyber/CyberButton";

interface RgpdConsentModalProps {
  onAccept: () => void;
  onRefuse: () => void;
}

/**
 * Popup de consentement RGPD affiché avant toute création de compte.
 * Présente l'usage des données et exige un consentement explicite. Un refus
 * (`onRefuse`) doit ramener l'utilisateur en arrière sans qu'aucune donnée ne
 * soit enregistrée : aucune requête d'authentification n'est déclenchée tant
 * que l'utilisateur n'a pas accepté.
 */
export function RgpdConsentModal({ onAccept, onRefuse }: RgpdConsentModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rgpd-consent-title"
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
          En créant ton compte, tu acceptes que BlueGenji traite les données
          strictement nécessaires au fonctionnement de la plateforme :
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
            avatar — aucun nom réel, téléphone ni adresse. Si tu te connectes via Discord, ton{" "}
            <strong>identifiant Discord</strong> est aussi conservé pour l&apos;authentification.
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
          . Si tu refuses, aucune donnée ne sera enregistrée.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <CyberButton
            variant="primary"
            type="button"
            onClick={onAccept}
            style={{ flex: 1, minWidth: 160 }}
          >
            J&apos;accepte et je continue
          </CyberButton>
          <CyberButton
            variant="ghost"
            type="button"
            onClick={onRefuse}
            style={{ flex: 1, minWidth: 120 }}
          >
            Refuser
          </CyberButton>
        </div>
      </div>
    </div>
  );
}
