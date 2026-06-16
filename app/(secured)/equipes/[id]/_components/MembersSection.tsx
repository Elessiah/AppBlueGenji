"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatLocalDate } from "@/lib/shared/dates";
import type { PublicUserProfile, TeamMember, TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Coche } from "@/components/Coche";
import { useMemberManagement } from "../_hooks/useMemberManagement";
import { RolesDialog } from "./RolesDialog";

interface MembersSectionProps {
  teamId: number;
  members: TeamMember[];
  canManage: boolean;
  viewerUserId: number | null;
  onChanged: () => void;
}

const roles: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];

export function MembersSection({
  teamId,
  members,
  canManage,
  viewerUserId,
  onChanged,
}: MembersSectionProps) {
  useToast();
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>(["DPS"]);
  const [availablePlayers, setAvailablePlayers] = useState<PublicUserProfile[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pseudoInputRef = useRef<HTMLInputElement | null>(null);
  const [rolesDialog, setRolesDialog] = useState<{
    userId: number;
    pseudo: string;
    isOwner: boolean;
    selected: TeamRole[];
  } | null>(null);

  const { addMember, removeMember, updateRoles } = useMemberManagement(teamId, onChanged);

  // Load available players
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/players", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { players: PublicUserProfile[] };
        if (!cancelled) setAvailablePlayers(payload.players);
      } catch {
        // silencieux
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRole = (role: TeamRole) => {
    setMemberRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const addMemberHandler = async (event: FormEvent) => {
    event.preventDefault();
    await addMember(memberPseudo, memberRoles);
    setMemberPseudo("");
    setMemberRoles(["DPS"]);
  };

  const suggestions = useMemo(() => {
    const q = memberPseudo.trim().toLowerCase();
    if (!q) return [];
    return availablePlayers
      .filter((p) => p.team == null && p.pseudo.toLowerCase().includes(q))
      .slice(0, 8);
  }, [availablePlayers, memberPseudo]);

  return (
    <>
      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title orange">
          <h2>Membres</h2>
        </div>

        <div className="table-like">
          <div className="table-row table-header">
            <span>Joueur</span>
            <span>Roles</span>
            <span>Arrivée</span>
            <span>Actions</span>
          </div>
          {members.map((member) => (
            <div className="table-row" key={member.membershipId}>
              <Link href={`/joueurs/${member.userId}`}>{member.pseudo}</Link>
              <span>{member.roles.join(", ")}</span>
              <span>{formatLocalDate(member.joinedAt)}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {canManage ? (
                  <>
                    {!member.roles.includes("OWNER") && member.userId !== viewerUserId && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => removeMember(member.userId)}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        Exclure
                      </button>
                    )}
                    {(!member.roles.includes("OWNER") || viewerUserId === member.userId) && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          setRolesDialog({
                            userId: member.userId,
                            pseudo: member.pseudo,
                            isOwner: member.roles.includes("OWNER"),
                            selected: member.roles.filter((r) => r !== "OWNER"),
                          })
                        }
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        Roles
                      </button>
                    )}
                  </>
                ) : (
                  "-"
                )}
              </span>
            </div>
          ))}
        </div>

        {canManage && (
          <form onSubmit={addMemberHandler} style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
            <p
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 14px",
              }}
            >
              Inviter un membre
            </p>
            <div className="form-grid">
              <div className="field" style={{ position: "relative" }}>
                <label>Pseudo joueur</label>
                <input
                  ref={pseudoInputRef}
                  value={memberPseudo}
                  onChange={(e) => {
                    setMemberPseudo(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 120);
                  }}
                  required
                  placeholder="Pseudo exact"
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      listStyle: "none",
                      margin: 0,
                      padding: 4,
                      background: "var(--cyber-bg-2, #14181f)",
                      border: "1px solid rgba(255,157,46,0.28)",
                      borderRadius: "var(--r-cy-sm, 8px)",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                      maxHeight: 280,
                      overflowY: "auto",
                    }}
                  >
                    {suggestions.map((player) => (
                      <li key={player.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setMemberPseudo(player.pseudo);
                            setShowSuggestions(false);
                            pseudoInputRef.current?.focus();
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            padding: "6px 8px",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            color: "var(--ink, #e6e9ef)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 13,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,157,46,0.08)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          {player.avatarUrl ? (
                            <Image
                              src={player.avatarUrl}
                              alt={player.pseudo}
                              width={24}
                              height={24}
                              unoptimized
                              style={{ borderRadius: "50%", objectFit: "cover" }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: "rgba(255,157,46,0.15)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                color: "var(--text-2, #9aa4b2)",
                              }}
                            >
                              {player.pseudo.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{player.pseudo}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="field">
                <label>Roles</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
                  {roles
                    .filter((r) => r !== "OWNER")
                    .map((role) => (
                      <Coche
                        key={role}
                        label={role}
                        checked={memberRoles.includes(role)}
                        theme="equipe"
                        onChange={() => toggleRole(role)}
                      />
                    ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="submit"
                className="btn"
                style={{ padding: "10px 22px", background: "rgba(255,157,46,0.12)", borderColor: "rgba(255,157,46,0.3)" }}
              >
                Inviter
              </button>
            </div>
          </form>
        )}
      </div>

      {rolesDialog && (
        <RolesDialog
          dialog={rolesDialog}
          onClose={() => setRolesDialog(null)}
          onSave={async (selected) => {
            await updateRoles(rolesDialog.userId, selected);
            setRolesDialog(null);
          }}
        />
      )}
    </>
  );
}
