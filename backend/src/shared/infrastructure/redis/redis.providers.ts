import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIGURACION, Configuracion } from '../../../config/configuracion';

/** Channel where the outbox relay publishes domain events. */
export const CANAL_EVENTOS = 'eventos-dominio';

/**
 * Redis is not a source of truth: if it is down, sync keeps working and only
 * the real-time feed pauses. Connections retry forever in the background.
 */
function crearConexion(config: Configuracion, nombre: string, maxRetriesPerRequest: number | null): Redis {
  const logger = new Logger(nombre);
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.puerto,
    password: config.redis.password,
    maxRetriesPerRequest,
    retryStrategy: (intentos) => Math.min(intentos * 500, 10_000),
  });
  redis.on('error', (e) => logger.warn(`Redis: ${e.message}`));
  return redis;
}

/** Connection used for commands and PUBLISH. */
@Injectable()
export class RedisPublicador implements OnModuleDestroy {
  readonly cliente: Redis;
  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    // Fail fast: the outbox relay retries on its next tick.
    this.cliente = crearConexion(config, 'RedisPublicador', 1);
  }
  onModuleDestroy(): void {
    this.cliente.disconnect();
  }
}

/** A SUBSCRIBE connection cannot run other commands, so it is separate. */
@Injectable()
export class RedisSuscriptor implements OnModuleDestroy {
  readonly cliente: Redis;
  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    // Queue SUBSCRIBE until Redis is reachable; ioredis re-subscribes on reconnect.
    this.cliente = crearConexion(config, 'RedisSuscriptor', null);
  }
  onModuleDestroy(): void {
    this.cliente.disconnect();
  }
}
