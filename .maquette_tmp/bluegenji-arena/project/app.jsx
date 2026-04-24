/* eslint-disable */
// BlueGenji Arena — Landing page (cyber minimal)

const { useState, useEffect, useMemo } = React;

/* ---------- MOCK DATA (realistic for an esport assoc) ---------- */

const TOURNAMENTS_LIVE = [
  {
    id: 1,
    name: "Genji Clash #14",
    game: "Overwatch 2",
    teams: 16, maxTeams: 16,
    phase: "Quarts de finale",
    currentMatch: { a: "Neon Drift", b: "Static Wolves", scoreA: 2, scoreB: 1, map: "King's Row" },
    viewers: 842,
  },
];

const TOURNAMENTS_UPCOMING = [
  { id: 2, name: "Rivals Showdown #03", game: "Marvel Rivals", start: "02 Mai 2026 · 20:00", teams: 11, maxTeams: 16, prize: "€600" },
  { id: 3, name: "Monthly Cup — Mai", game: "Overwatch 2", start: "10 Mai 2026 · 19:30", teams: 7, maxTeams: 8, prize: "€300" },
  { id: 4, name: "Genji Summer Open", game: "Overwatch 2", start: "07 Juin 2026 · 18:00", teams: 4, maxTeams: 32, prize: "€1 500" },
];

const LEADERBOARD = [
  { rank: 1, team: "Neon Drift",     pts: 1420, w: 18, l: 3,  trend: "+2" },
  { rank: 2, team: "Static Wolves",  pts: 1285, w: 15, l: 5,  trend: "—"  },
  { rank: 3, team: "Kairos",         pts: 1190, w: 14, l: 6,  trend: "+1" },
  { rank: 4, team: "Ion Break",      pts: 1104, w: 12, l: 7,  trend: "-2" },
  { rank: 5, team: "Void Pulse",     pts:  988, w: 11, l: 8,  trend: "+3" },
  { rank: 6, team: "Midnight Koi",   pts:  920, w: 10, l: 9,  trend: "—"  },
  { rank: 7, team: "Paper Tigers",   pts:  855, w:  9, l: 10, trend: "-1" },
  { rank: 8, team: "Blue Hour",      pts:  790, w:  8, l: 11, trend: "+1" },
];

const CALENDAR = [
  { day: "24",   mon: "Avr", time: "20:30", game: "OW2", label: "Demi-finale · Genji Clash #14", tag: "PLAYOFF" },
  { day: "26",   mon: "Avr", time: "21:00", game: "OW2", label: "Finale · Genji Clash #14",      tag: "FINAL"   },
  { day: "02",   mon: "Mai", time: "20:00", game: "MR",  label: "Rivals Showdown #03 — Swiss",   tag: "OPEN"    },
  { day: "10",   mon: "Mai", time: "19:30", game: "OW2", label: "Monthly Cup — Mai",              tag: "OPEN"    },
  { day: "18",   mon: "Mai", time: "20:00", game: "MR",  label: "Rivals Mid-Season Invitational", tag: "INVIT"   },
];

/* ---------- Countdown hook ---------- */
function useCountdown(targetISO) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = new Date(targetISO);
  let delta = Math.max(0, target - now);
  const d = Math.floor(delta / 86400000); delta -= d * 86400000;
  const h = Math.floor(delta / 3600000);  delta -= h * 3600000;
  const m = Math.floor(delta / 60000);    delta -= m * 60000;
  const s = Math.floor(delta / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return { d: pad(d), h: pad(h), m: pad(m), s: pad(s) };
}

/* =========================================================
   HEADER
   ========================================================= */
