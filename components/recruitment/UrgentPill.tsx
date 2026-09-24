import { Pill } from "@/components/cyber";

/**
 * Pastille clignotante « Urgente » d'une annonce **prioritaire**.
 *
 * Un seul composant pour la carte, la lecture en grand, la modale d'arrivée et
 * la banderole : la pastille est la promesse visible du statut, elle ne doit
 * pas changer de mot ni de forme d'un écran à l'autre. Le clignotement
 * (`.pill-urgent`) suit le régime de charge comme toute animation infinie.
 */
export function UrgentPill({ className = "" }: { className?: string }) {
  return (
    <Pill variant="live" className={`pill-urgent ${className}`.trim()}>
      Urgente
    </Pill>
  );
}
