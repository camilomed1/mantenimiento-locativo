import { createHash } from 'node:crypto';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { ActividadProgramada, Ejecucion } from '../domain/ejecucion';
import { Evidencia } from '../domain/evidencia';
import { RegistrarEvidencia, RegistrarEvidenciaComando } from './evidencias.use-cases';
import { FinalizarEjecucion, IniciarEjecucion } from './gestionar-ejecucion.use-cases';
import { AlmacenamientoEvidencias, EjecucionRepositorio, ResultadoGuardado } from './puertos';
import { SincronizarEjecuciones } from './sincronizar-ejecuciones.use-case';

/** In-memory adapters with the same UNIQUE rules as PostgreSQL / MinIO. */
class RepoEnMemoria implements EjecucionRepositorio {
  ejecuciones = new Map<string, Ejecucion>();
  evidencias: Array<{ evidencia: Evidencia; operarioId: string }> = [];

  private copia(e: Ejecucion): Ejecucion {
    return Ejecucion.reconstituir({
      id: e.id,
      clientUuid: e.clientUuid,
      programacionId: e.programacionId,
      operarioId: e.operarioId,
      conjuntoId: e.conjuntoId,
      estado: e.estado,
      horaInicioDispositivo: e.horaInicioDispositivo,
      horaInicioServidor: e.horaInicioServidor,
      horaFinDispositivo: e.horaFinDispositivo,
      horaFinServidor: e.horaFinServidor,
      inconsistenciaHora: e.inconsistenciaHora,
      observaciones: e.observaciones,
      momentosRegistrados: this.evidencias.filter((x) => x.evidencia.ejecucionId === e.id).map((x) => x.evidencia.momento),
    });
  }
  async buscarPorClientUuid(c: string) {
    const e = this.ejecuciones.get(c);
    return e ? this.copia(e) : null;
  }
  async buscarPorProgramacion(p: string) {
    const e = [...this.ejecuciones.values()].find((x) => x.programacionId === p);
    return e ? this.copia(e) : null;
  }
  async guardarNueva(e: Ejecucion): Promise<ResultadoGuardado> {
    if (this.ejecuciones.has(e.clientUuid)) return 'CLIENT_UUID_DUPLICADO';
    this.ejecuciones.set(e.clientUuid, e);
    return 'GUARDADO';
  }
  async guardarFinalizacion(e: Ejecucion) {
    if (this.ejecuciones.get(e.clientUuid)?.estado === 'FINALIZADA') return false;
    this.ejecuciones.set(e.clientUuid, e);
    return true;
  }
  async buscarEvidenciaPorClientUuid(c: string) {
    return this.evidencias.find((x) => x.evidencia.clientUuid === c)?.evidencia ?? null;
  }
  async guardarEvidencia(e: Ejecucion, ev: Evidencia): Promise<ResultadoGuardado> {
    if (this.evidencias.some((x) => x.evidencia.clientUuid === ev.clientUuid)) return 'CLIENT_UUID_DUPLICADO';
    this.evidencias.push({ evidencia: ev, operarioId: e.operarioId });
    return 'GUARDADO';
  }
  async buscarEvidencia(id: string) {
    return this.evidencias.find((x) => x.evidencia.id === id) ?? null;
  }
}

class AlmacenamientoEnMemoria implements AlmacenamientoEvidencias {
  readonly bucket = 'evidencias';
  objetos = new Map<string, Buffer>();
  subidas = 0;
  async guardar(key: string, contenido: Buffer) {
    this.subidas++;
    this.objetos.set(key, contenido);
  }
  async urlFirmada(key: string) {
    return `http://minio.test/${key}?firma`;
  }
}

const integridad = new IntegridadTiempo({ toleranciaSegundos: 300, maxHorasOffline: 72, zonaHoraria: 'America/Bogota' });
const reloj = { ahora: () => new Date('2026-11-05T20:00:00Z') };
const actividad: ActividadProgramada = { id: 'prog-1', operarioId: 'op-1', conjuntoId: 'conj-A', publicada: true };
const programaciones = { obtenerActividad: async (id: string) => (id === actividad.id ? actividad : null) };
const registro = { error: jest.fn() };
const EJ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function montar() {
  const repo = new RepoEnMemoria();
  const almacen = new AlmacenamientoEnMemoria();
  const sync = new SincronizarEjecuciones(
    new IniciarEjecucion(repo, programaciones, reloj, integridad),
    new FinalizarEjecucion(repo, reloj, integridad),
    registro,
  );
  const subir = new RegistrarEvidencia(repo, almacen, reloj);
  return { repo, almacen, sync, subir };
}

