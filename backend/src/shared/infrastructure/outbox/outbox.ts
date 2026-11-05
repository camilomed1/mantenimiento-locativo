import { Prisma } from '@prisma/client';
import { EventoDominio } from '../../domain/evento-dominio';

/**
 * Maps domain events to outbox rows. Repositories call this inside the same
 * transaction that saves the aggregate (transactional outbox pattern).
 */
export function filasOutbox(eventos: EventoDominio[]): Prisma.OutboxEventoCreateManyInput[] {
  return eventos.map((e) => ({
    tipo: e.tipo,
    agregadoId: e.agregadoId,
    payload: { ...e.payload, ocurridoEn: e.ocurridoEn.toISOString() } as Prisma.InputJsonObject,
  }));
}
