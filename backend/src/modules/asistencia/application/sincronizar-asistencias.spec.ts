import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Coordenada, Geocerca } from '../domain/geocerca';
import { MarcaAsistencia } from '../domain/marca-asistencia';
import { AsistenciaRepositorio, ResultadoGuardado } from './puertos';
import { RegistrarMarcaAsistencia, RegistrarMarcaComando } from './registrar-marca.use-case';
import { SincronizarAsistencias } from './sincronizar-asistencias.use-case';

/**
 * In-memory adapter that mimics the UNIQUE constraints of the real table.
 * Swapping Prisma for this class without touching the use case is the
 * hexagonal architecture at work.
 */
class RepositorioEnMemoria implements AsistenciaRepositorio {
  readonly filas: MarcaAsistencia[] = [];
  eventosGuardados = 0;

  async buscarPorClientUuid(clientUuid: string) {
    return this.filas.find((m) => m.clientUuid === clientUuid) ?? null;
  }
  async listarDelDia(operarioId: string, fecha: string) {
    return this.filas.filter((m) => m.operarioId === operarioId && m.fecha === fecha);
  }
  async guardar(marca: MarcaAsistencia): Promise<ResultadoGuardado> {
    if (this.filas.some((m) => m.clientUuid === marca.clientUuid)) return 'CLIENT_UUID_DUPLICADO';
    if (
      this.filas.some(
        (m) => m.operarioId === marca.operarioId && m.conjuntoId === marca.conjuntoId && m.fecha === marca.fecha && m.tipo === marca.tipo,
      )
    ) {
      return 'REGLA_UNICIDAD_VIOLADA';
    }
    this.filas.push(marca);
    this.eventosGuardados += marca.extraerEventos().length;
    return 'GUARDADO';
  }
}

const integridad = new IntegridadTiempo({ toleranciaSegundos: 300, maxHorasOffline: 72, zonaHoraria: 'America/Bogota' });
const reloj = { ahora: () => new Date('2026-11-05T22:00:00Z') };
const conjuntos = { obtenerGeocerca: async () => new Geocerca(new Coordenada(2.936, -75.281), 150) };
const agenda = { estaProgramado: async (_o: string, conjuntoId: string) => conjuntoId !== 'no-programado' };
const registro = { error: jest.fn() };

function crear(repo: AsistenciaRepositorio = new RepositorioEnMemoria()) {
  const registrar = new RegistrarMarcaAsistencia(repo, conjuntos, agenda, reloj, integridad);
  return new SincronizarAsistencias(registrar, registro);
}

const entrada: RegistrarMarcaComando = {
  operarioId: 'op-1',
  clientUuid: '11111111-1111-4111-8111-111111111111',
  conjuntoId: 'conj-A',
  tipo: 'ENTRADA',
  horaDispositivo: new Date('2026-11-05T12:00:00Z'),
};
const salida: RegistrarMarcaComando = {
  ...entrada,
  clientUuid: '22222222-2222-4222-8222-222222222222',
  tipo: 'SALIDA',
  horaDispositivo: new Date('2026-11-05T21:00:00Z'),
};

describe('Attendance sync (offline queue)', () => {
  it('re-sending the same batch never duplicates rows (idempotency by client_uuid)', async () => {
    const repo = new RepositorioEnMemoria();
    const sync = crear(repo);

    const primera = await sync.ejecutar([entrada, salida]);
    // The network drops before the phone gets the answer, so it sends everything again.
    const segunda = await sync.ejecutar([entrada, salida]);

    expect(primera.map((r) => r.estado)).toEqual(['ACEPTADO', 'ACEPTADO']);
    expect(segunda.map((r) => r.estado)).toEqual(['DUPLICADO', 'DUPLICADO']);
    expect(repo.filas).toHaveLength(2);
    expect(repo.eventosGuardados).toBe(2);
  });

  it('processes check-in before check-out even if the client sends them out of order', async () => {
    const resultados = await crear().ejecutar([salida, entrada]);
    expect(resultados.map((r) => [r.clientUuid, r.estado])).toEqual([
      [salida.clientUuid, 'ACEPTADO'],
      [entrada.clientUuid, 'ACEPTADO'],
    ]);
  });

  it('a mark with a new client_uuid but the same data is rejected, not duplicated', async () => {
    const repo = new RepositorioEnMemoria();
    const sync = crear(repo);
    await sync.ejecutar([entrada]);
    const [r] = await sync.ejecutar([{ ...entrada, clientUuid: '33333333-3333-4333-8333-333333333333' }]);
    expect(r.estado).toBe('RECHAZADO');
    expect(r.codigo).toBe('ENTRADA_DUPLICADA');
    expect(repo.filas).toHaveLength(1);
  });

  it('when two requests race, the UNIQUE constraint turns the loser into DUPLICADO', async () => {
    const repo = new RepositorioEnMemoria();
    // Simulate: lookup says "not found", but another request inserts first.
    jest.spyOn(repo, 'buscarPorClientUuid').mockResolvedValueOnce(null);
    await repo.guardar(
      MarcaAsistencia.registrar(
        { id: 'otro', clientUuid: entrada.clientUuid, operarioId: 'op-1', conjuntoId: 'conj-A', tipo: 'ENTRADA', horaDispositivo: entrada.horaDispositivo, ubicacion: null },
        { horaServidor: reloj.ahora(), integridad, geocerca: await conjuntos.obtenerGeocerca(), marcasDelDia: [] },
      ),
    );
    const [r] = await crear(repo).ejecutar([entrada]);
    expect(r.estado).toBe('DUPLICADO');
    expect(repo.filas).toHaveLength(1);
  });

  it('one bad mark does not block the rest of the batch', async () => {
    const resultados = await crear().ejecutar([
      { ...entrada, conjuntoId: 'no-programado', clientUuid: '44444444-4444-4444-8444-444444444444' },
      entrada,
    ]);
    expect(resultados.map((r) => r.estado)).toEqual(['RECHAZADO', 'ACEPTADO']);
    expect(resultados[0].codigo).toBe('NO_PROGRAMADO');
  });

  it('an infrastructure failure is answered with REINTENTAR so the phone keeps the record', async () => {
    const repo = new RepositorioEnMemoria();
    jest.spyOn(repo, 'guardar').mockRejectedValueOnce(new Error('connection refused'));
    const [r] = await crear(repo).ejecutar([entrada]);
    expect(r.estado).toBe('REINTENTAR');
    expect(registro.error).toHaveBeenCalled();
  });
});
