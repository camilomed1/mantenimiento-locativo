import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { DatosEvidencia, Ejecucion } from './ejecucion';
import { MomentoEvidencia } from './evidencia';

const integridad = new IntegridadTiempo({ toleranciaSegundos: 300, maxHorasOffline: 72, zonaHoraria: 'America/Bogota' });
const INICIO = new Date('2026-11-05T13:00:00Z');
const actividad = { id: 'prog-1', operarioId: 'op-1', conjuntoId: 'conj-A', publicada: true };

function iniciar(parcial: Partial<typeof actividad> = {}, operarioId = 'op-1') {
  return Ejecucion.iniciar({
    id: 'ej-1',
    clientUuid: 'uuid-ej',
    operarioId,
    actividad: { ...actividad, ...parcial },
    horaDispositivo: INICIO,
    horaServidor: INICIO,
    integridad,
  });
}

function foto(momento: MomentoEvidencia, extra: Partial<DatosEvidencia> = {}): DatosEvidencia {
  return {
    id: `ev-${momento}`,
    clientUuid: `uuid-${momento}`,
    momento,
    bucket: 'evidencias',
    objectKey: `k/${momento}.jpg`,
    sha256: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    tamanoBytes: 300_000,
    horaCaptura: INICIO,
    horaRecepcion: INICIO,
    latitud: null,
    longitud: null,
    ...extra,
  };
}

function error(fn: () => unknown): ErrorDominio {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDominio) return e;
    throw e;
  }
  throw new Error('Expected a domain error');
}

const fin = (minutos: number) => ({
  horaDispositivo: new Date(INICIO.getTime() + minutos * 60_000),
  horaServidor: new Date(INICIO.getTime() + minutos * 60_000),
  observaciones: null,
  integridad,
});

describe('Ejecucion', () => {
  it('only the assigned operator can start the activity', () => {
    expect(error(() => iniciar({}, 'op-2')).codigo).toBe('ACTIVIDAD_NO_ASIGNADA');
  });

  it('cannot start an activity from an unpublished schedule', () => {
    expect(error(() => iniciar({ publicada: false })).codigo).toBe('PROGRAMACION_NO_PUBLICADA');
  });

  it('accepts one photo per moment and rejects a second one', () => {
    const e = iniciar();
    e.agregarEvidencia(foto('ANTES'));
    expect(error(() => e.agregarEvidencia(foto('ANTES', { id: 'x', clientUuid: 'y' }))).codigo).toBe('MOMENTO_YA_REGISTRADO');
  });

  it('rejects photos that are not compressed images', () => {
    const e = iniciar();
    expect(error(() => e.agregarEvidencia(foto('ANTES', { tamanoBytes: 5_000_000 }))).codigo).toBe('TAMANO_INVALIDO');
    expect(error(() => e.agregarEvidencia(foto('ANTES', { mimeType: 'application/pdf' }))).codigo).toBe('TIPO_NO_PERMITIDO');
  });

  it('cannot finish without the three photos, and that error is retryable', () => {
    const e = iniciar();
    e.agregarEvidencia(foto('ANTES'));
    const err = error(() => e.finalizar(fin(60)));
    expect(err.codigo).toBe('EVIDENCIAS_INCOMPLETAS');
    expect(err.reintentable).toBe(true);
    expect(e.momentosFaltantes()).toEqual(['DURANTE', 'DESPUES']);
  });

  it('finishes with three photos and raises the events', () => {
    const e = iniciar();
    (['ANTES', 'DURANTE', 'DESPUES'] as const).forEach((m) => e.agregarEvidencia(foto(m)));
    e.finalizar(fin(90));
    expect(e.estado).toBe('FINALIZADA');
    expect(e.extraerEventos().map((ev) => ev.tipo)).toEqual([
      'ejecucion.ActividadIniciada',
      'ejecucion.EvidenciaRecibida',
      'ejecucion.EvidenciaRecibida',
      'ejecucion.EvidenciaRecibida',
      'ejecucion.ActividadFinalizada',
    ]);
  });

  it('rejects an end time earlier than the start time', () => {
    const e = iniciar();
    (['ANTES', 'DURANTE', 'DESPUES'] as const).forEach((m) => e.agregarEvidencia(foto(m)));
    expect(error(() => e.finalizar(fin(-10))).codigo).toBe('FIN_ANTERIOR_A_INICIO');
  });

  it('rejects photos after the activity is finished', () => {
    const e = iniciar();
    (['ANTES', 'DURANTE', 'DESPUES'] as const).forEach((m) => e.agregarEvidencia(foto(m)));
    e.finalizar(fin(90));
    expect(error(() => e.agregarEvidencia(foto('DESPUES'))).codigo).toBe('EJECUCION_FINALIZADA');
  });
});
