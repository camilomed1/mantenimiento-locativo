import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CANAL_EVENTOS, RedisPublicador } from '../redis/redis.providers';

interface FilaOutbox {
  id: string;
  tipo: string;
  agregado_id: string;
  payload: Record<string, unknown>;
  creado_en: Date;
}

const INTERVALO_MS = 1000;
const LOTE = 50;

/**
 * Reads pending outbox rows and publishes them to Redis, where the
 * monitoring SSE stream picks them up. FOR UPDATE SKIP LOCKED lets several
 * backend instances run the relay without publishing the same row twice.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private temporizador?: NodeJS.Timeout;
  private ocupado = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisPublicador,
  ) {}

  onApplicationBootstrap(): void {
    this.temporizador = setInterval(() => void this.publicarPendientes(), INTERVALO_MS);
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  async publicarPendientes(): Promise<number> {
    if (this.ocupado) return 0;
    this.ocupado = true;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const filas = await tx.$queryRaw<FilaOutbox[]>`
          SELECT id, tipo, agregado_id, payload, creado_en
          FROM outbox_evento
          WHERE estado = 'PENDIENTE'
          ORDER BY creado_en
          LIMIT ${LOTE}
          FOR UPDATE SKIP LOCKED`;
        if (filas.length === 0) return 0;

        for (const fila of filas) {
          await this.redis.cliente.publish(
            CANAL_EVENTOS,
            JSON.stringify({ id: fila.id, tipo: fila.tipo, agregadoId: fila.agregado_id, payload: fila.payload }),
          );
        }
        await tx.outboxEvento.updateMany({
          where: { id: { in: filas.map((f) => f.id) } },
          data: { estado: 'PUBLICADO', publicadoEn: new Date() },
        });
        return filas.length;
      });
    } catch (error) {
      // Rows stay PENDIENTE and are retried on the next tick.
      this.logger.warn(`Outbox relay failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.ocupado = false;
    }
  }
}
