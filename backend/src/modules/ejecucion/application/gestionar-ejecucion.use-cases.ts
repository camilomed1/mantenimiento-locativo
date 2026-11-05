import { randomUUID } from 'node:crypto';
import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Reloj } from '../../../shared/domain/reloj';
import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { Ejecucion } from '../domain/ejecucion';
import { EjecucionRepositorio, ProgramacionConsulta } from './puertos';

export interface IniciarEjecucionComando {
  operarioId: string;
  clientUuid: string;
  programacionId: string;
  horaDispositivo: Date;
}

export interface FinalizarEjecucionComando {
  operarioId: string;
  /** Same client_uuid created when the activity was started. */
  clientUuid: string;
  horaDispositivo: Date;
  observaciones: string | null;
}

/** Use case: the operator taps "Start" on an activity (possibly offline). */
export class IniciarEjecucion {
  constructor(
    private readonly repositorio: EjecucionRepositorio,
    private readonly programaciones: ProgramacionConsulta,
    private readonly reloj: Reloj,
    private readonly integridad: IntegridadTiempo,
  ) {}

  async ejecutar(cmd: IniciarEjecucionComando): Promise<ResultadoSync> {
    const existente = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
    if (existente) return duplicadoSiEsDelOperario(existente, cmd.operarioId, cmd.clientUuid);

    try {
      const actividad = await this.programaciones.obtenerActividad(cmd.programacionId);
      if (!actividad) throw new ErrorDominio('PROGRAMACION_NO_EXISTE', 'Scheduled activity not found');

      // Domain rules first (ownership, published), so other operators learn nothing.
      const ejecucion = Ejecucion.iniciar({
        id: randomUUID(),
        clientUuid: cmd.clientUuid,
        operarioId: cmd.operarioId,
        actividad,
        horaDispositivo: cmd.horaDispositivo,
        horaServidor: this.reloj.ahora(),
        integridad: this.integridad,
      });

      if (await this.repositorio.buscarPorProgramacion(cmd.programacionId)) {
        throw new ErrorDominio('ACTIVIDAD_YA_INICIADA', 'This activity was already started from another device');
      }

      switch (await this.repositorio.guardarNueva(ejecucion)) {
        case 'GUARDADO':
          return ResultadoSync.aceptado(cmd.clientUuid, ejecucion.horaInicioServidor);
        case 'CLIENT_UUID_DUPLICADO':
          return ResultadoSync.duplicado(cmd.clientUuid);
        case 'REGLA_UNICIDAD_VIOLADA':
          throw new ErrorDominio('ACTIVIDAD_YA_INICIADA', 'This activity was already started from another device');
      }
    } catch (error) {
      if (!(error instanceof ErrorDominio)) throw error;
      // A concurrent retry of this same start may have won the race.
      const guardadoMientras = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
      if (guardadoMientras) return duplicadoSiEsDelOperario(guardadoMientras, cmd.operarioId, cmd.clientUuid);
      return ResultadoSync.desdeError(cmd.clientUuid, error);
    }
  }
}

/** Use case: the operator taps "Finish". Idempotent on the start's client_uuid. */
export class FinalizarEjecucion {
  constructor(
    private readonly repositorio: EjecucionRepositorio,
    private readonly reloj: Reloj,
    private readonly integridad: IntegridadTiempo,
  ) {}

  async ejecutar(cmd: FinalizarEjecucionComando): Promise<ResultadoSync> {
    try {
      const ejecucion = await this.repositorio.buscarPorClientUuid(cmd.clientUuid);
      if (!ejecucion) {
        throw new ErrorDominio('EJECUCION_NO_SINCRONIZADA', 'The start of this activity has not synced yet', true);
      }
      if (ejecucion.operarioId !== cmd.operarioId) {
        throw new ErrorDominio('CLIENT_UUID_EN_USO', 'client_uuid belongs to another operator');
      }
      if (ejecucion.estado === 'FINALIZADA') {
        return ResultadoSync.duplicado(cmd.clientUuid, ejecucion.horaFinServidor ?? undefined);
      }

      const horaServidor = this.reloj.ahora();
      ejecucion.finalizar({
        horaDispositivo: cmd.horaDispositivo,
        horaServidor,
        observaciones: cmd.observaciones,
        integridad: this.integridad,
      });

      // Conditional update: only one concurrent request can finish it.
      return (await this.repositorio.guardarFinalizacion(ejecucion))
        ? ResultadoSync.aceptado(cmd.clientUuid, horaServidor)
        : ResultadoSync.duplicado(cmd.clientUuid);
    } catch (error) {
      if (error instanceof ErrorDominio) return ResultadoSync.desdeError(cmd.clientUuid, error);
      throw error;
    }
  }
}

export function duplicadoSiEsDelOperario(ejecucion: Ejecucion, operarioId: string, clientUuid: string): ResultadoSync {
  return ejecucion.operarioId === operarioId
    ? ResultadoSync.duplicado(clientUuid, ejecucion.horaInicioServidor)
    : ResultadoSync.rechazado(clientUuid, 'CLIENT_UUID_EN_USO', 'client_uuid belongs to another operator');
}