function HeaderBar() {
  return (
    <header className="hdr">
      <div className="container hdr-inner">
        <a className="hdr-brand" href="#">
          <span className="hdr-logo">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <path d="M20 3 L36 12 V28 L20 37 L4 28 V12 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="rgba(90,200,255,0.06)"/>
              <path d="M14 15 L20 12 L26 15 L26 25 L20 28 L14 25 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="none"/>
              <circle cx="20" cy="20" r="2" fill="#5ac8ff"/>
            </svg>
          </span>
          <div className="col">
            <span className="logotype" style={{fontSize: 14, color: "var(--fg)"}}>BlueGenji</span>
            <span className="mono" style={{fontSize: 10, letterSpacing: "0.18em", color: "var(--fg-mute)"}}>ARENA · EST. 2023</span>
          </div>
        </a>

        <nav className="hdr-nav">
          <a href="#tournois">Tournois</a>
          <a href="#equipes">Équipes</a>
          <a href="#calendrier">Calendrier</a>
          <a href="#assoc">L'asso</a>
          <a href="#sponsors">Partenaires</a>
        </nav>

        <div className="row gap-3">
          <a className="btn btn-ghost" href="#">Connexion</a>
          <a className="btn btn-primary" href="#">
            Rejoindre
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </a>
        </div>
      </div>
    </header>
  );
}

/* =========================================================
   HERO — Live tournament + identity
   ========================================================= */
