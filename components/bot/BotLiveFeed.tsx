'use client';

import { useState, useEffect } from 'react';
import { BotFeedEvent } from '@/lib/shared/types';

export function BotLiveFeed() {
  const [items, setItems] = useState<BotFeedEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<BotFeedEvent[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/bot/feed/stream');

    const handleMessage = (event: MessageEvent) => {
      try {
        const data: BotFeedEvent = JSON.parse(event.data);
        if (paused) {
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
  }, [paused]);

  const handlePauseToggle = () => {
    if (paused) {
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
