import { permanentRedirect } from "next/navigation";

// La page partenaires dédiée a été supprimée : les partenaires sont désormais
// présentés dans la section « Partenaires » de la page d'accueil. On conserve
// la route en redirection permanente (308) pour les liens et favoris existants.
export default function PartenairesPage() {
  permanentRedirect("/#sponsors");
}
