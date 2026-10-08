import * as core from './core.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const state = {
  id: null,
  league: null,
  error: null,
  fetchedAt: 0,
  busy: false,
  importText: '',
  importOpts: { createPlayers: true, skipDuplicates: true },
};

// ---------- Utilidades ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--accent)"/><path d="M6 6.5c5.5 4.5 5.5 14.5 0 19M26 6.5c-5.5 4.5-5.5 14.5 0 19" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const dayFmt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
const dayFmtYear = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (y === new Date().getFullYear() ? dayFmt : dayFmtYear).format(new Date(y, m - 1, d));
}

let toastTimer;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, isError ? 4200 : 2400);
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => core.nameKey(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'liga';
const playerNames = (league) => new Map(league.players.map((p) => [p.id, p.name]));
const sortedPlayers = (league) => [...league.players].sort((a, b) => core.compareNames(a.name, b.name));

// ---------- Ligas guardadas en este dispositivo ----------

const SAVED_KEY = 'liga-padel:ligas';

function savedLeagues() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveLeagues(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 30))); } catch {}
}

const remember = (league) => saveLeagues([
  { id: league.id, name: league.name },
  ...savedLeagues().filter((l) => l.id !== league.id),
]);
const forget = (id) => saveLeagues(savedLeagues().filter((l) => l.id !== id));

