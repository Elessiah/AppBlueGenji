import { redirect } from "next/navigation";

// La page partenaires dédiée a été supprimée : les partenaires sont désormais
// présentés dans la section « Partenaires » de la page d'accueil. On conserve
// la route en redirection permanente pour les liens et favoris existants.
export default function PartenairesPage() {
  redirect("/#sponsors");
}
