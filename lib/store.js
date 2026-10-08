// Persistencia de ligas: un JSON por liga.
// En Vercel se usa Vercel Blob (privado) con escrituras condicionales por ETag,
// así dos cargas simultáneas no se pisan. En local, sin credenciales, se usan
// archivos en .data/ para poder desarrollar sin conexión.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const useBlob = Boolean(
  process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL,
);
const dataDir = path.resolve(process.env.LIGA_DATA_DIR || '.data');

export class ConflictError extends Error {}

async function blobRead(pathname) {
  const res = await get(pathname, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return { data: JSON.parse(text), etag: res.blob.etag };
}

async function blobWrite(pathname, data, etag) {
  try {
    await put(pathname, JSON.stringify(data), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : {}),
    });
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new ConflictError();
    throw err;
  }
}

async function fileRead(pathname) {
  try {
    const text = await readFile(path.join(dataDir, pathname), 'utf8');
    return { data: JSON.parse(text), etag: createHash('sha1').update(text).digest('hex') };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Las escrituras a un mismo archivo se encolan para que comparar y escribir sea atómico.
const fileLocks = new Map();

function fileWrite(pathname, data, etag) {
  const run = (fileLocks.get(pathname) ?? Promise.resolve()).then(async () => {
    const current = await fileRead(pathname);
    if (etag ? current?.etag !== etag : current) throw new ConflictError();
    const file = path.join(dataDir, pathname);
    await mkdir(path.dirname(file), { recursive: true });
    // Escribir a un temporal y renombrar, para que nadie lea un archivo a medias.
    await writeFile(`${file}.tmp`, JSON.stringify(data));
    await rename(`${file}.tmp`, file);
  });
  fileLocks.set(pathname, run.catch(() => {}));
  return run;
}

const read = useBlob ? blobRead : fileRead;
const write = useBlob ? blobWrite : fileWrite;
const leaguePath = (id) => `ligas/${id}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readLeague(id) {
  return (await read(leaguePath(id)))?.data ?? null;
}

export async function createLeague(league) {
  await write(leaguePath(league.id), league);
  return league;
}

// Lee la versión más reciente, aplica `mutate` y guarda solo si nadie la
// cambió en el medio; si alguien la cambió, reintenta sobre la nueva versión.
export async function updateLeague(id, mutate) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await read(leaguePath(id));
    if (!current) return null;
    const next = mutate(current.data);
    next.rev = (current.data.rev ?? 0) + 1;
    next.updatedAt = new Date().toISOString();
    try {
      await write(leaguePath(id), next, current.etag);
      return next;
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      await sleep(Math.min(1000, 40 * 2 ** attempt) + Math.random() * 100);
    }
  }
  throw new ConflictError();
}
