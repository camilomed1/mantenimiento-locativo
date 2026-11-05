import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, nuevoInfoSync, type ActividadAgenda } from '../db/db';
import { fechaLocal } from '../lib/utilidades';
import { ErrorLocal, finalizarActividad, iniciarActividad, registrarMarca } from './acciones';
import { aplicarResultado, contarPendientes, esperaReintento, motor as motorGlobal, MotorSync } from './motor';

/**
 * Fake backend that follows the real API contract: idempotent by
 * client_uuid, photos need a synced start, finish needs 3 photos.
 */
class ServidorFalso {
  caido = false;
  tokenValido = 'token-1';
  llamadas: string[] = [];
  marcas = new Set<string>();
  inicios = new Set<string>();
  finales = new Set<string>();
  fotos = new Map<string, string>(); // fotoUuid -> ejecucionUuid
  reintentarInicios = false;

  fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (this.caido) throw new TypeError('Failed to fetch');
    const ruta = url.replace(/^\/api/, '').split('?')[0];
    const auth = new Headers(init.headers).get('Authorization');
    if (ruta === '/auth/refresh') {
      this.tokenValido = 'token-2';
      return json({ accessToken: 'token-2', refreshToken: 'refresh-2' });
    }
    if (auth !== `Bearer ${this.tokenValido}`) return json({ message: 'Unauthorized' }, 401);
    this.llamadas.push(ruta);

    if (ruta === '/agenda') return json({ actividades: [] });
    if (ruta === '/asistencia/sync') {
      const { marcas } = JSON.parse(String(init.body));
      return json({ resultados: marcas.map((m: { clientUuid: string }) => this.idempotente(this.marcas, m.clientUuid)) });
    }
    if (ruta === '/ejecuciones/sync') {
      const { operaciones } = JSON.parse(String(init.body));
      return json({
        resultados: operaciones.map((o: { tipo: string; clientUuid: string }) => {
          if (o.tipo === 'INICIO') {
            if (this.reintentarInicios) return { clientUuid: o.clientUuid, estado: 'REINTENTAR', codigo: 'ERROR_TEMPORAL' };
            return this.idempotente(this.inicios, o.clientUuid);
          }
          const fotos = [...this.fotos.values()].filter((e) => e === o.clientUuid).length;
          if (fotos < 3) return { clientUuid: o.clientUuid, estado: 'REINTENTAR', codigo: 'EVIDENCIAS_INCOMPLETAS' };
          return this.idempotente(this.finales, o.clientUuid);
        }),
      });
    }
    if (ruta === '/ejecuciones/evidencias') {
      const form = init.body as FormData;
      const uuid = String(form.get('clientUuid'));
      const ejecucion = String(form.get('ejecucionClientUuid'));
      if (!this.inicios.has(ejecucion)) return json({ clientUuid: uuid, estado: 'REINTENTAR', codigo: 'EJECUCION_NO_SINCRONIZADA' });
      if (this.fotos.has(uuid)) return json({ clientUuid: uuid, estado: 'DUPLICADO' });
      this.fotos.set(uuid, ejecucion);
      return json({ clientUuid: uuid, estado: 'ACEPTADO', horaServidor: new Date().toISOString() });
    }
    return json({ message: 'Not found' }, 404);
  });

  private idempotente(vistos: Set<string>, clientUuid: string) {
    if (vistos.has(clientUuid)) return { clientUuid, estado: 'DUPLICADO' };
    vistos.add(clientUuid);
    return { clientUuid, estado: 'ACEPTADO', horaServidor: new Date().toISOString() };
  }
}

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

const hoy = fechaLocal();
const actividad: ActividadAgenda = {
  programacionId: 'prog-1',
  fecha: hoy,
  tipoServicio: 'PISCINA',
  actividad: 'Limpieza de piscina',
  descripcion: null,
  conjunto: { id: 'conj-1', nombre: 'Los Almendros', direccion: 'Calle 8', latitud: 2.936, longitud: -75.281, radioGeocercaMetros: 150 },
  ejecucionServidor: null,
};

/** Stores a photo directly (the canvas compression needs a browser). */
async function guardarFoto(ejecucionClientUuid: string, momento: 'ANTES' | 'DURANTE' | 'DESPUES') {
  await db.fotos.add({
    clientUuid: `foto-${momento}`,
    ejecucionClientUuid,
    momento,
    blob: new Blob(['jpeg']),
    miniatura: new Blob(['mini']),
    sha256: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    tamanoBytes: 4,
    horaCaptura: new Date().toISOString(),
    ubicacion: null,
    ...nuevoInfoSync(),
  });
}

let servidor: ServidorFalso;
let motor: MotorSync;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.sesion.put({
    id: 'actual',
    accessToken: 'token-1',
    refreshToken: 'refresh-1',
    usuario: { id: 'u1', nombre: 'Carlos', rol: 'OPERARIO', operarioId: 'op-1' },
    expirada: false,
  });
  await db.agenda.put(actividad);
  servidor = new ServidorFalso();
  servidor.caido = true; // actions are captured offline
  vi.stubGlobal('fetch', servidor.fetch);
  motor = new MotorSync();
});

afterEach(() => vi.unstubAllGlobals());

