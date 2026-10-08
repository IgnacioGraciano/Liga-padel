// Lógica de la liga compartida entre el navegador y la API.

export const LIMITS = { name: 40, players: 100, matches: 5000, sets: 5, score: 99 };

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
export const compareNames = (a, b) => collator.compare(a, b);

export function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
}

// Clave para comparar nombres sin importar mayúsculas ni acentos.
export function nameKey(value) {
  return cleanName(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function findPlayerByName(league, name) {
  const key = nameKey(name);
  return league.players.find((p) => nameKey(p.name) === key) ?? null;
}

// ---------- Fechas ----------

const pad = (n) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Acepta AAAA-MM-DD, DD/MM/AAAA, DD/MM/AA y DD/MM (año actual).
export function parseDate(text, now = new Date()) {
  const s = String(text ?? '').trim();
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/))) {
    [d, mo] = [+m[1], +m[2]];
    y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return isValidISODate(iso) ? iso : null;
}

// ---------- Resultados ----------

// Un set cuyo ganador llega a 10 o más se toma como super tie-break.
export const isSuperTiebreak = ([x, y]) => Math.max(x, y) >= 10;

export function summarize(sets) {
  let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
  for (const [x, y] of sets) {
    if (x > y) setsA++;
    else setsB++;
    // El super tie-break cuenta como un game para quien lo gana.
    if (isSuperTiebreak([x, y])) x > y ? gamesA++ : gamesB++;
    else { gamesA += x; gamesB += y; }
  }
  const winner = setsA > setsB ? 'a' : setsB > setsA ? 'b' : null;
  return { setsA, setsB, gamesA, gamesB, winner };
}

export function setsError(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 'Falta el resultado';
  if (sets.length > LIMITS.sets) return `Como máximo ${LIMITS.sets} sets`;
  for (const s of sets) {
    const ok = Array.isArray(s) && s.length === 2 &&
      s.every((n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.score);
    if (!ok) return 'Resultado inválido';
    if (s[0] === s[1]) return `Un set no puede terminar empatado (${s[0]}-${s[1]})`;
  }
  if (!summarize(sets).winner) return 'Los sets quedaron empatados: no hay ganador';
  return null;
}

export function matchError(match, playerIds) {
  if (!isValidISODate(match.date)) return 'Fecha inválida';
  if (match.a?.length !== 2 || match.b?.length !== 2) return 'Cada pareja necesita 2 jugadores';
  const ids = [...match.a, ...match.b];
  if (ids.some((id) => !playerIds.has(id))) return 'Hay un jugador que no está en la liga';
  if (new Set(ids).size !== 4) return 'Un jugador no puede estar dos veces en el mismo partido';
  return setsError(match.sets);
}

export const formatSets = (sets) => sets.map(([x, y]) => `${x}-${y}`).join(' ');

// ---------- Tabla ----------

// Orden: puntos (desc) y, a igualdad de puntos, menos partidos jugados arriba.
// Si coinciden puntos y partidos jugados no se desempata: comparten posición.
export function computeStandings(league) {
  const rows = new Map(league.players.map((p) => [p.id, {
    id: p.id, name: p.name, pts: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, gf: 0, gc: 0,
  }]));

  for (const m of league.matches) {
    const s = summarize(m.sets);
    for (const side of ['a', 'b']) {
      const mine = side === 'a' ? [s.setsA, s.gamesA] : [s.setsB, s.gamesB];
      const theirs = side === 'a' ? [s.setsB, s.gamesB] : [s.setsA, s.gamesA];
      for (const id of m[side]) {
        const r = rows.get(id);
        if (!r) continue;
        r.pj++;
        if (s.winner === side) { r.pg++; r.pts++; } else { r.pp++; }
        r.sf += mine[0]; r.sc += theirs[0];
        r.gf += mine[1]; r.gc += theirs[1];
      }
    }
  }

  const list = [...rows.values()].sort((x, y) =>
    y.pts - x.pts || x.pj - y.pj || compareNames(x.name, y.name));

  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.pos = prev && prev.pts === r.pts && prev.pj === r.pj ? prev.pos : i + 1;
  });
  list.forEach((r, i) => {
    r.tied = list[i - 1]?.pos === r.pos || list[i + 1]?.pos === r.pos;
  });
  return list;
}

