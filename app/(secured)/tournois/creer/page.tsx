"use client";

import { useEffect, type ReactNode } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { ALL_TOURNAMENT_FIELDS } from "@/lib/shared/tournament-edit";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { useToast } from "@/components/ui/toast";
import {
  TournamentForm,
  defaultTournamentFormValues,
  toApiPayload,
} from "../_components/TournamentForm";
import { applyImageChange, imagePickerChange } from "../_lib/image-picker";
import { mapError, useErrorsText } from "../[id]/_lib/error-map";
import { useFormText } from "../_lib/form-text";
import { imageErrorText, useImageText } from "../_lib/image-text";
import { CodedError } from "@/lib/shared/field-errors";

/**
 * Création d'un tournoi.
 *
 * Le formulaire lui-même vit dans `_components/TournamentForm` : il est partagé
 * avec l'édition. La page ne garde que ce qui tient à la route — garde de
 * permission, en-tête, appel réseau. À la création, tout est modifiable.
 */
export default function CreateTournamentPage() {
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const text = useFormText();
  const { t } = text;
  const errorsText = useErrorsText();
  const imageText = useImageText();
  const hl = (children: ReadonlyArray<ReactNode>) => <span className="text-gradient">{richNodes(children)}</span>;

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) =>
        r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } }) : null,
      )
      .then((p) => {
        if (!can(p?.user, "tournaments")) {
          showError(t("create.forbidden"));
          router.replace("/tournois");
        }
      })
      .catch(() => undefined);
  }, [router, showError, t]);

  return (
    <section className="fade-in container">
      <div style={{ marginBottom: 28 }}>
        <LocaleLink
          href="/tournois"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--blue-300)",
          }}
        >
          {t("create.back")}
        </LocaleLink>
        <h1
          className="display"
          style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px", lineHeight: 1.1 }}
        >
          {richNodes(text.rich("create.title", {}, { hl }))}
        </h1>
        <p style={{ color: "var(--ink-mute)", margin: 0, fontSize: 14 }}>
          {t("create.lede")}
        </p>
      </div>

      <TournamentForm
        mode="create"
        initialValues={defaultTournamentFormValues()}
        editableFields={new Set(ALL_TOURNAMENT_FIELDS)}
        submitLabel={t("create.submit")}
        onSubmit={async (values, image) => {
          const response = await fetch("/api/tournaments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(toApiPayload(values)),
          });
          const payload = (await response.json()) as { error?: string; id?: number };
          if (!response.ok || !payload.id) {
            // Le code voyage avec sa phrase : la notification lit la phrase,
            // le formulaire tire du code le champ à signaler.
            const code = payload.error || "TOURNAMENT_CREATE_FAILED";
            throw new CodedError(code, mapError(code, errorsText));
          }
          // L'image ne peut partir qu'une fois le tournoi né : elle se range sous
          // son identifiant. Son échec ne défait pas la création — le tournoi
          // existe, on le dit, et l'image s'ajoute ensuite depuis sa fiche.
          try {
            await applyImageChange(payload.id, imagePickerChange(null, image), image.file, image.crop, (code) =>
              imageErrorText(imageText, code),
            );
            showSuccess(t("create.created"));
          } catch (error) {
            showError(t("create.imageFailed", { error: (error as Error).message }));
          }
          router.push(`/tournois/${payload.id}`);
          router.refresh();
        }}
      />
    </section>
  );
}
