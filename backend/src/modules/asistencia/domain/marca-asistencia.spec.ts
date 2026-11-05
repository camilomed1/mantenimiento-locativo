import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Coordenada, Geocerca } from './geocerca';
import { DatosNuevaMarca, MarcaAsistencia } from './marca-asistencia';

// Pure domain tests: no database, no Nest, no network.
const integridad = new IntegridadTiempo({ toleranciaSegundos: 300, maxHorasOffline: 72, zonaHoraria: 'America/Bogota' });
const geocerca = new Geocerca(new Coordenada(2.936, -75.281), 150);
const SERVIDOR = new Date('2026-11-05T13:00:00.000Z'); // 08:00 in Bogota

let n = 0;
function datos(parcial: Partial<DatosNuevaMarca> = {}): DatosNuevaMarca {
  n++;
  return {
    id: `id-${n}`,
    clientUuid: `uuid-${n}`,
    operarioId: 'op-1',
    conjuntoId: 'conj-A',
    tipo: 'ENTRADA',
    horaDispositivo: new Date('2026-11-05T12:55:00.000Z'),
    ubicacion: null,
    ...parcial,
  };
}

function registrar(d: DatosNuevaMarca, marcasDelDia: MarcaAsistencia[] = []) {
  return MarcaAsistencia.registrar(d, { horaServidor: SERVIDOR, integridad, geocerca, marcasDelDia });
}

function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDominio) return e.codigo;
    throw e;
  }
  return 'SIN_ERROR';
}

describe('MarcaAsistencia', () => {
  it('registers a check-in, keeps both clocks and raises an event', () => {
    const marca = registrar(datos());
    expect(marca.fecha).toBe('2026-11-05');
    expect(marca.horaServidor).toBe(SERVIDOR);
    expect(marca.desfaseSegundos).toBe(300);
    expect(marca.inconsistenciaHora).toBe(false);
    expect(marca.extraerEventos().map((e) => e.tipo)).toEqual(['asistencia.EntradaRegistrada']);
  });

  it('uses the local (Bogota) day, not the UTC day', () => {
    // 2026-11-06 02:00 UTC is still 2026-11-05 21:00 in Bogota.
    const marca = MarcaAsistencia.registrar(datos({ horaDispositivo: new Date('2026-11-06T02:00:00Z') }), {
      horaServidor: new Date('2026-11-06T02:01:00Z'),
      integridad,
      geocerca,
      marcasDelDia: [],
    });
    expect(marca.fecha).toBe('2026-11-05');
  });

  it('rejects a second check-in at the same site on the same day', () => {
    const entrada = registrar(datos());
    expect(codigoDe(() => registrar(datos(), [entrada]))).toBe('ENTRADA_DUPLICADA');
  });

  it('rejects a check-in at another site while one is still open', () => {
    const entrada = registrar(datos());
    expect(codigoDe(() => registrar(datos({ conjuntoId: 'conj-B' }), [entrada]))).toBe('ENTRADA_ABIERTA');
  });

  it('allows a check-in at another site after checking out', () => {
    const entrada = registrar(datos());
    const salida = registrar(datos({ tipo: 'SALIDA', horaDispositivo: new Date('2026-11-05T12:58:00Z') }), [entrada]);
    expect(() => registrar(datos({ conjuntoId: 'conj-B' }), [entrada, salida])).not.toThrow();
  });

  it('rejects a check-out without a check-in', () => {
    expect(codigoDe(() => registrar(datos({ tipo: 'SALIDA' })))).toBe('SALIDA_SIN_ENTRADA');
  });

  it('rejects a check-out earlier than the check-in', () => {
    const entrada = registrar(datos());
    const salida = datos({ tipo: 'SALIDA', horaDispositivo: new Date('2026-11-05T12:00:00Z') });
    expect(codigoDe(() => registrar(salida, [entrada]))).toBe('SALIDA_ANTERIOR_A_ENTRADA');
  });

  it('flags a device clock that is ahead of the server (possible tampering)', () => {
    const marca = registrar(datos({ horaDispositivo: new Date('2026-11-05T13:30:00Z') }));
    expect(marca.desfaseSegundos).toBe(-1800);
    expect(marca.inconsistenciaHora).toBe(true);
  });

  it('does not flag a mark captured offline a few hours earlier', () => {
    const marca = registrar(datos({ horaDispositivo: new Date('2026-11-05T09:00:00Z') }));
    expect(marca.inconsistenciaHora).toBe(false);
  });

  it('checks the GPS position against the site geofence', () => {
    const dentro = registrar(datos({ ubicacion: { coordenada: new Coordenada(2.9365, -75.2812) } }));
    const fuera = registrar(datos({ conjuntoId: 'conj-C', ubicacion: { coordenada: new Coordenada(2.96, -75.3) } }));
    const sinGps = registrar(datos({ conjuntoId: 'conj-D' }));
    expect(dentro.dentroGeocerca).toBe(true);
    expect(fuera.dentroGeocerca).toBe(false);
    expect(sinGps.dentroGeocerca).toBeNull();
  });
});
