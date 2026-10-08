import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStandings, parseImport, resolveImport, setsError, summarize, toCSV, parseDate,
} from '../public/core.js';

const players = ['Ana', 'Bruno', 'Carla', 'Dani', 'Eva'].map((name, i) => ({ id: `p${i}`, name }));
const league = (matches) => ({ players, matches });
const match = (a, b, sets, date = '2026-10-01') => ({ id: Math.random().toString(36), date, a, b, sets });

test('summarize cuenta sets y games; el super tie-break vale un game', () => {
  assert.deepEqual(summarize([[6, 4], [3, 6], [10, 8]]), { setsA: 2, setsB: 1, gamesA: 10, gamesB: 10, winner: 'a' });
  assert.equal(summarize([[4, 6]]).winner, 'b');
});

test('setsError rechaza empates y resultados sin ganador', () => {
  assert.equal(setsError([[6, 4], [6, 3]]), null);
  assert.match(setsError([[6, 6]]), /empatado/);
  assert.match(setsError([[6, 4], [4, 6]]), /no hay ganador/);
  assert.match(setsError([]), /Falta/);
});

test('tabla: 1 punto por victoria y, a igualdad de puntos, menos partidos arriba', () => {
  const rows = computeStandings(league([
    match(['p0', 'p1'], ['p2', 'p3'], [[6, 4], [6, 4]]), // ganan Ana y Bruno
    match(['p0', 'p2'], ['p1', 'p4'], [[6, 2], [6, 2]]), // ganan Ana y Carla
    match(['p3', 'p4'], ['p1', 'p2'], [[7, 5], [6, 4]]), // ganan Dani y Eva
  ]));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.Ana.pts, 2);
  assert.equal(byName.Ana.pos, 1);
  // Bruno y Carla: 1 punto en 3 partidos. Dani y Eva: 1 punto en 2 partidos → arriba.
  assert.deepEqual(rows.map((r) => r.name), ['Ana', 'Dani', 'Eva', 'Bruno', 'Carla']);
  // Sin desempate: misma posición cuando coinciden puntos y partidos.
  assert.equal(byName.Dani.pos, 2);
  assert.equal(byName.Eva.pos, 2);
  assert.equal(byName.Bruno.pos, 4);
  assert.equal(byName.Carla.pos, 4);
  assert.equal(byName.Ana.gf - byName.Ana.gc, 4 + 8);
});

test('parseImport entiende texto libre con y sin fecha', () => {
  const rows = parseImport(`
    Ana / Bruno vs Carla / Dani 6-4 3-6 7-5
    12/10/2026 Ana y Carla contra Bruno y Dani: 6-2, 6-3
    # comentario
    Ana / Bruno vs Carla 6-4
    Ana / Bruno vs Carla / Dani
    Ana / Bruno vs Carla / Dani 7-6(5) 6-4
  `, { today: '2026-10-08' });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], {
    line: 2, raw: 'Ana / Bruno vs Carla / Dani 6-4 3-6 7-5', date: '2026-10-08', explicitDate: false,
    a: ['Ana', 'Bruno'], b: ['Carla', 'Dani'], sets: [[6, 4], [3, 6], [7, 5]], error: null,
  });
  assert.equal(rows[1].date, '2026-10-12');
  assert.deepEqual(rows[1].sets, [[6, 2], [6, 3]]);
  assert.match(rows[2].error, /2 jugadores/);
  assert.match(rows[3].error, /Falta el resultado/);
  assert.deepEqual(rows[4].sets, [[7, 6], [6, 4]]);
});

test('parseImport entiende CSV con ; o , y filas de planilla', () => {
  const rows = parseImport([
    'fecha;jugador1;jugador2;jugador3;jugador4;set1;set2;set3',
    '2026-10-01;Ana;Bruno;Carla;Dani;6-4;3-6;10-8',
    '01/10/2026,Ana,Carla,Bruno,Dani,6-2,6-3,',
    'Ana\tEva\tBruno\tDani\t6\t3\t6\t4',
    '31/02/2026;Ana;Bruno;Carla;Dani;6-4;6-4',
  ].join('\n'), { today: '2026-10-08' });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].sets, [[6, 4], [3, 6], [10, 8]]);
  assert.equal(rows[1].date, '2026-10-01');
  assert.deepEqual(rows[1].b, ['Bruno', 'Dani']);
  assert.deepEqual(rows[2].sets, [[6, 3], [6, 4]]);
  assert.equal(rows[2].date, '2026-10-08');
  assert.match(rows[3].error, /Fecha inválida/);
});

test('resolveImport marca jugadores nuevos, duplicados y repetidos', () => {
  const l = league([match(['p0', 'p1'], ['p2', 'p3'], [[6, 4], [6, 4]])]);
  const rows = parseImport([
    'bruno / ANA vs Dani / Carla 6-4 6-4', // mismo partido (otro orden) → duplicado
    'Carla / Dani vs Ana / Bruno 4-6 4-6', // mismo partido visto desde la otra pareja
    'Ana / Zoe vs Carla / Dani 6-1 6-1', // Zoe es nueva
    'Ana / Ana vs Carla / Dani 6-1 6-1',
  ].join('\n'), { today: '2026-10-08' });
  const res = resolveImport(rows, l);
  assert.deepEqual(res.items.map((i) => i.status), ['duplicate', 'duplicate', 'ok', 'error']);
  assert.deepEqual(res.newPlayers, ['Zoe']);
  assert.deepEqual(res.matches[0].a, ['p0', 'Zoe']);
  const strict = resolveImport(rows, l, { createPlayers: false, skipDuplicates: false });
  assert.deepEqual(strict.items.map((i) => i.status), ['ok', 'ok', 'error', 'error']);
});

test('toCSV se puede volver a importar', () => {
  const l = league([match(['p0', 'p1'], ['p2', 'p3'], [[6, 4], [3, 6], [7, 5]])]);
  const rows = parseImport(toCSV(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, null);
  assert.equal(resolveImport(rows, l).items[0].status, 'duplicate');
});

test('parseDate', () => {
  assert.equal(parseDate('2026-1-5'), '2026-01-05');
  assert.equal(parseDate('5/1/26'), '2026-01-05');
  assert.equal(parseDate('5/1', new Date(2027, 0, 1)), '2027-01-05');
  assert.equal(parseDate('30/02/2026'), null);
});
