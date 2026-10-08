# Liga de pádel

Web para armar ligas de pádel en formato americano: cada jugador carga cómo salió su partido (sets y games) y la tabla se actualiza sola.

- **Puntos:** ganar suma 1 punto, perder 0.
- **Orden:** puntos; con los mismos puntos queda arriba quien jugó menos partidos. Si coinciden puntos y partidos jugados, comparten posición (no hay desempate).
- **Diferencia de sets y games:** se muestran como dato informativo. El super tie-break (un set que se gana con 10 o más) cuenta como un game.

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