// ---------- API ----------

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', ...options });
  } catch {
    throw new Error('Sin conexión. Probá de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Algo salió mal. Probá de nuevo.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const fetchLeague = async (id) => (await request(`/api/liga?id=${encodeURIComponent(id)}`)).league;

const post = (body) => request('/api/liga', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function setLeague(league) {
  state.league = league;
  state.error = null;
  state.fetchedAt = Date.now();
  remember(league);
}

// Ejecuta una acción sobre la liga abierta y guarda la versión que devuelve el servidor.
async function act(body, button) {
  if (state.busy) return null;
  state.busy = true;
  if (button) button.disabled = true;
  try {
    const { league } = await post({ id: state.id, ...body });
    setLeague(league);
    return league;
  } catch (err) {
    toast(err.message, true);
    return null;
  } finally {
    state.busy = false;
    if (button?.isConnected) button.disabled = false;
  }
}

let inflight = null;
async function refresh(force = false) {
  const id = state.id;
  if (!id || inflight === id) return;
  if (!force && Date.now() - state.fetchedAt < 15000) return;
  inflight = id;
  try {
    const league = await fetchLeague(id);
    if (id !== state.id) return;
    const changed = !state.league || state.league.rev !== league.rev;
    setLeague(league);
    if (changed) render({ soft: true });
  } catch (err) {
    if (id !== state.id) return;
    if (err.status === 404) forget(id);
    if (!state.league) {
      state.error = err;
      render();
    }
  } finally {
    if (inflight === id) inflight = null;
  }
}

// ---------- Navegación ----------
// /             inicio
// /liga/:id     liga (#tabla, #partidos[/jugador], #jugadores, #cargar, #importar)

function currentLocation() {
  const m = location.pathname.match(/^\/liga\/([A-Za-z0-9]+)\/?$/);
  const [view = '', arg = ''] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { id: m?.[1] ?? null, view: view || 'tabla', arg };
}

let lastHref = null;
let lastView = null;

function route() {
  lastHref = location.href;
  const { id } = currentLocation();
  if (id !== state.id) {
    state.id = id;
    state.league = null;
    state.error = null;
    state.fetchedAt = 0;
    state.importText = '';
  }
  render();
  if (id) refresh(!state.league);
}

function go(url, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route();
}

const onNavigate = () => { if (location.href !== lastHref) route(); };
addEventListener('popstate', onNavigate);
addEventListener('hashchange', onNavigate);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

// ---------- Render ----------

function render({ soft = false } = {}) {
  const { id, view, arg } = currentLocation();
  const viewKey = `${id}:${view}`;
  if (soft && (view === 'cargar' || view === 'importar')) {
    // No pisar un formulario a medio completar; solo se actualiza la vista previa.
    if (view === 'importar') updatePreview();
    return;
  }
  if (!id) renderHome();
  else if (!state.league) renderStatus();
  else if (view === 'cargar') renderMatchForm();
  else if (view === 'importar') renderImport();
  else renderLeague(['partidos', 'jugadores'].includes(view) ? view : 'tabla', arg);
  if (viewKey !== lastView && !soft) scrollTo(0, 0);
  lastView = viewKey;
}

function renderHome() {
  document.title = 'Liga de pádel';
  const saved = savedLeagues();
  app.innerHTML = `
    <header class="brand">
      ${LOGO}
      <div>
        <h1>Liga de pádel</h1>
        <p class="muted small">Formato americano · ganar suma 1 punto</p>
      </div>
    </header>

    <section class="card">
      <form id="create-form" class="stack" autocomplete="off">
        <h2>Nueva liga</h2>
        <label class="field">Nombre
          <input name="name" maxlength="${core.LIMITS.name}" required placeholder="Ej: Liga de los jueves">
        </label>
        <label class="field">
          <span>Jugadores <span class="muted">— uno por línea, podés sumar más después</span></span>
          <textarea name="players" rows="6" placeholder="Ana&#10;Bruno&#10;Carla&#10;Dani"></textarea>
        </label>
        <button class="btn primary block">Crear liga</button>
      </form>
    </section>

    ${saved.length ? `
      <section class="block">
        <h2 class="section-title">Tus ligas</h2>
        <nav class="card flush list">
          ${saved.map((l) => `
            <a class="row" href="/liga/${esc(l.id)}" data-link><span>${esc(l.name)}</span>${icon('chevron')}</a>`).join('')}
        </nav>
      </section>` : ''}

    <section class="block">
      <h2 class="section-title">¿Te pasaron un link?</h2>
      <form id="open-form" class="inline" autocomplete="off">
        <input name="link" placeholder="Pegá el link de la liga" aria-label="Link de la liga">
        <button class="btn">Abrir</button>
      </form>
    </section>`;
}

function renderStatus() {
  if (!state.error) {
    app.innerHTML = '<p class="loading">Cargando liga…</p>';
    return;
  }
  const notFound = state.error.status === 404;
  app.innerHTML = `
    <div class="empty">
      <h2>${notFound ? 'No encontramos esta liga' : 'No se pudo cargar la liga'}</h2>
      <p>${notFound ? 'Revisá el link o pedile uno nuevo a quien la creó.' : esc(state.error.message)}</p>
      ${notFound
        ? '<a class="btn" href="/" data-link>Ir al inicio</a>'
        : '<button class="btn" data-action="retry">Reintentar</button>'}
    </div>`;
}

function leagueHeader(league) {
  return `
    <header class="top">
      <a class="icon-btn" href="/" data-link aria-label="Inicio">${icon('back')}</a>
      <div class="title">
        <h1>${esc(league.name)}</h1>
        <p class="muted small">${plural(league.players.length, 'jugador', 'jugadores')} · ${plural(league.matches.length, 'partido', 'partidos')}</p>
      </div>
      <button class="btn sm" data-action="share">${icon('share')}Compartir</button>
    </header>`;
}

function subHeader(title, back) {
  return `
    <header class="top">
      <a class="icon-btn" href="${back}" aria-label="Volver">${icon('back')}</a>
      <div class="title">
        <h1>${esc(title)}</h1>
        <p class="muted small">${esc(state.league.name)}</p>
      </div>
    </header>`;
}

function renderLeague(tab, arg) {
  const league = state.league;
  document.title = `${league.name} · Liga de pádel`;
  const tabs = [['tabla', 'Tabla'], ['partidos', 'Partidos'], ['jugadores', 'Jugadores']];
  const body = tab === 'partidos' ? matchesView(league, arg)
    : tab === 'jugadores' ? playersView(league)
      : standingsView(league);
  app.innerHTML = `
    ${leagueHeader(league)}
    <nav class="tabs">
      ${tabs.map(([key, label]) => `<a href="#${key}"${key === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
    <section>${body}</section>
    <div class="bottom-bar"><div class="inner">
      <a class="btn primary block" href="#cargar">${icon('plus')}Cargar partido</a>
    </div></div>`;
}

function standingsView(league) {
  const rows = core.computeStandings(league);
  if (!rows.length) {
    return `
      <div class="empty">
        <h2>Todavía no hay jugadores</h2>
        <p>Sumalos a mano o importá los partidos y se crean solos.</p>
        <a class="btn" href="#jugadores">Agregar jugadores</a>
      </div>`;
  }
  return `
    <div class="card flush">
      <table class="standings">
        <thead>
          <tr>
            <th class="pos">#</th>
            <th class="name">Jugador</th>
            <th title="Partidos jugados">PJ</th>
            <th title="Partidos ganados">PG</th>
            <th title="Partidos perdidos">PP</th>
            <th class="opt" title="Diferencia de sets">±S</th>
            <th title="Diferencia de games">±G</th>
            <th class="pts" title="Puntos">Pts</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-player="${esc(r.id)}"${r.pos === 1 && r.pts > 0 ? ' class="leader"' : ''}>
              <td class="pos"><span>${r.pos}</span></td>
              <td class="name">${esc(r.name)}</td>
              <td>${r.pj}</td>
              <td>${r.pg}</td>
              <td>${r.pp}</td>
              <td class="opt">${signed(r.sf - r.sc)}</td>
              <td>${signed(r.gf - r.gc)}</td>
              <td class="pts">${r.pts}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${league.matches.length ? '' : `
      <p class="note">Todavía no hay partidos. Cargá el primero o <a href="#importar">importalos todos juntos</a>.</p>`}
    <p class="note">
      Ganar suma 1 punto y perder 0. Con los mismos puntos queda arriba quien jugó menos partidos;
      si además jugaron los mismos partidos, comparten la posición. ±S y ±G (diferencia de sets y de games)
      son solo informativos. Tocá un jugador para ver sus partidos.
    </p>`;
}

function matchesView(league, playerId) {
  const names = playerNames(league);
  const filter = names.has(playerId) ? playerId : '';
  const matches = league.matches
    .filter((m) => !filter || m.a.includes(filter) || m.b.includes(filter))
    .sort((x, y) => y.date.localeCompare(x.date) || String(y.createdAt).localeCompare(String(x.createdAt)));

  const toolbar = `
    <div class="toolbar">
      <select id="filter" aria-label="Filtrar por jugador">
        <option value="">Todos los jugadores</option>
        ${sortedPlayers(league).map((p) => `<option value="${esc(p.id)}"${p.id === filter ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <a class="btn sm" href="#importar">${icon('upload')}Importar</a>
      ${league.matches.length ? `<button class="btn sm" data-action="export">${icon('download')}Exportar</button>` : ''}
    </div>`;

  let summary = '';
  if (filter) {
    const r = core.computeStandings(league).find((row) => row.id === filter);
    summary = `<p class="player-summary"><b>${esc(r.name)}</b> · ${r.pos}º · ${plural(r.pts, 'punto', 'puntos')} · ${plural(r.pg, 'ganado', 'ganados')} · ${plural(r.pp, 'perdido', 'perdidos')}</p>`;
  }

  if (!matches.length) {
    return `${toolbar}${summary}
      <div class="empty">
        <h2>${filter ? 'Sin partidos' : 'Todavía no hay partidos'}</h2>
        <p>${filter ? 'Este jugador todavía no jugó.' : 'Cargalos de a uno o importalos todos juntos.'}</p>
      </div>`;
  }

  const groups = [];
  for (const m of matches) {
    if (groups.at(-1)?.date !== m.date) groups.push({ date: m.date, matches: [] });
    groups.at(-1).matches.push(m);
  }
  return `${toolbar}${summary}
    ${groups.map((g) => `
      <h3 class="day">${formatDay(g.date)}</h3>
      <div class="card flush">${g.matches.map((m) => matchCard(m, names, filter)).join('')}</div>`).join('')}`;
}

function matchCard(match, names, highlight) {
  const s = core.summarize(match.sets);
  const side = (key) => {
    const pair = match[key]
      .map((id) => `<span${id === highlight ? ' class="hl"' : ''}>${esc(names.get(id) ?? '?')}</span>`)
      .join(' · ');
    const games = match.sets.map(([x, y]) => {
      const [mine, theirs] = key === 'a' ? [x, y] : [y, x];
      return `<span${mine > theirs ? ' class="w"' : ''}>${mine}</span>`;
    }).join('');
    return `
      <div class="side${s.winner === key ? ' win' : ''}">
        <i class="dot"></i><span class="pair">${pair}</span><span class="games">${games}</span>
      </div>`;
  };
  return `
    <article class="match">
      <div class="score">${side('a')}${side('b')}</div>
      <button class="icon-btn quiet" data-action="delete-match" data-id="${esc(match.id)}" aria-label="Borrar partido">${icon('trash')}</button>
    </article>`;
}

function playersView(league) {
  const played = new Map();
  for (const m of league.matches) {
    for (const id of [...m.a, ...m.b]) played.set(id, (played.get(id) ?? 0) + 1);
  }
  const list = sortedPlayers(league);
  return `
    <form id="player-form" class="inline" autocomplete="off">
      <input name="name" maxlength="${core.LIMITS.name}" required placeholder="Nombre del jugador" aria-label="Nombre del jugador">
      <button class="btn">Agregar</button>
    </form>
    ${list.length ? `
      <ul class="card flush players">
        ${list.map((p) => {
          const n = played.get(p.id) ?? 0;
          return `
            <li>
              <span class="grow">${esc(p.name)}</span>
              <span class="count">${n} PJ</span>
              <button class="icon-btn quiet" data-action="rename-player" data-id="${esc(p.id)}" aria-label="Cambiar nombre de ${esc(p.name)}">${icon('edit')}</button>
              ${n
                ? '<span class="icon-btn placeholder" aria-hidden="true"></span>'
                : `<button class="icon-btn quiet" data-action="remove-player" data-id="${esc(p.id)}" aria-label="Quitar a ${esc(p.name)}">${icon('trash')}</button>`}
            </li>`;
        }).join('')}
      </ul>
      <p class="note">Solo se puede quitar a un jugador que no tenga partidos cargados.</p>` : ''}

    <section class="block">
      <h2 class="section-title">Liga</h2>
      <div class="card flush list">
        <button class="row" data-action="rename-league">Cambiar el nombre de la liga ${icon('edit')}</button>
        <button class="row" data-action="share">Compartir el link ${icon('share')}</button>
        <button class="row danger" data-action="forget-league">Quitar de “Tus ligas” en este dispositivo</button>
      </div>
    </section>`;
}

// ---------- Cargar partido ----------

const SLOTS = ['a1', 'a2', 'b1', 'b2'];

function renderMatchForm(previous = null) {
  const league = state.league;
  document.title = `Cargar partido · ${league.name}`;
  const players = sortedPlayers(league);
  if (players.length < 4) {
    app.innerHTML = `
      ${subHeader('Cargar partido', '#tabla')}
      <div class="card empty">
        <h2>Faltan jugadores</h2>
        <p>Necesitás al menos 4 jugadores en la liga para cargar un partido.</p>
        <a class="btn" href="#jugadores">Agregar jugadores</a>
      </div>`;
    return;
  }
  const options = `<option value="">Elegí…</option>${players.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  const select = (name, label) => `<select name="${name}" aria-label="${label}">${options}</select>`;
  const setRow = (n) => `
    <span class="label">${n === 3 ? '3er set' : `Set ${n}`}</span>
    <input name="s${n}a" inputmode="numeric" maxlength="2" aria-label="Set ${n}, games de la pareja 1">
    <input name="s${n}b" inputmode="numeric" maxlength="2" aria-label="Set ${n}, games de la pareja 2">`;

  app.innerHTML = `
    ${subHeader('Cargar partido', '#tabla')}
    <form id="match-form" class="stack" autocomplete="off" novalidate>
      <div class="card stack">
        <fieldset>
          <legend>Pareja 1</legend>
          <div class="pair-grid">${select('a1', 'Pareja 1, jugador 1')}${select('a2', 'Pareja 1, jugador 2')}</div>
        </fieldset>
        <fieldset>
          <legend>Pareja 2</legend>
          <div class="pair-grid">${select('b1', 'Pareja 2, jugador 1')}${select('b2', 'Pareja 2, jugador 2')}</div>
        </fieldset>
        <p class="small muted">¿Falta alguien? <button type="button" class="link-btn" data-action="quick-player">Agregar jugador</button></p>
      </div>

      <div class="card stack">
        <fieldset>
          <legend>Resultado</legend>
          <div class="sets">
            <span></span><span class="head" id="head-a">Pareja 1</span><span class="head" id="head-b">Pareja 2</span>
            ${[1, 2, 3].map(setRow).join('')}
          </div>
        </fieldset>
        <p class="small muted">El 3er set es opcional. Si se definió con super tie-break, anotalo como set (ej. 10-8).</p>
        <label class="field">Fecha
          <input type="date" name="date" value="${core.todayISO()}" required>
        </label>
      </div>

      <p class="verdict" id="verdict" aria-live="polite"></p>
      <button class="btn primary block" id="save-match">Guardar partido</button>
    </form>`;

  const form = document.getElementById('match-form');
  if (previous) {
    for (const [name, value] of Object.entries(previous)) {
      if (form.elements[name]) form.elements[name].value = value;
    }
  }
  updateMatchForm(form);
}

function readMatchForm(form) {
  const f = new FormData(form);
  const value = (k) => String(f.get(k) ?? '').trim();
  const sets = [];
  let incomplete = false;
  for (const n of [1, 2, 3]) {
    const x = value(`s${n}a`);
    const y = value(`s${n}b`);
    if (!x && !y) continue;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(y)) { incomplete = true; continue; }
    sets.push([Number(x), Number(y)]);
  }
  return {
    date: value('date'),
    a: [value('a1'), value('a2')],
    b: [value('b1'), value('b2')],
    sets,
    incomplete,
  };
}

function matchFormProblem(m) {
  const ids = [...m.a, ...m.b];
  if (ids.some((id) => !id)) return 'Elegí a los 4 jugadores.';
  if (new Set(ids).size < 4) return 'Hay un jugador repetido.';
  if (m.incomplete) return 'Completá los games de los dos lados en cada set.';
  if (!m.sets.length) return 'Cargá el resultado.';
  const error = core.setsError(m.sets);
  if (error) return `${error}.`;
  if (!core.isValidISODate(m.date)) return 'Elegí la fecha.';
  return null;
}

function updateMatchForm(form) {
  const names = playerNames(state.league);
  const m = readMatchForm(form);

  // Un jugador elegido no se puede volver a elegir en otro lugar.
  const chosen = SLOTS.map((s) => form.elements[s].value);
  SLOTS.forEach((slot, i) => {
    for (const opt of form.elements[slot].options) {
      opt.disabled = Boolean(opt.value) && chosen.some((v, j) => j !== i && v === opt.value);
    }
  });

  const pairLabel = (ids, fallback) => (ids.some(Boolean)
    ? ids.map((id) => (id ? names.get(id) : '…')).join(' / ')
    : fallback);
  document.getElementById('head-a').textContent = pairLabel(m.a, 'Pareja 1');
  document.getElementById('head-b').textContent = pairLabel(m.b, 'Pareja 2');

  const verdict = document.getElementById('verdict');
  const problem = matchFormProblem(m);
  if (problem) {
    verdict.className = 'verdict';
    verdict.textContent = problem;
    return;
  }
  const s = core.summarize(m.sets);
  const winners = (s.winner === 'a' ? m.a : m.b).map((id) => names.get(id)).join(' y ');
  verdict.className = 'verdict ok';
  verdict.textContent = `Ganan ${winners} · ${Math.max(s.setsA, s.setsB)}-${Math.min(s.setsA, s.setsB)} en sets`;
}

async function saveMatch(form) {
  const m = readMatchForm(form);
  const problem = matchFormProblem(m);
  if (problem) {
    toast(problem, true);
    return;
  }
  const league = await act(
    { action: 'addMatches', matches: [{ date: m.date, a: m.a, b: m.b, sets: m.sets }] },
    document.getElementById('save-match'),
  );
  if (league) {
    toast('Partido guardado');
    go('#tabla', true);
  }
}

// ---------- Importar ----------

function renderImport() {
  const league = state.league;
  document.title = `Importar partidos · ${league.name}`;
  const { createPlayers, skipDuplicates } = state.importOpts;
  app.innerHTML = `
    ${subHeader('Importar partidos', '#partidos')}
    <div class="stack">
      <div class="card stack">
        <p>Pegá un partido por línea. El resultado va siempre desde el lado de la primera pareja.</p>
        <pre class="example">Ana / Bruno vs Carla / Dani 6-4 3-6 7-5
12/10 Ana / Carla vs Bruno / Dani 6-2 6-3</pre>
        <p class="small muted">
          La fecha al principio es opcional (si no está, se usa la de hoy). También podés pegar filas
          copiadas de Excel o Google Sheets, o subir un CSV con las columnas
          <code>fecha; jugador1; jugador2; jugador3; jugador4; set1; set2; set3</code> (1 y 2 contra 3 y 4).
          <button type="button" class="link-btn" data-action="template">Descargar plantilla</button>
        </p>
        <textarea id="import-text" class="mono" rows="8" spellcheck="false" aria-label="Partidos a importar"
          placeholder="Ana / Bruno vs Carla / Dani 6-4 6-3">${esc(state.importText)}</textarea>
        <div>
          <label class="btn sm file">${icon('upload')}Subir archivo
            <input type="file" id="import-file" accept=".csv,.txt,.tsv,text/csv,text/plain">
          </label>
        </div>
        <label class="check"><input type="checkbox" id="opt-create"${createPlayers ? ' checked' : ''}>Crear los jugadores que no estén en la liga</label>
        <label class="check"><input type="checkbox" id="opt-dups"${skipDuplicates ? ' checked' : ''}>Omitir partidos que ya están cargados</label>
      </div>
      <div id="import-preview"></div>
      <button class="btn primary block" id="do-import" data-action="do-import" disabled>Importar</button>
    </div>`;
  updatePreview();
}

function importResult() {
  const rows = core.parseImport(state.importText, { today: core.todayISO() });
  return core.resolveImport(rows, state.league, state.importOpts);
}

function updatePreview() {
  const box = document.getElementById('import-preview');
  const button = document.getElementById('do-import');
  if (!box) return;
  const { items, newPlayers } = importResult();
  const count = (status) => items.filter((i) => i.status === status).length;
  const ok = count('ok');
  const dup = count('duplicate');
  const bad = count('error');
  button.disabled = ok === 0;
  button.textContent = ok ? `Importar ${plural(ok, 'partido', 'partidos')}` : 'Importar';
  if (!items.length) {
    box.innerHTML = '';
    return;
  }
  const item = (it) => {
    if (it.status === 'error') {
      return `
        <li><span class="badge err">Línea ${it.line}</span>
          <div><div class="raw">${esc(it.raw)}</div><div class="small err">${esc(it.error)}</div></div></li>`;
    }
    return `
      <li>${it.status === 'ok' ? '<span class="badge ok">OK</span>' : '<span class="badge">Ya está</span>'}
        <div>
          <div>${esc(it.a.join(' · '))} <span class="muted">vs</span> ${esc(it.b.join(' · '))}</div>
          <div class="small muted">${core.formatSets(it.sets)} · ${formatDay(it.date)}</div>
        </div></li>`;
  };
  box.innerHTML = `
    <div class="card">
      <p class="small">
        <b>${plural(ok, 'partido listo', 'partidos listos')}</b>
        ${dup ? ` · ${plural(dup, 'ya cargado', 'ya cargados')} (se omite${dup === 1 ? '' : 'n'})` : ''}
        ${bad ? ` · <span class="err">${plural(bad, 'línea con error', 'líneas con errores')}</span>` : ''}
      </p>
      ${newPlayers.length ? `<p class="small" style="margin-top:6px">Jugadores nuevos: <b>${esc(newPlayers.join(', '))}</b></p>` : ''}
      <ul class="preview" style="margin-top:10px">${items.map(item).join('')}</ul>
    </div>`;
}

async function doImport(button) {
  const { matches } = importResult();
  if (!matches.length) return;
  const league = await act(
    { action: 'addMatches', matches, createPlayers: state.importOpts.createPlayers },
    button,
  );
  if (league) {
    state.importText = '';
    toast(`${plural(matches.length, 'partido importado', 'partidos importados')}`);
    go('#tabla', true);
  }
}

// Excel en Windows suele guardar CSV en Windows-1252; si no es UTF-8 válido, se reintenta así.
async function readTextFile(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function templateCSV() {
  const today = core.todayISO();
  return [
    core.CSV_HEADER.join(';'),
    `${today};Ana;Bruno;Carla;Dani;6-4;3-6;7-5`,
    `${today};Ana;Carla;Bruno;Dani;6-2;6-3;`,
  ].join('\r\n');
}

// ---------- Compartir ----------

async function share() {
  const league = state.league;
  const url = `${location.origin}/liga/${state.id}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: league.name, text: `Liga de pádel “${league.name}”: cargá tus partidos acá`, url });
    } catch {}
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado');
  } catch {
    prompt('Copiá el link de la liga:', url);
  }
}

// ---------- Eventos ----------

const actions = {
  retry() {
    state.error = null;
    render();
    refresh(true);
  },
  share,
  export() {
    download(`${slug(state.league.name)}-partidos.csv`, core.toCSV(state.league));
  },
  template() {
    download('plantilla-partidos.csv', templateCSV());
  },
  async 'delete-match'(button) {
    const match = state.league.matches.find((m) => m.id === button.dataset.id);
    if (!match) return;
    const names = playerNames(state.league);
    const pair = (ids) => ids.map((id) => names.get(id)).join(' y ');
    if (!confirm(`¿Borrar el partido ${pair(match.a)} vs ${pair(match.b)} (${core.formatSets(match.sets)})?`)) return;
    if (await act({ action: 'deleteMatch', matchId: match.id }, button)) {
      toast('Partido borrado');
      render();
    }
  },
  async 'rename-player'(button) {
    const player = state.league.players.find((p) => p.id === button.dataset.id);
    const name = player && prompt('Nuevo nombre', player.name);
    if (!name || core.cleanName(name) === player.name) return;
    if (await act({ action: 'renamePlayer', playerId: player.id, name }, button)) render();
  },
  async 'remove-player'(button) {
    const player = state.league.players.find((p) => p.id === button.dataset.id);
    if (!player || !confirm(`¿Quitar a ${player.name} de la liga?`)) return;
    if (await act({ action: 'removePlayer', playerId: player.id }, button)) render();
  },
  async 'rename-league'(button) {
    const name = prompt('Nombre de la liga', state.league.name);
    if (!name || core.cleanName(name) === state.league.name) return;
    if (await act({ action: 'renameLeague', name }, button)) render();
  },
  'forget-league'() {
    if (!confirm('La liga no se borra: solo deja de aparecer en “Tus ligas” en este dispositivo.')) return;
    forget(state.id);
    go('/');
  },
  async 'quick-player'(button) {
    const name = prompt('Nombre del jugador nuevo');
    if (!core.cleanName(name)) return;
    const form = document.getElementById('match-form');
    const previous = Object.fromEntries(new FormData(form));
    if (await act({ action: 'addPlayer', name }, button)) {
      toast(`${core.cleanName(name)} se sumó a la liga`);
      renderMatchForm(previous);
    }
  },
  'do-import': doImport,
};

app.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    go(link.getAttribute('href'));
    return;
  }
  const button = event.target.closest('[data-action]');
  if (button && actions[button.dataset.action]) {
    actions[button.dataset.action](button);
    return;
  }
  const row = event.target.closest('tr[data-player]');
  if (row) location.hash = `partidos/${row.dataset.player}`;
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button:not([type="button"])');

  if (form.id === 'create-form') {
    const data = new FormData(form);
    const players = String(data.get('players')).split(/[\n,;]/).map(core.cleanName).filter(Boolean);
    button.disabled = true;
    try {
      const { league } = await post({ action: 'create', name: data.get('name'), players });
      setLeague(league);
      state.id = league.id;
      go(`/liga/${league.id}`);
      toast('Liga creada. Compartí el link con los jugadores.');
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  } else if (form.id === 'open-form') {
    const text = String(new FormData(form).get('link')).trim();
    const id = text.match(/\/liga\/([A-Za-z0-9]+)/)?.[1] ?? (/^[A-Za-z0-9]{6,24}$/.test(text) ? text : null);
    if (id) go(`/liga/${id}`);
    else toast('Ese link no parece de una liga', true);
  } else if (form.id === 'player-form') {
    const name = new FormData(form).get('name');
    if (!core.cleanName(name)) return;
    if (await act({ action: 'addPlayer', name }, button)) {
      render();
      document.querySelector('#player-form input')?.focus();
    }
  } else if (form.id === 'match-form') {
    saveMatch(form);
  }
});

let previewTimer;
app.addEventListener('input', (event) => {
  const form = event.target.closest('#match-form');
  if (form) updateMatchForm(form);
  if (event.target.id === 'import-text') {
    state.importText = event.target.value;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 150);
  }
});

app.addEventListener('change', async (event) => {
  const el = event.target;
  if (el.id === 'filter') {
    location.hash = el.value ? `partidos/${el.value}` : 'partidos';
  } else if (el.id === 'opt-create' || el.id === 'opt-dups') {
    state.importOpts = {
      createPlayers: document.getElementById('opt-create').checked,
      skipDuplicates: document.getElementById('opt-dups').checked,
    };
    updatePreview();
  } else if (el.id === 'import-file' && el.files[0]) {
    const text = await readTextFile(el.files[0]);
    el.value = '';
    const area = document.getElementById('import-text');
    state.importText = state.importText.trim() ? `${state.importText.trimEnd()}\n${text}` : text;
    if (area) area.value = state.importText;
    updatePreview();
  }
});

route();