// ---------- Importación ----------
//
// Formato de texto, un partido por línea (la fecha es opcional):
//   Ana / Bruno vs Carla / Dani 6-4 3-6 7-5
//   12/10 Ana / Carla vs Bruno / Dani 6-2 6-3
//
// Formato planilla (CSV con ; o , o filas copiadas de Excel/Sheets):
//   fecha;jugador1;jugador2;jugador3;jugador4;set1;set2;set3
// Los resultados siempre se leen desde el punto de vista de la primera pareja.

export const CSV_HEADER = ['fecha', 'jugador1', 'jugador2', 'jugador3', 'jugador4', 'set1', 'set2', 'set3'];

const SET_RE = /(\d{1,2})\s*[-–:/]\s*(\d{1,2})/g;
const TEXT_DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)[\s,;:]+/;
const VS_RE = /\s+(?:vs\.?|versus|contra|v|-|–)\s+/i;
const PAIR_RE = /\s*(?:\/|&|\+|,|\s+y\s+|\s+e\s+)\s*/i;

export function parseSets(text) {
  const src = String(text ?? '').replace(/\(\d+\)/g, ''); // 7-6(5) → 7-6
  const sets = [...src.matchAll(SET_RE)].map((m) => [+m[1], +m[2]]);
  const leftover = src.replace(SET_RE, '').replace(/[\s,;|]/g, '');
  return leftover ? null : sets;
}

function splitPair(text) {
  const names = text.split(PAIR_RE).map(cleanName).filter(Boolean);
  return names.length === 2 ? names : null;
}

function parseTextLine(line, today) {
  let rest = line;
  let date = null;
  const dm = rest.match(TEXT_DATE_RE);
  if (dm) {
    date = parseDate(dm[1]);
    if (!date) return { error: `Fecha inválida (${dm[1]})` };
    rest = rest.slice(dm[0].length);
  }
  const vs = rest.match(VS_RE);
  if (!vs) return { error: 'Falta "vs" entre las dos parejas' };
  const left = rest.slice(0, vs.index);
  const right = rest.slice(vs.index + vs[0].length);
  const firstScore = right.search(/\d{1,2}\s*[-–:/]\s*\d{1,2}/);
  if (firstScore < 0) return { error: 'Falta el resultado (ej. 6-4 6-3)' };
  const a = splitPair(left);
  const b = splitPair(right.slice(0, firstScore).replace(/[\s:,;(–-]+$/, ''));
  if (!a || !b) return { error: 'Cada pareja necesita 2 jugadores separados por "/"' };
  const sets = parseSets(right.slice(firstScore));
  if (!sets) return { error: 'No se entiende el resultado (usá 6-4 6-3)' };
  return { date: date ?? today, explicitDate: Boolean(date), a, b, sets };
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

function parseCsvFields(fields, today) {
  let i = 0;
  let date = null;
  if (fields[0] === '') {
    i = 1;
  } else if (/^[\d/.-]+$/.test(fields[0])) {
    date = parseDate(fields[0]);
    if (!date) return { error: `Fecha inválida (${fields[0]})` };
    i = 1;
  }
  const names = fields.slice(i, i + 4).map(cleanName);
  if (names.length < 4 || names.some((n) => !n)) return { error: 'Faltan jugadores (van 4 columnas de jugadores)' };
  const rest = fields.slice(i + 4).filter(Boolean);
  let sets;
  if (rest.length && rest.every((f) => /^\d{1,2}$/.test(f))) {
    // Games en columnas sueltas: 6;4;3;6 → 6-4 3-6
    if (rest.length % 2) return { error: 'Los games sueltos tienen que venir de a pares' };
    sets = [];
    for (let k = 0; k < rest.length; k += 2) sets.push([+rest[k], +rest[k + 1]]);
  } else {
    sets = parseSets(rest.join(' '));
    if (!sets) return { error: 'No se entiende el resultado (usá 6-4 en cada columna de set)' };
  }
  return { date: date ?? today, explicitDate: Boolean(date), a: names.slice(0, 2), b: names.slice(2, 4), sets };
}

function csvSeparator(line) {
  if (line.includes('\t')) return '\t';
  if ((line.match(/;/g) || []).length >= 4) return ';';
  if ((line.match(/,/g) || []).length >= 4 && !VS_RE.test(line)) return ',';
  return null;
}

function isHeader(fields) {
  return fields.some((f) => /^(fecha|jugador|pareja|set\s*\d)/i.test(f));
}

// Devuelve una fila por línea no vacía: { line, raw, date, explicitDate, a, b, sets } o { line, raw, error }.
export function parseImport(text, { today = todayISO() } = {}) {
  const rows = [];
  String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) return;
    const sep = csvSeparator(raw);
    let parsed;
    if (sep) {
      const fields = splitCsvLine(raw, sep);
      if (isHeader(fields)) return;
      parsed = parseCsvFields(fields, today);
    } else {
      parsed = parseTextLine(raw, today);
    }
    if (!parsed.error) parsed.error = setsError(parsed.sets);
    rows.push({ line: idx + 1, raw, ...parsed, error: parsed.error || null });
  });
  return rows;
}

