'use client';

import { useState, useEffect, useRef } from 'react';
import { BotFeedEvent } from '@/lib/shared/types';
import { useClientPower } from '@/lib/shared/hooks/useClientPower';

export function BotLiveFeed() {
  const [items, setItems] = useState<BotFeedEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<BotFeedEvent[]>([]);

  /**
   * La pause est lue dans une ref, jamais en dépendance de l'effet : c'est un
   * réglage d'**affichage**, et le flux ne doit pas s'en apercevoir. En
   * dépendance, chaque clic fermait puis rouvrait la connexion SSE — donc aussi
   * celle que le site tient vers le bot — et les évènements de l'intervalle
   * étaient perdus, y compris ceux que la pause promet justement de mettre de
   * côté.
   */
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /**
   * Onglet caché depuis une minute : le flux est **fermé**, et avec lui la
   * connexion que le site tient vers le bot pour ce lecteur. Personne ne lit un
   * défilé d'évènements dans un onglet qu'il ne regarde pas, et le bot rejoue
   * son historique récent à chaque connexion : au retour, la liste repart de
   * cet historique plutôt que de le recoller sous ce qu'elle montrait déjà (il
   * s'y afficherait en double, dans le désordre).
   */
  const { quietStreamAfterMs } = useClientPower();
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    if (quietStreamAfterMs === null) {
      setSuspended(false);
      return;
    }
    const timer = setTimeout(() => setSuspended(true), quietStreamAfterMs);
    return () => clearTimeout(timer);
  }, [quietStreamAfterMs]);

  const everSuspendedRef = useRef(false);
  useEffect(() => {
    if (suspended) {
      everSuspendedRef.current = true;
      return;
    }
    if (everSuspendedRef.current) {
      setItems([]);
      setBuffer([]);
    }
    const es = new EventSource('/api/bot/feed/stream');

    const handleMessage = (event: MessageEvent) => {
      try {
        const data: BotFeedEvent = JSON.parse(event.data);
        if (pausedRef.current) {
          setBuffer((prev) => [data, ...prev]);
        } else {
          setItems((prev) => [data, ...prev].slice(0, 13));
        }
      } catch {
        // Skip invalid JSON
      }
    };

    es.addEventListener('message', handleMessage);
    es.addEventListener('feed', handleMessage);

    return () => {
      es.removeEventListener('message', handleMessage);
      es.removeEventListener('feed', handleMessage);
      es.close();
    };
  }, [suspended]);

  const handlePauseToggle = () => {
    if (paused) {
      // Le tampon est vidé **dans la même mise à jour** que la reprise : le
      // rendre par `buffer` puis le vider laisserait passer un évènement arrivé
      // entre les deux.
      setItems((prev) => [...buffer, ...prev].slice(0, 13));
      setBuffer([]);
    }
    setPaused((p) => !p);
  };

  return (
    <section className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head">
        <span className="title">Flux temps réel</span>
        <button
          // L'état « allumé » dit que la pause est **posée** : allumé pendant
          // que le flux défile, « ■ PAUSE » en bleu se lisait « en pause ».
          className={'chip' + (paused ? ' chip-on' : '')}
          onClick={handlePauseToggle}
          aria-label={paused ? 'Reprendre le flux' : 'Mettre en pause le flux'}
        >
          {paused ? '▶ REPRENDRE' : '■ PAUSE'}
        </button>
      </div>
      <div className="feed" style={{ flex: 1, maxHeight: 420, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--ink-mute)' }}>En attente d'événements...</div>
        ) : (
          items.slice(0, 13).map((f) => (
            <div key={f.id} className="feed-row">
              <span className="ts">{f.ts}</span>
              <span className={'tag ' + f.type}>{f.type.toUpperCase()}</span>
              <span className="msg">{f.summary}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
