"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile } from "@/lib/shared/types";
import { SearchBar } from "@/components/SearchBar";
import { useToast } from "@/components/ui/toast";
import { CyberCard, Pill } from "@/components/cyber";
import { useSetPalette } from "@/lib/palette-context";

export default function PlayersPage() {
  const { showError } = useToast();
  const setPalette = useSetPalette();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

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
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <section className="fade-in container">
        <div className="section-head">
          <div>
            <span className="eyebrow">COMMUNAUTÉ</span>
            <h1 className="display" style={{ fontSize: 56, margin: "0 0 8px" }}>
              Joueurs BlueGenji
            </h1>
            <p className="mono" style={{ color: "var(--ink-mute)", margin: 0 }}>
              ANNUAIRE · PROFILS · STATISTIQUES
            </p>
          </div>
        </div>

        <SearchBar
          value={search}
          onChange={setSearch}
          onSearch={() => {}}
          placeholder="Rechercher un joueur..."
          rgb="90, 200, 255"
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {sorted.map((player) => (
            <Link key={player.id} href={`/joueurs/${player.id}`} style={{ textDecoration: "none" }}>
              <CyberCard lift>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Image
                    src={player.avatarUrl || "/vercel.svg"}
                    alt={player.pseudo}
                    width={36}
                    height={36}
                    unoptimized
                    referrerPolicy="no-referrer"
                    style={{ borderRadius: 4, width: 36, height: 36, objectFit: "cover" }}
                  />
                  <div>
                    <h3 className="display" style={{ fontSize: 16, margin: 0 }}>
                      {player.pseudo}
                    </h3>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {player.overwatchBattletag && <Pill variant="blue">OW2</Pill>}
                  {player.marvelRivalsTag && <Pill variant="blue">MR</Pill>}
                </div>
              </CyberCard>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
