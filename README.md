# Liga de pádel

Web para armar ligas de pádel en formato americano: cada jugador carga cómo salió su partido (sets y games) y la tabla se actualiza sola.

- **Puntos:** ganar suma 1 punto, perder 0.
- **Orden:** puntos; con los mismos puntos queda arriba quien jugó menos partidos.
- **Desempate** (mismos puntos y mismos partidos jugados), en este orden:
  1. diferencia de games (el super tie-break, un set que se gana con 10 o más, vale 1 game),
  2. diferencia de sets,
  3. resultado entre ellos en los partidos donde se enfrentaron como rivales (+1 por cada rival del grupo al que le ganó, −1 por cada uno con el que perdió).

  Si todo coincide, comparten la posición.

## Importar partidos

En *Partidos → Importar* se pega un partido por línea. El resultado va desde el lado de la primera pareja y la fecha al principio es opcional:

```
Ana / Bruno vs Carla / Dani 6-4 3-6 7-5
12/10 Ana / Carla vs Bruno / Dani 6-2 6-3
```

También acepta filas copiadas de Excel/Google Sheets o un CSV (separado por `;`, `,` o tabulaciones):

```
fecha;jugador1;jugador2;jugador3;jugador4;set1;set2;set3
2026-10-01;Ana;Bruno;Carla;Dani;6-4;3-6;10-8
```

**Fixture:** una línea sin resultado (por ejemplo `19/10 Ana / Dani vs Bruno / Carla`, o una fila de CSV con los sets vacíos) carga un partido *por jugar*. No cuenta en la tabla; en *Partidos → Por jugar* cada partido tiene un botón para cargar su resultado con las parejas y la fecha ya completas. Si se carga o importa un resultado de unas parejas que tenían un partido por jugar, se completa ese partido en vez de crear otro.

Antes de importar se ve una vista previa con los errores de cada línea, los jugadores nuevos y los partidos que ya estaban cargados (que se omiten). *Exportar* descarga los partidos en ese mismo formato.

## Cómo está hecho

- `public/`: la página (HTML, CSS y JavaScript sin compilación). `public/core.js` tiene la lógica de la tabla y del importador y la usan tanto el navegador como la API.
- `api/liga.js`: una función de Vercel que crea ligas y guarda partidos y jugadores.
- `lib/store.js`: cada liga es un JSON en Vercel Blob (privado). Las escrituras son condicionales por ETag, así dos personas cargando a la vez no se pisan.

## Desarrollo

```
npm install
npm run dev    # http://localhost:3000, guarda los datos en .data/
npm test
```
