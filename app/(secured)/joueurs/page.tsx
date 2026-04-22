"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile } from "@/lib/shared/types";
import { SearchBar } from "@/components/SearchBar";
import { useToast } from "@/components/ui/toast";

export default function PlayersPage() {
  const { showError } = useToast();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        setPlayers(payload.players);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...players]
      .filter((p) => !term || p.pseudo.toLowerCase().includes(term))
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
  }, [players, search]);

  return (
    <>
      <Link href="/" className="cta-float-home home" style={{ bottom: 28, padding: "14px 20px", fontSize: 15, fontWeight: 600, background: "rgba(89,212,255,0.15)", borderColor: "rgba(89,212,255,0.3)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
        ⌂ Accueil
      </Link>
      <section className="fade-in">
      <div className="ds-header">
        <div className="ds-header-body">
          <h1 className="ds-title blue" style={{ fontSize: "clamp(32px, 3.5vw, 48px)" }}>
            Joueurs
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
            Annuaire des joueurs inscrits, triés alphabétiquement.
          </p>
          <div style={{ marginTop: 20 }}>
            <SearchBar
              value={search}
              onChange={setSearch}
              onSearch={() => {}}
              placeholder="Rechercher un joueur..."
              rgb="89, 212, 255"
            />
          </div>
        </div>
      </div>

      <div className="grid-3">
        {sorted.map((player) => (
          <Link
            key={player.id}
            href={`/joueurs/${player.id}`}
            className="ds-block"
            style={{
              borderRadius: 16,
              padding: "16px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              textDecoration: "none",
            }}
          >
            <span className="avatar-chip">
              <Image
                className="avatar"
                src={player.avatarUrl || "/vercel.svg"}
                alt={player.pseudo}
                width={36}
                height={36}
                unoptimized
                referrerPolicy="no-referrer"
              />
              <strong style={{ fontSize: 15 }}>{player.pseudo}</strong>
            </span>
            <span style={{ color: "var(--accent-blue)", fontSize: 13, fontWeight: 600 }}>Voir →</span>
          </Link>
        ))}
      </div>
      </section>
    </>
  );
}
