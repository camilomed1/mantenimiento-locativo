import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { FinalizarEjecucion, IniciarEjecucion } from './gestionar-ejecucion.use-cases';

export type OperacionEjecucion =
  | { tipo: 'INICIO'; operarioId: string; clientUuid: string; programacionId: string; horaDispositivo: Date }
  | { tipo: 'FIN'; operarioId: string; clientUuid: string; horaDispositivo: Date; observaciones: string | null };

export type ResultadoOperacion = ResultadoSync & { operacion: 'INICIO' | 'FIN' };

export interface Registro {
  error(mensaje: string): void;
}

/**
 * Use case: process the start/finish operations queued on the phone.
 * Oldest first; on a tie, INICIO goes before FIN. Results keep the order
 * the client sent (INICIO and FIN share the same client_uuid).
 */
export class SincronizarEjecuciones {
  constructor(
    private readonly iniciar: IniciarEjecucion,
    private readonly finalizar: FinalizarEjecucion,
    private readonly registro: Registro,
  ) {}

  async ejecutar(operaciones: OperacionEjecucion[]): Promise<ResultadoOperacion[]> {
    const indices = operaciones.map((_, i) => i);
    indices.sort((a, b) => {
      const diff = operaciones[a].horaDispositivo.getTime() - operaciones[b].horaDispositivo.getTime();
      if (diff !== 0) return diff;
      return operaciones[a].tipo === operaciones[b].tipo ? a - b : operaciones[a].tipo === 'INICIO' ? -1 : 1;
    });

    const resultados: ResultadoOperacion[] = new Array(operaciones.length);
    for (const i of indices) {
      const op = operaciones[i];
      try {
        const r = op.tipo === 'INICIO' ? await this.iniciar.ejecutar(op) : await this.finalizar.ejecutar(op);
        resultados[i] = { ...r, operacion: op.tipo };
      } catch (error) {
        this.registro.error(`Execution sync failed for ${op.clientUuid}: ${(error as Error).message}`);
        resultados[i] = {
          ...ResultadoSync.reintentar(op.clientUuid, 'ERROR_TEMPORAL', 'Try again later'),
          operacion: op.tipo,
        };
      }
    }
    return resultados;
  }
}
