import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultTournamentFormValues,
  TournamentForm,
} from "@/app/(secured)/tournois/_components/TournamentForm";
import { ToastProvider } from "@/components/ui/toast";
import { editableFieldsForWindow } from "@/lib/shared/tournament-edit";
import type { TournamentFormat } from "@/lib/shared/types";

/**
 * Tournoi lancé : la fenêtre d'édition est fermée, seule la planification par
 * l'arbitrage reste réglable. Tout autre contrôle de saisie doit être rendu
 * désactivé, quel que soit le format (le serveur refuse de toute façon en 409).
 */
function renderLocked(format: TournamentFormat): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <TournamentForm
        mode="edit"
        initialValues={{ ...defaultTournamentFormValues(), name: "Coupe", format }}
        editableFields={editableFieldsForWindow("LOCKED")}
        submitLabel="Enregistrer les modifications"
        refereeSchedulingEditable
        tournamentState="RUNNING"
        onSubmit={async () => {}}
      />
    </ToastProvider>,
  );
}

/** Contrôles de saisie (`input`, `select`, `textarea`) non désactivés. */
function enabledFields(html: string): string[] {
  const tags = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
  return tags.filter((tag) => !/\sdisabled(=""|\s|>|\/)/.test(tag));
}

describe("TournamentForm — tournoi lancé", () => {
  it("n'a aucun champ modifiable dans la fenêtre fermée", () => {
    expect(editableFieldsForWindow("LOCKED").size).toBe(0);
  });

  it.each<[TournamentFormat]>([["SINGLE"], ["DOUBLE"], ["SWISS"], ["SURVIVAL"], ["BG_SURVIE"], ["MULTI"]])(
    "ne laisse que la case de planification modifiable (%s)",
    (format) => {
      const enabled = enabledFields(renderLocked(format));
      expect(enabled).toHaveLength(1);
      expect(enabled[0]).toContain('id="referee-scheduling"');
    },
  );

  it("verrouille aussi la case sur un tournoi terminé", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <TournamentForm
          mode="edit"
          initialValues={{ ...defaultTournamentFormValues(), name: "Coupe" }}
          editableFields={editableFieldsForWindow("LOCKED")}
          submitLabel="Enregistrer"
          refereeSchedulingEditable={false}
          tournamentState="FINISHED"
          onSubmit={async () => {}}
        />
      </ToastProvider>,
    );
    expect(enabledFields(html)).toHaveLength(0);
  });
});
