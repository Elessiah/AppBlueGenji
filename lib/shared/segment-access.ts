/**
 * Accès d'un lecteur à un segment réservé à une permission : sans session
 * (`"anonymous"`, l'espace sécurisé rend « Connexion requise »), connecté sans
 * la permission (`"denied"`, page introuvable), ou autorisé. La mise en page et
 * ses métadonnées lisent **la même** réponse : l'onglet ne peut pas dire autre
 * chose que la page (`docs/features/ERROR_PAGES_AND_ANCHORS.md`).
 */
export type SegmentAccess = "anonymous" | "denied" | "allowed";

export function segmentAccess<User>(user: User | null, allowed: (user: User) => boolean): SegmentAccess {
  if (!user) return "anonymous";
  return allowed(user) ? "allowed" : "denied";
}
