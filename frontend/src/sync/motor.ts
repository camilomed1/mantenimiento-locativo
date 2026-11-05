import { db, type ActividadAgenda, type Ejecucion, type Foto, type InfoSync, type Marca } from '../db/db';
import { ErrorHttp, pedir, pedirJson, postJson, SesionExpiradaError, SinConexionError } from '../lib/api';

/** Per-record answer of the server (same contract as the backend). */
export interface ResultadoServidor {
  clientUuid: string;
  estado: 'ACEPTADO' | 'DUPLICADO' | 'RECHAZADO' | 'REINTENTAR';
  codigo?: string;
  mensaje?: string;
  horaServidor?: string;
}

export interface ResumenSync {
  enviados: number;
  rechazados: number;
  pendientes: number;
  sinConexion: boolean;
  sesionExpirada: boolean;
  error?: string;
}

const LOTE = 100;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Exponential backoff with jitter: 5 s, 10 s, 20 s ... up to 5 min. */
export function esperaReintento(intentos: number, azar = Math.random()): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, intentos - 1));
  return Math.round(base * (0.8 + 0.4 * azar));
}

/** Applies one server result to the local sync info of a record. */
export function aplicarResultado(info: InfoSync, r: ResultadoServidor, ahora: number): InfoSync {
  switch (r.estado) {
    case 'ACEPTADO':
    case 'DUPLICADO':
      return {
        sync: 'SINCRONIZADO',
        intentos: info.intentos + 1,
        proximoIntento: 0,
        horaServidor: r.horaServidor ?? info.horaServidor,
      };
    case 'RECHAZADO':
      return { ...info, sync: 'RECHAZADO', intentos: info.intentos + 1, codigo: r.codigo, mensaje: r.mensaje };
    case 'REINTENTAR': {
      const intentos = info.intentos + 1;
      return { ...info, sync: 'PENDIENTE', intentos, proximoIntento: ahora + esperaReintento(intentos), codigo: r.codigo, mensaje: r.mensaje };
    }
  }
}

const listo = (i: InfoSync | null | undefined, ahora: number): i is InfoSync =>
  !!i && i.sync === 'PENDIENTE' && i.proximoIntento <= ahora;

function trozos<T>(lista: T[], n: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n));
  return r;
}

/**
 * Sends everything that is pending, in an order that respects the server's
 * dependencies:
 *   1. attendance marks   2. activity starts   3. photos   4. activity finishes
 * A photo waits until its start is synced; a finish waits for its 3 photos.
 * When the network fails the cycle stops; nothing is lost, it resumes later.
 */
export class MotorSync {
  private enCurso: Promise<ResumenSync> | null = null;
  private oyentes = new Set<(estado: { sincronizando: boolean; resumen?: ResumenSync }) => void>();

  constructor(private readonly reloj: () => number = Date.now) {}