function foto(momento: 'ANTES' | 'DURANTE' | 'DESPUES', n: number, contenido = Buffer.from(`jpeg-${momento}`)): RegistrarEvidenciaComando {
  return {
    operarioId: 'op-1',
    clientUuid: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`,
    ejecucionClientUuid: EJ,
    momento,
    sha256: createHash('sha256').update(contenido).digest('hex'),
    horaCaptura: new Date('2026-11-05T14:00:00Z'),
    latitud: null,
    longitud: null,
    archivo: { contenido, mimeType: 'image/jpeg' },
  };
}

const inicio = { tipo: 'INICIO' as const, operarioId: 'op-1', clientUuid: EJ, programacionId: 'prog-1', horaDispositivo: new Date('2026-11-05T13:00:00Z') };
const fin = { tipo: 'FIN' as const, operarioId: 'op-1', clientUuid: EJ, horaDispositivo: new Date('2026-11-05T15:00:00Z'), observaciones: null };

describe('Execution and evidence sync (offline queue)', () => {
  it('full flow: start, three photos, finish', async () => {
    const { sync, subir, repo, almacen } = montar();
    expect((await sync.ejecutar([inicio]))[0].estado).toBe('ACEPTADO');
    for (const [i, m] of (['ANTES', 'DURANTE', 'DESPUES'] as const).entries()) {
      expect((await subir.ejecutar(foto(m, i))).estado).toBe('ACEPTADO');
    }
    expect((await sync.ejecutar([fin]))[0].estado).toBe('ACEPTADO');
    expect(repo.ejecuciones.get(EJ)?.estado).toBe('FINALIZADA');
    expect(almacen.objetos.size).toBe(3);
  });

  it('re-uploading the same photo returns DUPLICADO and does not store it twice', async () => {
    const { sync, subir, repo, almacen } = montar();
    await sync.ejecutar([inicio]);
    expect((await subir.ejecutar(foto('ANTES', 0))).estado).toBe('ACEPTADO');
    expect((await subir.ejecutar(foto('ANTES', 0))).estado).toBe('DUPLICADO');
    expect(repo.evidencias).toHaveLength(1);
    expect(almacen.subidas).toBe(1);
  });

  it('a photo that arrives before its activity start is kept for retry', async () => {
    const { subir } = montar();
    const r = await subir.ejecutar(foto('ANTES', 0));
    expect(r.estado).toBe('REINTENTAR');
    expect(r.codigo).toBe('EJECUCION_NO_SINCRONIZADA');
  });

  it('a corrupted upload (hash mismatch) is retried, never stored', async () => {
    const { sync, subir, almacen } = montar();
    await sync.ejecutar([inicio]);
    const corrupta = { ...foto('ANTES', 0), archivo: { contenido: Buffer.from('truncated'), mimeType: 'image/jpeg' } };
    const r = await subir.ejecutar(corrupta);
    expect(r).toMatchObject({ estado: 'REINTENTAR', codigo: 'HASH_NO_COINCIDE' });
    expect(almacen.subidas).toBe(0);
  });

  it('finishing with missing photos is retried; finishing twice is DUPLICADO', async () => {
    const { sync, subir } = montar();
    await sync.ejecutar([inicio]);
    expect((await sync.ejecutar([fin]))[0]).toMatchObject({ estado: 'REINTENTAR', codigo: 'EVIDENCIAS_INCOMPLETAS' });
    for (const [i, m] of (['ANTES', 'DURANTE', 'DESPUES'] as const).entries()) await subir.ejecutar(foto(m, i));
    expect((await sync.ejecutar([fin]))[0].estado).toBe('ACEPTADO');
    expect((await sync.ejecutar([fin]))[0].estado).toBe('DUPLICADO');
  });

  it('INICIO is processed before FIN when both come in the same batch with equal times', async () => {
    const { sync } = montar();
    const r = await sync.ejecutar([{ ...fin, horaDispositivo: inicio.horaDispositivo }, inicio]);
    expect(r.map((x) => [x.operacion, x.estado])).toEqual([
      ['FIN', 'REINTENTAR'], // processed second: start is in, but photos are missing
      ['INICIO', 'ACEPTADO'],
    ]);
  });

  it('a concurrent retry of the same photo is DUPLICADO, not MOMENTO_YA_REGISTRADO', async () => {
    const { sync, subir, repo } = montar();
    await sync.ejecutar([inicio]);
    await subir.ejecutar(foto('ANTES', 0));
    // Second request missed the first lookup because the first was still in flight.
    jest.spyOn(repo, 'buscarEvidenciaPorClientUuid').mockResolvedValueOnce(null);
    expect((await subir.ejecutar(foto('ANTES', 0))).estado).toBe('DUPLICADO');
  });

  it('another operator cannot attach photos to my activity', async () => {
    const { sync, subir } = montar();
    await sync.ejecutar([inicio]);
    const r = await subir.ejecutar({ ...foto('ANTES', 0), operarioId: 'op-2' });
    expect(r).toMatchObject({ estado: 'RECHAZADO', codigo: 'ACTIVIDAD_NO_ASIGNADA' });
  });
});
