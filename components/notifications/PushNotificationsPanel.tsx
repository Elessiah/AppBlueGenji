"use client";

/**
 * Le réglage des notifications push — un composant pour tout le site.
 *
 * Il se construit **depuis le registre** (`PUSH_TOPICS`) : un sujet ajouté
 * demain y paraît sans une ligne de plus ici, filtré par ce que le lecteur peut
 * recevoir (une alerte d'arbitrage n'est montrée qu'au staff qui la reçoit).
 *
 * Deux formes :
 *
 * - `full` (défaut) — l'appareil **et** les sujets, pour `/profil` ;
 * - `compact` — le seul bouton de l'appareil et une phrase, pour l'écran où le
 *   besoin se fait sentir (la modale de lancement d'un match). `topics` limite
 *   alors le propos à ce qui concerne cet écran.
 *
 * Les refus partent en notification (`useToast`), jamais dans le corps de la
 * page ; ce que le navigateur empêche (iOS hors écran d'accueil, permission
 * bloquée) est dit **à la place** du bouton — un bouton qui mène à un refus est
 * un bouton qui ment.
 */
import { useCallback, useId } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  PUSH_SUPPORT_NOTICES,
  PUSH_TOPICS,
  pushErrorMessage,
  type PushTopic,
} from "@/lib/shared/push-notifications";
import { usePushNotifications } from "./usePushNotifications";
import s from "./PushNotificationsPanel.module.css";

export type PushNotificationsPanelProps = {
  variant?: "full" | "compact";
  /** Sujets à présenter ; défaut : tous ceux que le lecteur peut recevoir. */
  topics?: readonly PushTopic[];
  /** Phrase d'accroche de la forme compacte. */
  lead?: string;
  /**
   * Langue des notifications du panneau (français) quand elle diffère de la
   * page : rendues hors du panneau, elles n'héritent pas de son `lang`.
   */
  toastLang?: string;
};

export function PushNotificationsPanel({
  variant = "full",
  topics,
  lead,
  toastLang,
}: Readonly<PushNotificationsPanelProps>): React.ReactElement | null {
  const { showError } = useToast();
  const onError = useCallback(
    (code: string) => showError(pushErrorMessage(code), toastLang ? { lang: toastLang } : undefined),
    [showError, toastLang],
  );
  const push = usePushNotifications(onError, {
    syncExisting: variant === "full",
    announceLoadFailure: variant === "full",
  });
  const listId = useId();

  if (push.loadFailed && push.server === null) {
    // Le refus est déjà parti en notification ; ici, seulement le geste.
    return variant === "compact" ? null : (
      <div className={s.deviceRow}>
        <CyberButton type="button" variant="ghost" onClick={push.retry}>
          Réessayer
        </CyberButton>
      </div>
    );
  }

  if (push.support === null || push.server === null) {
    return variant === "compact" ? null : (
      <p /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={s.muted} role="status">
        Chargement des notifications…
      </p>
    );
  }

  const shown = push.server.topics.filter((topic) => !topics || topics.includes(topic));
  const configured = push.server.publicKey !== null;
  const blocked = push.support !== "AVAILABLE" ? PUSH_SUPPORT_NOTICES[push.support] : null;

  // La forme compacte ne sert qu'à proposer : abonné, ou sans rien à proposer,
  // elle se tait plutôt que d'occuper la place d'un écran qui a autre chose à dire.
  if (variant === "compact" && (!push.checked || push.subscribed || !configured || blocked)) return null;

  const deviceControl = <DeviceControl push={push} configured={configured} blocked={blocked} toastLang={toastLang} />;

  if (variant === "compact") {
    return (
      <div className={s.compact}>
        <p className={s.lead}>{lead ?? "Sois prévenu même quand le site est fermé."}</p>
        {deviceControl}
      </div>
    );
  }

  const devices = push.server.devices;
  return (
    <div className={s.panel}>
      {deviceControl}
      {devices > 0 ? (
        <p className={s.hint}>
          {devices === 1 ? "1 appareil abonné" : `${devices} appareils abonnés`} à ton compte. Les
          réglages ci-dessous valent pour tous.
        </p>
      ) : null}

      {shown.length > 0 ? (
        <fieldset className={s.topics} aria-describedby={`${listId}-hint`}>
          <legend className={s.legend}>Me prévenir pour</legend>
          <ul className={s.topicList}>
            {shown.map((topic) => {
              const id = `${listId}-${topic}`;
              const enabled = !push.server!.disabledTopics.includes(topic);
              return (
                <li key={topic} className={s.topic}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={enabled}
                    aria-describedby={`${id}-desc`}
                    onChange={(event) => void push.setTopicEnabled(topic, event.target.checked)}
                  />
                  <label htmlFor={id} className={s.topicText}>
                    <span className={s.topicLabel}>{PUSH_TOPICS[topic].label}</span>
                    <span id={`${id}-desc`} className={s.topicDesc}>
                      {PUSH_TOPICS[topic].description}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p id={`${listId}-hint`} className={s.hint}>
            Les messages privés Discord ne dépendent pas de ces réglages : ils suivent ton tag
            Discord.
          </p>
        </fieldset>
      ) : null}
    </div>
  );
}

/**
 * Contrôle de l'appareil : activer, désactiver, ou la phrase qui dit pourquoi
 * le bouton n'est pas offert.
 */
function DeviceControl({
  push,
  configured,
  blocked,
  toastLang,
}: Readonly<{
  push: ReturnType<typeof usePushNotifications>;
  configured: boolean;
  blocked: string | null;
  toastLang?: string;
}>): React.ReactElement {
  const { showSuccess } = useToast();
  const toastOptions = toastLang ? { lang: toastLang } : undefined;
  if (!configured) {
    return <p className={s.notice}>Les notifications push ne sont pas encore activées sur le site.</p>;
  }
  if (!push.checked) {
    // L'abonnement du navigateur n'est pas encore relu : proposer d'activer
    // maintenant, ce serait le proposer un instant à qui l'est déjà.
    return (
      <p /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={s.muted} role="status">
        Vérification de cet appareil…
      </p>
    );
  }
  if (blocked && !push.subscribed) {
    return <p className={s.notice}>{blocked}</p>;
  }
  if (push.subscribed) {
    return (
      <div className={s.deviceRow}>
        {/* Annoncé aux lecteurs d'écran : c'est l'issue du geste qu'on vient de faire. */}
        <span /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={s.status} role="status">
          <span className={s.dot} aria-hidden="true" /> Activées sur cet appareil
        </span>
        <CyberButton
          type="button"
          variant="ghost"
          disabled={push.busy}
          onClick={async () => {
            if (await push.disable()) showSuccess("Notifications désactivées sur cet appareil.", toastOptions);
          }}
        >
          Désactiver sur cet appareil
        </CyberButton>
      </div>
    );
  }
  return (
    <div className={s.deviceRow}>
      <CyberButton
        type="button"
        aria-busy={push.busy}
        disabled={push.busy}
        onClick={async () => {
          if (await push.enable()) showSuccess("Notifications activées sur cet appareil.", toastOptions);
        }}
      >
        {push.busy ? "Activation…" : "Activer les notifications sur cet appareil"}
      </CyberButton>
    </div>
  );
}
