import { randomBytes } from 'node:crypto';
import {
  LIMITS, byDate, cleanName, findPlayerByName, isPending, matchError, pairsKey, todayISO,
} from '../public/core.js';
import { readLeague, createLeague, updateLeague, ConflictError } from '../lib/store.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID_RE = /^[A-Za-z0-9]{6,24}$/;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newId(length) {
  return Array.from(randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handle(fn) {
  try {
    return json(200, await fn());
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    if (err instanceof ConflictError) {
      return json(409, { error: 'Hubo varios cambios al mismo tiempo. Probá de nuevo.' });
    }
    console.error(err);
    return json(500, { error: 'Error del servidor. Probá de nuevo en un rato.' });
  }
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 1_000_000) throw new HttpError(413, 'Demasiados datos de una vez');
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object') return body;
  } catch {}
  throw new HttpError(400, 'Pedido inválido');
}

function requireName(value, message) {
  const name = cleanName(value);
  if (!name) throw new HttpError(400, message);
  return name;
}

function addPlayer(league, rawName) {
  const name = requireName(rawName, 'Poné un nombre');
  if (findPlayerByName(league, name)) throw new HttpError(400, `Ya hay un jugador llamado "${name}"`);
  if (league.players.length >= LIMITS.players) {
    throw new HttpError(400, `La liga admite hasta ${LIMITS.players} jugadores`);
  }
  const player = { id: newId(8), name };
  league.players.push(player);
  return player;
}

// Un jugador se puede referenciar por id o por nombre (al importar).
function resolvePlayer(league, ref, create) {
  if (typeof ref !== 'string') throw new HttpError(400, 'Jugador inválido');
  const byId = league.players.find((p) => p.id === ref);
  if (byId) return byId.id;
  const byName = findPlayerByName(league, ref);
  if (byName) return byName.id;
  if (create && cleanName(ref)) return addPlayer(league, ref).id;
  throw new HttpError(400, `"${cleanName(ref)}" no está en la liga`);
}

// Al cargar un resultado se completa el partido programado: el indicado en
// `fillsId` o, si no se indica, el próximo por jugar entre esas mismas parejas.
function pendingToFill(league, match, fillsId) {
  if (fillsId) {
    const target = league.matches.find((m) => m.id === fillsId);
    if (!target) throw new HttpError(404, 'Ese partido programado ya no existe');
    if (!isPending(target)) throw new HttpError(409, 'Ese partido ya tiene el resultado cargado');
    return target;
  }
  const key = pairsKey(match.a, match.b);
  return league.matches.filter((m) => isPending(m) && pairsKey(m.a, m.b) === key).sort(byDate)[0] ?? null;
}

const toSets = (sets) => (Array.isArray(sets)
  ? sets.map((s) => (Array.isArray(s) ? [Number(s[0]), Number(s[1])] : [NaN, NaN]))
  : []);

async function mutate(id, fn) {
  if (!ID_RE.test(String(id))) throw new HttpError(404, 'No encontramos esta liga');
  const league = await updateLeague(id, fn);
  if (!league) throw new HttpError(404, 'No encontramos esta liga');
  return { league };
}

const actions = {
  async create({ name, players }) {
    const now = new Date().toISOString();
    const league = {
      id: newId(10),
      name: requireName(name, 'Poné un nombre para la liga'),
      rev: 1,
      createdAt: now,
      updatedAt: now,
      players: [],
      matches: [],
    };
    for (const p of Array.isArray(players) ? players : []) {
      if (cleanName(p) && !findPlayerByName(league, p)) addPlayer(league, p);
    }
    return { league: await createLeague(league) };
  },

  addMatches({ id, matches, createPlayers }) {
    if (!Array.isArray(matches) || matches.length === 0) throw new HttpError(400, 'No hay partidos para cargar');
    return mutate(id, (league) => {
      if (league.matches.length + matches.length > LIMITS.matches) {
        throw new HttpError(400, `La liga admite hasta ${LIMITS.matches} partidos`);
      }
      const now = new Date().toISOString();
      matches.forEach((m, i) => {
        const sets = toSets(m?.sets);
        const match = {
          id: newId(8),
          // Sin resultado es un partido por jugar, que puede no tener fecha.
          date: m?.date || (sets.length ? todayISO() : null),
          a: (Array.isArray(m?.a) ? m.a : []).map((ref) => resolvePlayer(league, ref, createPlayers)),
          b: (Array.isArray(m?.b) ? m.b : []).map((ref) => resolvePlayer(league, ref, createPlayers)),
          sets,
          createdAt: now,
        };
        const error = matchError(match, new Set(league.players.map((p) => p.id)));
        if (error) throw new HttpError(400, matches.length > 1 ? `Partido ${i + 1}: ${error}` : error);
        const target = sets.length ? pendingToFill(league, match, m?.fills) : null;
        if (target) Object.assign(target, { date: match.date, a: match.a, b: match.b, sets });
        else league.matches.push(match);
      });
      return league;
    });
  },

  deleteMatch({ id, matchId }) {
    return mutate(id, (league) => {
      league.matches = league.matches.filter((m) => m.id !== matchId);
      return league;
    });
  },

  addPlayer({ id, name }) {
    return mutate(id, (league) => {
      addPlayer(league, name);
      return league;
    });
  },

  renamePlayer({ id, playerId, name }) {
    return mutate(id, (league) => {
      const player = league.players.find((p) => p.id === playerId);
      if (!player) throw new HttpError(404, 'Ese jugador ya no está en la liga');
      const clean = requireName(name, 'Poné un nombre');
      const other = findPlayerByName(league, clean);
      if (other && other.id !== playerId) throw new HttpError(400, `Ya hay un jugador llamado "${clean}"`);
      player.name = clean;
      return league;
    });
  },

  removePlayer({ id, playerId }) {
    return mutate(id, (league) => {
      if (league.matches.some((m) => m.a.includes(playerId) || m.b.includes(playerId))) {
        throw new HttpError(400, 'Tiene partidos jugados o por jugar: borrá esos partidos primero');
      }
      league.players = league.players.filter((p) => p.id !== playerId);
      return league;
    });
  },

  renameLeague({ id, name }) {
    return mutate(id, (league) => {
      league.name = requireName(name, 'Poné un nombre para la liga');
      return league;
    });
  },
};

export function GET(request) {
  return handle(async () => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const league = ID_RE.test(id) ? await readLeague(id) : null;
    if (!league) throw new HttpError(404, 'No encontramos esta liga');
    return { league };
  });
}

export function POST(request) {
  return handle(async () => {
    const body = await readBody(request);
    const action = Object.hasOwn(actions, body.action) ? actions[body.action] : null;
    if (!action) throw new HttpError(400, 'Acción desconocida');
    return action(body);
  });
}
