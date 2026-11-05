import { randomUUID } from 'node:crypto';
import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Reloj } from '../../../shared/domain/reloj';
import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { Coordenada } from '../domain/geocerca';
import { MarcaAsistencia, TipoMarca } from '../domain/marca-asistencia';
import { AgendaConsulta, AsistenciaRepositorio, ConjuntoConsulta } from './puertos';

export interface RegistrarMarcaComando {
  /** Always taken from the token, never from the request body. */
  operarioId: string;
  clientUuid: string;
  conjuntoId: string;
  tipo: TipoMarca;
  horaDispositivo: Date;
  latitud?: number;
  longitud?: number;
  precisionMetros?: number;
}

/**
 * Use case: register one check-in / check-out captured on the phone.
 * Idempotent: sending the same client_uuid again returns DUPLICADO and never
 * creates a second row.
 */
export class RegistrarMarcaAsistencia {
  constructor(
    private readonly repositorio: AsistenciaRepositorio,
    private readonly conjuntos: ConjuntoConsulta,
    private readonly agenda: AgendaConsulta,
    private readonly reloj: Reloj,
    private readonly integridad: IntegridadTiempo,
  ) {}

  async ejecutar(cmd: RegistrarMarcaComando): Promise<ResultadoSync> {
    // 1) Idempotency check before any rule runs.
    const existente = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
    if (existente) return this.comoDuplicado(existente, cmd);

    try {
      const geocerca = await this.conjuntos.obtenerGeocerca(cmd.conjuntoId);
      if (!geocerca) throw new ErrorDominio('CONJUNTO_NO_EXISTE', 'Site not found');

      const fecha = this.integridad.fechaLocal(cmd.horaDispositivo);
      if (!(await this.agenda.estaProgramado(cmd.operarioId, cmd.conjuntoId, fecha))) {
        throw new ErrorDominio('NO_PROGRAMADO', `Operator is not scheduled at this site on ${fecha}`);
      }

      const marca = MarcaAsistencia.registrar(
        {
          id: randomUUID(),
          clientUuid: cmd.clientUuid,
          operarioId: cmd.operarioId,
          conjuntoId: cmd.conjuntoId,
          tipo: cmd.tipo,
          horaDispositivo: cmd.horaDispositivo,
          ubicacion:
            cmd.latitud !== undefined && cmd.longitud !== undefined
              ? { coordenada: new Coordenada(cmd.latitud, cmd.longitud), precisionMetros: cmd.precisionMetros }
              : null,
        },
        {
          horaServidor: this.reloj.ahora(),
          integridad: this.integridad,
          geocerca,
          marcasDelDia: await this.repositorio.listarDelDia(cmd.operarioId, fecha),
        },
      );

      // 2) The UNIQUE constraints are the last line of defense against races.
      switch (await this.repositorio.guardar(marca)) {
        case 'GUARDADO':
          return ResultadoSync.aceptado(marca.clientUuid, marca.horaServidor);
        case 'CLIENT_UUID_DUPLICADO': {
          const ganador = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
          return ganador ? this.comoDuplicado(ganador, cmd) : ResultadoSync.duplicado(cmd.clientUuid);
        }
        case 'REGLA_UNICIDAD_VIOLADA':
          throw new ErrorDominio(
            cmd.tipo === 'ENTRADA' ? 'ENTRADA_DUPLICADA' : 'SALIDA_DUPLICADA',
            'A mark of this type already exists for this site today',
          );
      }
    } catch (error) {
      if (!(error instanceof ErrorDominio)) throw error;
      // A concurrent retry of this same record may have been saved while we
      // validated; then the rule "fired" against our own row. Report DUPLICADO.
      const guardadoMientras = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
      if (guardadoMientras) return this.comoDuplicado(guardadoMientras, cmd);
      return ResultadoSync.desdeError(cmd.clientUuid, error);
    }
  }

  private comoDuplicado(existente: MarcaAsistencia, cmd: RegistrarMarcaComando): ResultadoSync {
    if (existente.operarioId !== cmd.operarioId) {
      return ResultadoSync.rechazado(cmd.clientUuid, 'CLIENT_UUID_EN_USO', 'client_uuid belongs to another operator');
    }
    return ResultadoSync.duplicado(existente.clientUuid, existente.horaServidor);
  }
}