// Clave canónica de un partido para detectar duplicados (no importa el orden
// de los jugadores dentro de la pareja ni qué pareja va primero).
function matchKey(aKeys, bKeys, sets) {
  let a = [...aKeys].sort().join('+');
  let b = [...bKeys].sort().join('+');
  let s = sets;
  if (b < a) { [a, b] = [b, a]; s = sets.map(([x, y]) => [y, x]); }
  return `${a}|${b}|${formatSets(s)}`;
}

// Cruza las filas parseadas con la liga: detecta jugadores nuevos, duplicados
// y arma la lista de partidos lista para enviar a la API.
export function resolveImport(rows, league, { createPlayers = true, skipDuplicates = true } = {}) {
  const known = new Map(league.players.map((p) => [nameKey(p.name), p]));
  const existing = new Map();
  for (const m of league.matches) {
    const key = matchKey(m.a.map((id) => keyOfId(league, id)), m.b.map((id) => keyOfId(league, id)), m.sets);
    if (!existing.has(key)) existing.set(key, new Set());
    existing.get(key).add(m.date);
  }

  const newPlayers = new Map();
  const items = rows.map((row) => {
    if (row.error) return { ...row, status: 'error' };
    const names = [...row.a, ...row.b];
    const keys = names.map(nameKey);
    if (new Set(keys).size !== 4) return { ...row, status: 'error', error: 'Un jugador está repetido en el partido' };
    const unknown = names.filter((n) => !known.has(nameKey(n)));
    if (unknown.length && !createPlayers) {
      return { ...row, status: 'error', error: `No están en la liga: ${unknown.join(', ')}` };
    }
    const dates = existing.get(matchKey(keys.slice(0, 2), keys.slice(2), row.sets));
    if (skipDuplicates && dates && (!row.explicitDate || dates.has(row.date))) {
      return { ...row, status: 'duplicate' };
    }
    for (const n of unknown) if (!newPlayers.has(nameKey(n))) newPlayers.set(nameKey(n), n);
    const ref = (n) => known.get(nameKey(n))?.id ?? cleanName(n);
    return {
      ...row,
      status: 'ok',
      match: { date: row.date, a: row.a.map(ref), b: row.b.map(ref), sets: row.sets },
    };
  });

  return {
    items,
    newPlayers: [...newPlayers.values()],
    matches: items.filter((i) => i.status === 'ok').map((i) => i.match),
  };
}

function keyOfId(league, id) {
  return nameKey(league.players.find((p) => p.id === id)?.name ?? id);
}

// ---------- Exportación ----------

export function toCSV(league) {
  const names = new Map(league.players.map((p) => [p.id, p.name]));
  const matches = [...league.matches].sort((x, y) =>
    x.date.localeCompare(y.date) || String(x.createdAt).localeCompare(String(y.createdAt)));
  const setCols = Math.max(3, ...matches.map((m) => m.sets.length));
  const header = [...CSV_HEADER.slice(0, 5), ...Array.from({ length: setCols }, (_, i) => `set${i + 1}`)];
  const quote = (v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(';')];
  for (const m of matches) {
    const sets = m.sets.map(([x, y]) => `${x}-${y}`);
    while (sets.length < setCols) sets.push('');
    lines.push([m.date, ...[...m.a, ...m.b].map((id) => names.get(id) ?? '?'), ...sets].map(quote).join(';'));
  }
  return lines.join('\r\n');
}
