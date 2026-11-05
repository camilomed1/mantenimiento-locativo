import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { RegistrarMarcaAsistencia, RegistrarMarcaComando } from './registrar-marca.use-case';

export interface Registro {
  error(mensaje: string): void;
}

/**
 * Use case: process a batch of marks sent by the offline queue.
 * Marks are processed oldest first (a check-in before its check-out) and each
 * one gets its own result, so one bad record never blocks the rest.
 */
export class SincronizarAsistencias {
  constructor(
    private readonly registrarMarca: RegistrarMarcaAsistencia,
    private readonly registro: Registro,
  ) {}

  async ejecutar(comandos: RegistrarMarcaComando[]): Promise<ResultadoSync[]> {
    const ordenados = [...comandos].sort((a, b) => a.horaDispositivo.getTime() - b.horaDispositivo.getTime());
    const resultados = new Map<string, ResultadoSync>();

    for (const cmd of ordenados) {
      try {
        resultados.set(cmd.clientUuid, await this.registrarMarca.ejecutar(cmd));
      } catch (error) {
        // Infrastructure failure (DB down...): the client keeps it and retries.
        this.registro.error(`Attendance sync failed for ${cmd.clientUuid}: ${(error as Error).message}`);
        resultados.set(cmd.clientUuid, ResultadoSync.reintentar(cmd.clientUuid, 'ERROR_TEMPORAL', 'Try again later'));
      }
    }
    // Answer in the same order the client sent them.
    return comandos.map((c) => resultados.get(c.clientUuid)!);
  }
}
