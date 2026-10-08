import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(os.tmpdir(), 'liga-'));
process.env.LIGA_DATA_DIR = dir;
const { GET, POST } = await import('../api/liga.js');
test.after(() => rm(dir, { recursive: true, force: true }));

async function call(body) {
  const res = await POST(new Request('http://x/api/liga', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
}

test('crear liga, cargar, importar y borrar partidos', async () => {
  const created = await call({ action: 'create', name: '  Liga  jueves ', players: ['Ana', 'ana', 'Bruno', 'Carla', 'Dani'] });
  assert.equal(created.status, 200);
  const { id } = created.league;
  assert.equal(created.league.name, 'Liga jueves');
  assert.equal(created.league.players.length, 4);
  const [ana, bruno, carla, dani] = created.league.players.map((p) => p.id);

  const one = await call({ action: 'addMatches', id, matches: [{ date: '2026-10-01', a: [ana, bruno], b: [carla, dani], sets: [[6, 4], [6, 2]] }] });
  assert.equal(one.status, 200);
  assert.equal(one.league.matches.length, 1);

  const bad = await call({ action: 'addMatches', id, matches: [{ date: '2026-10-01', a: [ana, ana], b: [carla, dani], sets: [[6, 4]] }] });
  assert.equal(bad.status, 400);

  const unknown = await call({ action: 'addMatches', id, matches: [{ date: '2026-10-02', a: [ana, 'Zoe'], b: [carla, dani], sets: [[6, 4]] }] });
  assert.equal(unknown.status, 400);
  assert.match(unknown.error, /Zoe/);

  const imported = await call({
    action: 'addMatches', id, createPlayers: true,
    matches: [
      { date: '2026-10-02', a: [ana, 'Zoe'], b: [carla, dani], sets: [[6, 4]] },
      { date: '2026-10-02', a: ['zoe', 'BRUNO'], b: [carla, dani], sets: [[2, 6], [3, 6]] },
    ],
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.league.players.length, 5);
  assert.equal(imported.league.matches.length, 3);

  const removeBusy = await call({ action: 'removePlayer', id, playerId: ana });
  assert.equal(removeBusy.status, 400);

  const del = await call({ action: 'deleteMatch', id, matchId: imported.league.matches[0].id });
  assert.equal(del.league.matches.length, 2);

  const got = await GET(new Request(`http://x/api/liga?id=${id}`));
  const body = await got.json();
  assert.equal(body.league.rev, del.league.rev);
  assert.equal((await GET(new Request('http://x/api/liga?id=nope123'))).status, 404);
});

test('cargas simultáneas no se pisan', async () => {
  const { league } = await call({ action: 'create', name: 'Simultánea', players: ['A', 'B', 'C', 'D'] });
  const [a, b, c, d] = league.players.map((p) => p.id);
  const results = await Promise.all(Array.from({ length: 8 }, () => call({
    action: 'addMatches', id: league.id, matches: [{ date: '2026-10-01', a: [a, b], b: [c, d], sets: [[6, 1]] }],
  })));
  assert.deepEqual(results.map((r) => r.status), Array(8).fill(200));
  const final = await (await GET(new Request(`http://x/api/liga?id=${league.id}`))).json();
  assert.equal(final.league.matches.length, 8);
});

test('acciones inválidas', async () => {
  assert.equal((await call({ action: 'nope' })).status, 400);
  assert.equal((await call({ action: 'create', name: '   ' })).status, 400);
  assert.equal((await call({ action: 'addPlayer', id: 'missing1', name: 'X' })).status, 404);
  assert.equal((await call({ action: 'toString' })).status, 400);
});
