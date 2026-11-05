import { Global, Module } from '@nestjs/common';
import { CONFIGURACION, Configuracion, cargarConfiguracion } from '../../config/configuracion';
import { IntegridadTiempo } from '../domain/integridad-tiempo';
import { RELOJ } from '../domain/reloj';
import { PrismaService } from './prisma/prisma.service';
import { RedisPublicador, RedisSuscriptor } from './redis/redis.providers';
import { RelojSistema } from './reloj-sistema';

/**
 * Cross-cutting adapters shared by every module: configuration, database
 * client, Redis connections, server clock and the time-integrity policy.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIGURACION, useFactory: cargarConfiguracion },
    PrismaService,
    RedisPublicador,
    RedisSuscriptor,
    { provide: RELOJ, useClass: RelojSistema },
    {
      provide: IntegridadTiempo,
      inject: [CONFIGURACION],
      useFactory: (c: Configuracion) =>
        new IntegridadTiempo({
          toleranciaSegundos: c.toleranciaRelojSegundos,
          maxHorasOffline: c.maxHorasOffline,
          zonaHoraria: c.zonaHoraria,
        }),
    },
  ],
  exports: [CONFIGURACION, PrismaService, RedisPublicador, RedisSuscriptor, RELOJ, IntegridadTiempo],
})
export class InfraestructuraModule {}