/** Captures a full workday offline: check-in, start, 3 photos, finish. */
async function jornadaSinConexion() {
  await registrarMarca('conj-1', 'ENTRADA');
  const e = await iniciarActividad(actividad);
  for (const m of ['ANTES', 'DURANTE', 'DESPUES'] as const) await guardarFoto(e.clientUuid, m);
  await finalizarActividad(e.clientUuid, 'Sin novedad');
  await registrarMarca('conj-1', 'SALIDA');
  await esperarSyncDeFondo();
  return e;
}

/** Each action fires a background sync; let it finish (offline) before toggling the network. */
async function esperarSyncDeFondo() {
  await motorGlobal.sincronizar();
}

describe('offline capture', () => {
  it('everything is saved locally with no network and stays pending', async () => {
    await jornadaSinConexion();
    const r = await motor.sincronizar();
    expect(r.sinConexion).toBe(true);
    // 2 marks + start + 3 photos + finish
    expect(await contarPendientes()).toBe(7);
  });

  it('local rules give immediate feedback without the server', async () => {
    await registrarMarca('conj-1', 'ENTRADA');
    await expect(registrarMarca('conj-1', 'ENTRADA')).rejects.toBeInstanceOf(ErrorLocal);
    const e = await iniciarActividad(actividad);
    await expect(finalizarActividad(e.clientUuid, '')).rejects.toThrow(/Faltan fotos/);
  });

  it('cannot start an activity before checking in at the site', async () => {
    await expect(iniciarActividad(actividad)).rejects.toThrow(/entrada/);
  });
});

describe('sync when the network comes back', () => {
  it('sends in dependency order and leaves nothing pending', async () => {
    await jornadaSinConexion();
    await esperarSyncDeFondo();
    servidor.caido = false;

    const r = await motor.sincronizar();

    expect(r).toMatchObject({ sinConexion: false, pendientes: 0, enviados: 7, rechazados: 0 });
    expect(servidor.llamadas).toEqual([
      '/asistencia/sync',
      '/ejecuciones/sync', // start
      '/ejecuciones/evidencias',
      '/ejecuciones/evidencias',
      '/ejecuciones/evidencias',
      '/ejecuciones/sync', // finish
      '/agenda',
    ]);
  });

  it('frees phone storage: the full photo is deleted once the server has it', async () => {
    await jornadaSinConexion();
    await esperarSyncDeFondo();
    servidor.caido = false;
    await motor.sincronizar();
    const fotos = await db.fotos.toArray();
    expect(fotos.every((f) => f.blob === null && f.miniatura !== null)).toBe(true);
  });

  it('if the answer is lost and everything is resent, the server sees DUPLICADO, not new rows', async () => {
    await jornadaSinConexion();
    await esperarSyncDeFondo();
    servidor.caido = false;
    await motor.sincronizar();
    // Simulate a lost response: mark the records pending again and resend.
    await db.marcas.toCollection().modify({ sync: 'PENDIENTE' });
    const r = await motor.sincronizar();
    expect(r.enviados).toBe(2);
    expect(servidor.marcas.size).toBe(2);
  });

  it('a temporary server error keeps the record and backs off', async () => {
    await registrarMarca('conj-1', 'ENTRADA');
    await iniciarActividad(actividad);
    await esperarSyncDeFondo();
    servidor.caido = false;
    servidor.reintentarInicios = true;

    await motor.sincronizar();
    const e = await db.ejecuciones.toCollection().first();
    expect(e?.inicio.sync).toBe('PENDIENTE');
    expect(e?.inicio.intentos).toBe(1);
    expect(e?.inicio.proximoIntento).toBeGreaterThan(Date.now());

    // An immediate second cycle does not hammer the server.
    servidor.llamadas = [];
    await motor.sincronizar();
    expect(servidor.llamadas).not.toContain('/ejecuciones/sync');
  });

  it('photos wait while their activity start is not synced', async () => {
    await registrarMarca('conj-1', 'ENTRADA');
    const e = await iniciarActividad(actividad);
    await guardarFoto(e.clientUuid, 'ANTES');
    await esperarSyncDeFondo();
    servidor.caido = false;
    servidor.reintentarInicios = true;
    await motor.sincronizar();
    expect(servidor.llamadas).not.toContain('/ejecuciones/evidencias');
    expect((await db.fotos.get('foto-ANTES'))?.intentos).toBe(0);
  });

  it('refreshes an expired access token once and continues', async () => {
    await registrarMarca('conj-1', 'ENTRADA');
    await esperarSyncDeFondo();
    servidor.caido = false;
    servidor.tokenValido = 'token-2'; // token-1 expired while offline
    const r = await motor.sincronizar();
    expect(r.pendientes).toBe(0);
    expect((await db.sesion.get('actual'))?.accessToken).toBe('token-2');
  });
});

describe('retry policy', () => {
  it('backoff grows exponentially and is capped at 5 minutes', () => {
    expect(esperaReintento(1, 0.5)).toBe(5_000);
    expect(esperaReintento(2, 0.5)).toBe(10_000);
    expect(esperaReintento(20, 0.5)).toBe(300_000);
  });

  it('RECHAZADO stops retrying; DUPLICADO counts as synced', () => {
    const base = nuevoInfoSync();
    expect(aplicarResultado(base, { clientUuid: 'x', estado: 'RECHAZADO', codigo: 'NO_PROGRAMADO' }, 0).sync).toBe('RECHAZADO');
    expect(aplicarResultado(base, { clientUuid: 'x', estado: 'DUPLICADO' }, 0).sync).toBe('SINCRONIZADO');
  });
});
