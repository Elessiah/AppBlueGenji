"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ALL_TOURNAMENT_FIELDS } from "@/lib/shared/tournament-edit";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { useToast } from "@/components/ui/toast";
import {
  TournamentForm,
  defaultTournamentFormValues,
  toApiPayload,
} from "../_components/TournamentForm";

/**
 * Création d'un tournoi.
 *
 * Le formulaire lui-même vit dans `_components/TournamentForm` : il est partagé
 * avec l'édition. La page ne garde que ce qui tient à la route — garde de
 * permission, en-tête, appel réseau. À la création, tout est modifiable.
 */
export default function CreateTournamentPage() {
  const router = useRouter();
  const { showError } = useToast();

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) =>
        r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } }) : null,
      )
      .then((p) => {
        if (!can(p?.user, "tournaments")) {
          showError("Création de tournoi réservée aux arbitres et administrateurs.");
          router.replace("/tournois");
        }
      })
      .catch(() => undefined);
  }, [router, showError]);

  return (
    <>
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <section className="fade-in container">
        <div style={{ marginBottom: 28 }}>
          <Link
            href="/tournois"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--ink-mute)",
            }}
          >
            ← Tournois
          </Link>
          <h1
            className="display"
            style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px", lineHeight: 1.1 }}
          >
            Créer un tournoi
          </h1>
          <p style={{ color: "var(--ink-mute)", margin: 0, fontSize: 14 }}>
            Définis les phases temporelles, le jeu et le format de bracket.
          </p>
        </div>

        <TournamentForm
          mode="create"
          initialValues={defaultTournamentFormValues()}
          editableFields={new Set(ALL_TOURNAMENT_FIELDS)}
          submitLabel="Créer le tournoi"
          onSubmit={async (values) => {
            const response = await fetch("/api/tournaments", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(toApiPayload(values)),
            });
            const payload = (await response.json()) as { error?: string; id?: number };
            if (!response.ok || !payload.id) {
              throw new Error(payload.error || "TOURNAMENT_CREATE_FAILED");
            }
            router.push(`/tournois/${payload.id}`);
            router.refresh();
          }}
        />
      </section>
    </>
  );
}