function Hero() {
  const live = TOURNAMENTS_LIVE[0];
  const { d, h, m, s } = useCountdown("2026-05-02T20:00:00");

  return (
    <section className="hero">
      <div className="fabric" />
      <div className="container hero-inner">

        {/* LEFT — identity */}
        <div className="hero-left">
          <span className="eyebrow">ASSOCIATION ESPORT · LOI 1901</span>
          <h1 className="display hero-title">
            Organiser,<br/>
            jouer,<br/>
            <span className="hero-title-accent">gagner ensemble.</span>
          </h1>
          <p className="hero-lede">
            BlueGenji est une association française qui fédère joueurs compétitifs
            et casuals autour de tournois <strong>Overwatch&nbsp;2</strong> et <strong>Marvel&nbsp;Rivals</strong>.
            Cash prizes, brackets en direct, communauté Discord active.
          </p>

          <div className="row gap-3" style={{marginTop: 32}}>
            <a className="btn btn-primary" href="#">Inscrire mon équipe</a>
            <a className="btn btn-ghost" href="#">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 3v10l8-5z" fill="currentColor"/></svg>
              Regarder le live
            </a>
          </div>

          <div className="hero-stats">
            <div>
              <div className="num" style={{fontSize: 28, color: "var(--blue-500)"}}>2 400+</div>
              <div className="mono hero-stat-label">Joueurs inscrits</div>
            </div>
            <div className="hero-stat-sep"/>
            <div>
              <div className="num" style={{fontSize: 28, color: "var(--blue-500)"}}>147</div>
              <div className="mono hero-stat-label">Équipes actives</div>
            </div>
            <div className="hero-stat-sep"/>
            <div>
              <div className="num" style={{fontSize: 28, color: "var(--blue-500)"}}>38</div>
              <div className="mono hero-stat-label">Tournois organisés</div>
            </div>
          </div>
        </div>

        {/* RIGHT — Live panel */}
        <div className="hero-right">
          <div className="card card-ticks live-card">
            {/* Card header */}
            <div className="live-head">
              <span className="pill pill-live"><span className="dot"/>LIVE</span>
              <span className="mono" style={{fontSize: 11, letterSpacing: "0.14em", color: "var(--fg-mute)"}}>
                {live.game.toUpperCase()} · {live.phase.toUpperCase()}
              </span>
              <span className="mono live-viewers">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3"/></svg>
                {live.viewers}
              </span>
            </div>

            {/* Match */}
            <div className="live-title mono">{live.name}</div>

            <div className="match">
              <div className="match-team">
                <div className="match-sigil" style={{"--c": "#5ac8ff"}}>N</div>
                <div className="col">
                  <div className="match-name">{live.currentMatch.a}</div>
                  <div className="mono match-sub">FR · SEED 1</div>
                </div>
                <div className="num match-score">{live.currentMatch.scoreA}</div>
              </div>

              <div className="match-vs mono">MATCH 3 · BO5</div>

              <div className="match-team">
                <div className="match-sigil" style={{"--c": "#f5a524"}}>S</div>
                <div className="col">
                  <div className="match-name">{live.currentMatch.b}</div>
                  <div className="mono match-sub">FR · SEED 4</div>
                </div>
                <div className="num match-score">{live.currentMatch.scoreB}</div>
              </div>
            </div>

            <div className="live-map mono">
              <span style={{color:"var(--fg-mute)"}}>CARTE EN COURS</span>
              <span>{live.currentMatch.map.toUpperCase()}</span>
            </div>
          </div>

          {/* Next event strip */}
          <div className="card next-strip">
            <div className="col" style={{gap: 4}}>
              <span className="mono" style={{fontSize: 10, letterSpacing: "0.18em", color: "var(--fg-mute)"}}>PROCHAIN TOURNOI · OUVERTURE DES INSCRIPTIONS</span>
              <span style={{fontSize: 14, color: "var(--fg)"}}>Rivals Showdown #03</span>
            </div>
            <div className="countdown">
              {[["J", d], ["H", h], ["M", m], ["S", s]].map(([l, v]) => (
                <div key={l} className="cd-unit">
                  <div className="num cd-val">{v}</div>
                  <div className="mono cd-lbl">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="ticker">
        <div className="ticker-track">
          {Array.from({length: 2}).flatMap((_, k) => [
            {k:`${k}-1`, t:"RÉSULTAT · Genji Clash #14 · Neon Drift 3 — Kairos 1"},
            {k:`${k}-2`, t:"INSCRIPTIONS · Monthly Cup Mai · 7/8 équipes"},
            {k:`${k}-3`, t:"PARTENARIAT · BlueGenji × Logitech G — annonce le 30.04"},
            {k:`${k}-4`, t:"RECRUTEMENT · Staff arbitrage Marvel Rivals"},
            {k:`${k}-5`, t:"DISCORD · 4 212 membres · +184 cette semaine"},
          ]).map(it => (
            <span key={it.k} className="mono ticker-item">{it.t}<i className="ticker-sep">◆</i></span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   TOURNAMENT BOARD
   ========================================================= */
function TournamentBoard() {
  return (
    <section id="tournois" className="container">
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{marginBottom: 8}}>SECTION 01</div>
          <h2>Tournois en cours & à venir</h2>
        </div>
        <div className="meta">04 ACTIFS · 12 PROGRAMMÉS</div>
      </div>

      <div className="tourney-grid">
        {/* LIVE card — bigger */}
        <div className="card card-lift tourney-card tourney-live">
          <div className="tc-badge"><span className="pill pill-live"><span className="dot"/>LIVE</span></div>
          <div className="tc-game mono">OVERWATCH 2</div>
          <div className="tc-title">Genji Clash #14</div>
          <div className="tc-phase mono">QUARTS DE FINALE · MATCH 3 / 4</div>

          {/* mini bracket */}
          <div className="mini-bracket">
            {[["Neon Drift","Static Wolves","2","1"],["Kairos","Ion Break","3","0"],["Void Pulse","Blue Hour","1","2"],["Paper Tigers","Midnight Koi","—","—"]].map(([a,b,sa,sb], i)=>(
              <div key={i} className="mb-match">
                <div className={"mb-row " + (parseInt(sa)>parseInt(sb) ? "win":"")}>
                  <span>{a}</span><span className="num">{sa}</span>
                </div>
                <div className={"mb-row " + (parseInt(sb)>parseInt(sa) ? "win":"")}>
                  <span>{b}</span><span className="num">{sb}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="tc-foot">
            <div className="col gap-1">
              <span className="mono" style={{fontSize:10, letterSpacing:"0.14em", color:"var(--fg-mute)"}}>CASH PRIZE</span>
              <span className="num" style={{fontSize: 18}}>€1 200</span>
            </div>
            <a className="btn btn-primary" href="#">Voir le bracket →</a>
          </div>
        </div>

        {/* Upcoming cards */}
        {TOURNAMENTS_UPCOMING.map(t => (
          <div key={t.id} className="card card-lift tourney-card">
            <div className="tc-badge"><span className="pill pill-blue">{t.game === "Overwatch 2" ? "OW2" : "MR"}</span></div>
            <div className="tc-game mono">{t.game.toUpperCase()}</div>
            <div className="tc-title" style={{fontSize: 22}}>{t.name}</div>

            <div className="tc-meta">
              <div>
                <div className="mono tc-meta-lbl">DÉBUT</div>
                <div>{t.start}</div>
              </div>
              <div>
                <div className="mono tc-meta-lbl">ÉQUIPES</div>
                <div><span className="num">{t.teams}</span><span style={{color:"var(--fg-dim)"}}> / {t.maxTeams}</span></div>
              </div>
            </div>

            {/* progress */}
            <div className="tc-progress">
              <div className="tc-progress-bar" style={{width: `${(t.teams/t.maxTeams)*100}%`}}/>
            </div>

            <div className="tc-foot">
              <div className="col gap-1">
                <span className="mono" style={{fontSize:10, letterSpacing:"0.14em", color:"var(--fg-mute)"}}>CASH PRIZE</span>
                <span className="num" style={{fontSize: 16}}>{t.prize}</span>
              </div>
              <a className="btn btn-ghost" href="#">S'inscrire</a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* =========================================================
   LEADERBOARD + CALENDAR (two-column)
   ========================================================= */
function LeaderCal() {
  return (
    <section id="equipes" className="container lc-wrap">
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{marginBottom: 8}}>SECTION 02</div>
          <h2>Classement & calendrier</h2>
        </div>
        <div className="meta">SAISON PRINTEMPS 2026 · SEMAINE 17</div>
      </div>

      <div className="lc-grid">
        {/* LEADERBOARD */}
        <div className="card leader">
          <div className="leader-head">
            <span className="mono" style={{fontSize: 11, letterSpacing: "0.2em", color: "var(--fg-mute)"}}>TOP ÉQUIPES</span>
            <div className="row gap-2">
              <button className="chip chip-on">Général</button>
              <button className="chip">Overwatch 2</button>
              <button className="chip">Marvel Rivals</button>
            </div>
          </div>

          <div className="leader-table">
            <div className="lt-head mono">
              <span>#</span><span>ÉQUIPE</span><span>V–D</span><span>PTS</span><span>TR</span>
            </div>
            {LEADERBOARD.map(t => (
              <div key={t.rank} className={"lt-row " + (t.rank<=3 ? "top" : "")}>
                <span className="num lt-rank">{String(t.rank).padStart(2,"0")}</span>
                <span className="lt-team">
                  <span className="lt-sigil" style={{"--c": ["#5ac8ff","#f5a524","#8fd5ff","#b4c8d4","#b4c8d4","#b4c8d4","#b4c8d4","#b4c8d4"][t.rank-1]}}>
                    {t.team[0]}
                  </span>
                  {t.team}
                </span>
                <span className="num lt-wl"><span style={{color:"var(--blue-300)"}}>{t.w}</span><span style={{color:"var(--fg-dim)"}}>–{t.l}</span></span>
                <span className="num lt-pts">{t.pts}</span>
                <span className={"mono lt-tr " + (t.trend.startsWith("+") ? "up" : t.trend.startsWith("-") ? "down" : "flat")}>{t.trend}</span>
              </div>
            ))}
          </div>

          <div className="leader-foot">
            <a href="#" className="mono" style={{fontSize: 11, letterSpacing:"0.14em", color:"var(--blue-300)"}}>VOIR LE CLASSEMENT COMPLET →</a>
          </div>
        </div>

        {/* CALENDAR */}
        <div id="calendrier" className="card cal">
          <div className="leader-head">
            <span className="mono" style={{fontSize: 11, letterSpacing: "0.2em", color: "var(--fg-mute)"}}>PROCHAINS ÉVÉNEMENTS</span>
            <a href="#" className="mono" style={{fontSize: 11, letterSpacing:"0.14em", color:"var(--blue-300)"}}>ICS →</a>
          </div>

          <div className="cal-list">
            {CALENDAR.map((e, i) => (
              <div key={i} className="cal-row">
                <div className="cal-date">
                  <div className="num cal-day">{e.day}</div>
                  <div className="mono cal-mon">{e.mon.toUpperCase()}</div>
                </div>
                <div className="cal-bar" />
                <div className="col" style={{gap: 4, flex: 1, minWidth: 0}}>
                  <div className="row gap-2" style={{alignItems: "center"}}>
                    <span className="pill pill-blue" style={{fontSize:9}}>{e.game}</span>
                    <span className="mono" style={{fontSize:10, letterSpacing:"0.16em", color:"var(--fg-mute)"}}>{e.tag}</span>
                  </div>
                  <div style={{fontSize: 14}}>{e.label}</div>
                </div>
                <div className="num cal-time">{e.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   ABOUT + SPONSORS + JOIN
   ========================================================= */
function About() {
  return (
    <section id="assoc" className="container about-wrap">
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{marginBottom: 8}}>SECTION 03</div>
          <h2>L'association</h2>
        </div>
        <div className="meta">LOI 1901 · SIÈGE LYON · FONDÉE EN 2023</div>
      </div>

      <div className="about-grid">
        <div className="about-col">
          <p className="about-lede">
            Une structure associative à but non lucratif, gérée par des bénévoles passionnés.
            On organise des tournois accessibles, bien arbitrés, avec des cash prizes réinvestis dans la scène amateur française.
          </p>
          <div className="about-stats">
            {[
              {n: "100%", l: "Bénévole"},
              {n: "€4 200", l: "Prizepool 2025"},
              {n: "12", l: "Arbitres certifiés"},
              {n: "0 €", l: "Frais d'inscription"},
            ].map(s => (
              <div key={s.l} className="about-stat">
                <div className="num" style={{fontSize: 26}}>{s.n}</div>
                <div className="mono about-stat-label">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="about-col">
          <div className="pillars">
            {[
              {k:"01", t:"Accessible", d:"Inscription gratuite, matchmaking par niveau, support francophone sur Discord."},
              {k:"02", t:"Compétitif", d:"Brackets arbitrés, admins formés, rulebook versionné. On prend le jeu au sérieux."},
              {k:"03", t:"Communautaire", d:"Watch parties, coaching ouvert, entraide entre équipes. L'asso avant le scoreboard."},
            ].map(p => (
              <div key={p.k} className="pillar">
                <span className="mono pillar-k">{p.k}</span>
                <div className="col gap-2">
                  <div style={{fontSize: 17, fontWeight: 500}}>{p.t}</div>
                  <div style={{color:"var(--fg-mute)", fontSize: 13.5}}>{p.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Sponsors() {
  const names = ["LOGITECH G", "CORSAIR", "CROUS LYON", "LDLC", "OVH CLOUD", "RAZER"];
  return (
    <section id="sponsors" className="container">
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{marginBottom: 8}}>SECTION 04</div>
          <h2>Partenaires & soutiens</h2>
        </div>
        <div className="meta">6 PARTENAIRES ACTIFS</div>
      </div>
      <div className="sponsors-grid">
        {names.map(n => (
          <div key={n} className="sponsor-slot">
            <div className="sponsor-ph" aria-hidden="true">
              <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
                <defs>
                  <pattern id={`p-${n}`} width="6" height="6" patternUnits="userSpaceOnUse">
                    <path d="M-1 1 l2 -2 M0 6 l6 -6 M5 7 l2 -2" stroke="rgba(180,210,230,0.12)" strokeWidth="0.6"/>
                  </pattern>
                </defs>
                <rect width="100" height="40" fill={`url(#p-${n})`}/>
              </svg>
              <span className="mono sponsor-ph-label">{n}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function JoinCTA() {
  return (
    <section className="container">
      <div className="join card card-ticks">
        <div className="fabric" style={{opacity: 0.8}}/>
        <div className="join-inner">
          <div className="col gap-3" style={{maxWidth: 560}}>
            <span className="eyebrow">REJOINDRE LA SCÈNE</span>
            <h3 className="display" style={{fontSize: 40, letterSpacing: "-0.02em"}}>
              Ton équipe. Notre bracket.<br/>
              <span style={{color: "var(--blue-500)"}}>Le prochain tournoi commence maintenant.</span>
            </h3>
            <p style={{color:"var(--fg-mute)", maxWidth: 480}}>
              Crée ton compte en 30 secondes, monte une équipe de 5, inscris-la.
              On s'occupe du reste — brackets, streams, arbitrage.
            </p>
          </div>
          <div className="col gap-3" style={{alignItems:"flex-end"}}>
            <a className="btn btn-primary" href="#" style={{padding: "14px 22px"}}>
              Créer un compte
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
            <a className="btn btn-ghost" href="#">Rejoindre le Discord</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   FOOTER
   ========================================================= */
function FooterBar() {
  return (
    <footer className="ftr">
      <div className="container ftr-inner">
        <div className="col gap-4" style={{maxWidth: 320}}>
          <div className="row gap-3">
            <span className="hdr-logo">
              <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
                <path d="M20 3 L36 12 V28 L20 37 L4 28 V12 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="rgba(90,200,255,0.06)"/>
                <path d="M14 15 L20 12 L26 15 L26 25 L20 28 L14 25 Z" stroke="#5ac8ff" strokeWidth="1.3" fill="none"/>
              </svg>
            </span>
            <span className="logotype">BlueGenji</span>
          </div>
          <p style={{color:"var(--fg-mute)", fontSize: 13}}>
            Association loi 1901. Tournois Overwatch 2 & Marvel Rivals pour la scène amateur francophone.
          </p>
          <div className="mono" style={{fontSize: 11, letterSpacing: "0.14em", color:"var(--fg-dim)"}}>
            SIRET 912 345 678 00017 · RNA W691234567
          </div>
        </div>

        <div className="ftr-cols">
          <div>
            <div className="mono ftr-h">COMPÉTITIONS</div>
            <ul><li>Tournois actifs</li><li>Archives</li><li>Classement</li><li>Règlement</li></ul>
          </div>
          <div>
            <div className="mono ftr-h">COMMUNAUTÉ</div>
            <ul><li>Discord</li><li>Twitter / X</li><li>Bluesky</li><li>LinkedIn</li></ul>
          </div>
          <div>
            <div className="mono ftr-h">ASSOCIATION</div>
            <ul><li>Manifeste</li><li>Équipe bénévole</li><li>Partenariats</li><li>Contact presse</li></ul>
          </div>
          <div>
            <div className="mono ftr-h">LÉGAL</div>
            <ul><li>Mentions légales</li><li>RGPD</li><li>Statuts</li><li>Cookies</li></ul>
          </div>
        </div>
      </div>
      <div className="container ftr-bottom mono">
        <span>© 2026 BLUEGENJI · TOUS DROITS RÉSERVÉS</span>
        <span>BUILT WITH ♠ IN LYON</span>
      </div>
    </footer>
  );
}

/* =========================================================
   TWEAKS
   ========================================================= */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "glow": 1.0,
  "density": 1.0
}/*EDITMODE-END*/;

function TweaksPanel({visible, vals, setVals}) {
  if (!visible) return null;
  return (
    <div className="tweaks-panel">
      <div className="row" style={{justifyContent:"space-between", marginBottom: 12}}>
        <span className="mono" style={{fontSize: 10, letterSpacing: "0.2em", color:"var(--fg-mute)"}}>TWEAKS</span>
      </div>
      <div className="tweak">
        <label>Intensité du glow <span className="num">{vals.glow.toFixed(2)}</span></label>
        <input type="range" min="0" max="1.6" step="0.05" value={vals.glow}
          onChange={e => setVals(v => ({...v, glow: parseFloat(e.target.value)}))}/>
      </div>
      <div className="tweak">
        <label>Densité <span className="num">{vals.density.toFixed(2)}</span></label>
        <input type="range" min="0.8" max="1.3" step="0.02" value={vals.density}
          onChange={e => setVals(v => ({...v, density: parseFloat(e.target.value)}))}/>
      </div>
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */
function App() {
  const [vals, setVals] = useState(TWEAK_DEFAULTS);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const h = (e) => {
      if (e.data?.type === "__activate_edit_mode") setEditMode(true);
      if (e.data?.type === "__deactivate_edit_mode") setEditMode(false);
    };
    window.addEventListener("message", h);
    window.parent.postMessage({type: "__edit_mode_available"}, "*");
    return () => window.removeEventListener("message", h);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--glow", vals.glow);
    document.documentElement.style.setProperty("--density", vals.density);
    window.parent.postMessage({type:"__edit_mode_set_keys", edits: vals}, "*");
  }, [vals]);

  return (
    <>
      <HeaderBar />
      <Hero />
      <TournamentBoard />
      <LeaderCal />
      <About />
      <Sponsors />
      <JoinCTA />
      <FooterBar />
      <TweaksPanel visible={editMode} vals={vals} setVals={setVals} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
