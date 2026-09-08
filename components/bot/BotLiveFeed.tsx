'use client';

import { useState, useEffect, useRef } from 'react';
import { BotFeedEvent } from '@/lib/shared/types';

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

  useEffect(() => {
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
  }, []);

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
        <div className="row gap-2">
          <button
            className={'chip ' + (paused ? '' : 'chip-on')}
            onClick={handlePauseToggle}
            aria-label={paused ? 'Reprendre le flux' : 'Mettre en pause le flux'}
          >
            {paused ? '▶ REPRENDRE' : '■ PAUSE'}
          </button>
        </div>
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