  suscribir(fn: (estado: { sincronizando: boolean; resumen?: ResumenSync }) => void): () => void {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  private avisar(sincronizando: boolean, resumen?: ResumenSync) {
    this.oyentes.forEach((fn) => fn({ sincronizando, resumen }));
  }

  /** Runs one sync cycle. Concurrent calls (and other tabs) share the same run. */
  sincronizar(): Promise<ResumenSync> {
    this.enCurso ??= (async () => {
      this.avisar(true);
      try {
        const ejecutar = () => this.ciclo();
        const resumen =
          typeof navigator !== 'undefined' && navigator.locks
            ? await navigator.locks.request('sync-mantenimiento', ejecutar)
            : await ejecutar();
        this.avisar(false, resumen);
        return resumen;
      } finally {
        this.enCurso = null;
      }
    })();
    return this.enCurso;
  }

  private async ciclo(): Promise<ResumenSync> {
    const resumen: ResumenSync = { enviados: 0, rechazados: 0, pendientes: 0, sinConexion: false, sesionExpirada: false };
    try {
      await this.enviarMarcas(resumen);
      await this.enviarInicios(resumen);
      await this.enviarFotos(resumen);
      await this.enviarFinales(resumen);
      await descargarAgenda(this.reloj());
      await db.ajustes.put({ clave: 'ultimaSync', valor: new Date(this.reloj()).toISOString() });
    } catch (error) {
      if (error instanceof SinConexionError) resumen.sinConexion = true;
      else if (error instanceof SesionExpiradaError) resumen.sesionExpirada = true;
      else if (error instanceof ErrorHttp && error.status >= 500) resumen.sinConexion = true;
      else resumen.error = (error as Error).message;
    }
    resumen.pendientes = await contarPendientes();
    return resumen;
  }

  private contar(resumen: ResumenSync, r: ResultadoServidor) {
    if (r.estado === 'ACEPTADO' || r.estado === 'DUPLICADO') resumen.enviados++;
    if (r.estado === 'RECHAZADO') resumen.rechazados++;
  }

  private async enviarMarcas(resumen: ResumenSync): Promise<void> {
    const ahora = this.reloj();
    const marcas = (await db.marcas.where('sync').equals('PENDIENTE').toArray())
      .filter((m) => listo(m, ahora))
      .sort((a, b) => a.horaDispositivo.localeCompare(b.horaDispositivo));

    for (const lote of trozos(marcas, LOTE)) {
      const { resultados } = await postJson<{ resultados: ResultadoServidor[] }>('/asistencia/sync', {
        marcas: lote.map((m) => ({
          clientUuid: m.clientUuid,
          conjuntoId: m.conjuntoId,
          tipo: m.tipo,
          horaDispositivo: m.horaDispositivo,
          ...(m.ubicacion ?? {}),
        })),
      }).catch((e) => this.rechazarSiInvalido(e, lote.map((m) => m.clientUuid)));

      const ahoraResp = this.reloj();
      await db.transaction('rw', db.marcas, async () => {
        for (const r of resultados) {
          const m = lote.find((x) => x.clientUuid === r.clientUuid);
          if (!m) continue;
          this.contar(resumen, r);
          await db.marcas.put({ ...m, ...aplicarResultado(m, r, ahoraResp) } as Marca);
        }
      });
    }
  }

  private async enviarInicios(resumen: ResumenSync): Promise<void> {
    const ahora = this.reloj();
    const ejecuciones = (await db.ejecuciones.toArray()).filter((e) => listo(e.inicio, ahora));
    for (const lote of trozos(ejecuciones, LOTE)) {
      const { resultados } = await postJson<{ resultados: ResultadoServidor[] }>('/ejecuciones/sync', {
        operaciones: lote.map((e) => ({
          tipo: 'INICIO',
          clientUuid: e.clientUuid,
          programacionId: e.programacionId,
          horaDispositivo: e.horaInicio,
        })),
      }).catch((e) => this.rechazarSiInvalido(e, lote.map((x) => x.clientUuid)));
      await this.guardarEjecuciones(lote, resultados, 'inicio', resumen);
    }
  }

  private async enviarFotos(resumen: ResumenSync): Promise<void> {
    const ahora = this.reloj();
    const fotos = (await db.fotos.where('sync').equals('PENDIENTE').toArray())
      .filter((f) => listo(f, ahora))
      .sort((a, b) => a.horaCaptura.localeCompare(b.horaCaptura));

    for (const foto of fotos) {
      const ejecucion = await db.ejecuciones.get(foto.ejecucionClientUuid);
      // The server needs the start first; the photo waits for the next cycle.
      if (ejecucion?.inicio.sync !== 'SINCRONIZADO' || !foto.blob) continue;

      const form = new FormData();
      form.append('clientUuid', foto.clientUuid);
      form.append('ejecucionClientUuid', foto.ejecucionClientUuid);
      form.append('momento', foto.momento);
      form.append('sha256', foto.sha256);
      form.append('horaCaptura', foto.horaCaptura);
      if (foto.ubicacion) {
        form.append('latitud', String(foto.ubicacion.latitud));
        form.append('longitud', String(foto.ubicacion.longitud));
      }
      form.append('foto', foto.blob, `${foto.momento.toLowerCase()}.jpg`);

      let r: ResultadoServidor;
      const resp = await pedir('/ejecuciones/evidencias', { method: 'POST', body: form });
      if (resp.ok) r = await resp.json();
      else if (resp.status >= 400 && resp.status < 500 && resp.status !== 401 && resp.status !== 408 && resp.status !== 429) {
        r = { clientUuid: foto.clientUuid, estado: 'RECHAZADO', codigo: `HTTP_${resp.status}`, mensaje: 'La foto no fue aceptada' };
      } else throw new ErrorHttp(resp.status, resp.statusText);

      this.contar(resumen, r);
      const info = aplicarResultado(foto, r, this.reloj());
      // Free space on the phone: once stored on the server only the thumbnail stays.
      const blob = info.sync === 'SINCRONIZADO' ? null : foto.blob;
      await db.fotos.put({ ...foto, ...info, blob } as Foto);
    }
  }

  private async enviarFinales(resumen: ResumenSync): Promise<void> {
    const ahora = this.reloj();
    const candidatas = (await db.ejecuciones.toArray()).filter((e) => e.inicio.sync === 'SINCRONIZADO' && listo(e.fin, ahora));
    const lote: Ejecucion[] = [];
    for (const e of candidatas) {
      const fotos = await db.fotos.where('ejecucionClientUuid').equals(e.clientUuid).toArray();
      if (fotos.filter((f) => f.sync === 'SINCRONIZADO').length >= 3) lote.push(e);
    }
    for (const trozo of trozos(lote, LOTE)) {
      const { resultados } = await postJson<{ resultados: ResultadoServidor[] }>('/ejecuciones/sync', {
        operaciones: trozo.map((e) => ({
          tipo: 'FIN',
          clientUuid: e.clientUuid,
          horaDispositivo: e.horaFin,
          ...(e.observaciones ? { observaciones: e.observaciones } : {}),
        })),
      }).catch((err) => this.rechazarSiInvalido(err, trozo.map((x) => x.clientUuid)));
      await this.guardarEjecuciones(trozo, resultados, 'fin', resumen);
    }
  }

  private async guardarEjecuciones(
    lote: Ejecucion[],
    resultados: ResultadoServidor[],
    parte: 'inicio' | 'fin',
    resumen: ResumenSync,
  ): Promise<void> {
    const ahora = this.reloj();
    await db.transaction('rw', db.ejecuciones, async () => {
      for (const r of resultados) {
        const e = lote.find((x) => x.clientUuid === r.clientUuid);
        const info = e?.[parte];
        if (!e || !info) continue;
        this.contar(resumen, r);
        await db.ejecuciones.update(e.clientUuid, { [parte]: aplicarResultado(info, r, ahora) });
      }
    });
  }

  /**
   * A 400 means the payload itself is invalid (it will never be accepted):
   * reject those records instead of retrying forever. Anything else bubbles up.
   */
  private rechazarSiInvalido(error: unknown, uuids: string[]): { resultados: ResultadoServidor[] } {
    if (error instanceof ErrorHttp && (error.status === 400 || error.status === 403)) {
      return {
        resultados: uuids.map((clientUuid) => ({
          clientUuid,
          estado: 'RECHAZADO' as const,
          codigo: `HTTP_${error.status}`,
          mensaje: error.message,
        })),
      };
    }
    throw error;
  }
}

/** Downloads the next 7 days of published activities into IndexedDB. */
export async function descargarAgenda(ahora: number = Date.now()): Promise<void> {
  const sesion = await db.sesion.get('actual');
  if (sesion?.usuario.rol !== 'OPERARIO') return;
  const desde = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(ahora));
  const r = await pedirJson<{
    actividades: Array<Omit<ActividadAgenda, 'ejecucionServidor'> & { ejecucion: { clientUuid: string; estado: string } | null }>;
  }>(`/agenda?desde=${desde}`);
  await db.transaction('rw', db.agenda, async () => {
    // Replace the downloaded window; past days stay for history.
    await db.agenda.where('fecha').aboveOrEqual(desde).delete();
    await db.agenda.bulkPut(
      r.actividades.map(({ ejecucion, ...a }) => ({
        ...a,
        ejecucionServidor: ejecucion ? { clientUuid: ejecucion.clientUuid, estado: ejecucion.estado } : null,
      })),
    );
  });
}

export async function contarPendientes(): Promise<number> {
  const [marcas, fotos, ejecuciones] = await Promise.all([
    db.marcas.where('sync').equals('PENDIENTE').count(),
    db.fotos.where('sync').equals('PENDIENTE').count(),
    db.ejecuciones.toArray(),
  ]);
  const ops = ejecuciones.reduce(
    (n, e) => n + (e.inicio.sync === 'PENDIENTE' ? 1 : 0) + (e.fin?.sync === 'PENDIENTE' ? 1 : 0),
    0,
  );
  return marcas + fotos + ops;
}

export const motor = new MotorSync();
