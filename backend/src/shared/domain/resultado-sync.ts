import { ErrorDominio } from './error-dominio';

/**
 * Per-record result returned to the offline client after a sync attempt.
 *
 * ACEPTADO    -> stored now. Mark as synced.
 * DUPLICADO   -> already stored by a previous attempt (same client_uuid). Mark as synced.
 * RECHAZADO   -> breaks a business rule. Stop retrying and show the reason.
 * REINTENTAR  -> temporary problem. Keep it in the queue.
 */
export type EstadoSync = 'ACEPTADO' | 'DUPLICADO' | 'RECHAZADO' | 'REINTENTAR';

export interface ResultadoSync {
  clientUuid: string;
  estado: EstadoSync;
  codigo?: string;
  mensaje?: string;
  /** Server reception time, so the client can show both clocks. */
  horaServidor?: string;
}

export const ResultadoSync = {
  aceptado(clientUuid: string, horaServidor: Date): ResultadoSync {
    return { clientUuid, estado: 'ACEPTADO', horaServidor: horaServidor.toISOString() };
  },
  duplicado(clientUuid: string, horaServidor?: Date): ResultadoSync {
    return { clientUuid, estado: 'DUPLICADO', horaServidor: horaServidor?.toISOString() };
  },
  rechazado(clientUuid: string, codigo: string, mensaje: string): ResultadoSync {
    return { clientUuid, estado: 'RECHAZADO', codigo, mensaje };
  },
  reintentar(clientUuid: string, codigo: string, mensaje: string): ResultadoSync {
    return { clientUuid, estado: 'REINTENTAR', codigo, mensaje };
  },
  desdeError(clientUuid: string, error: ErrorDominio): ResultadoSync {
    return error.reintentable
      ? ResultadoSync.reintentar(clientUuid, error.codigo, error.message)
      : ResultadoSync.rechazado(clientUuid, error.codigo, error.message);
  },
};
