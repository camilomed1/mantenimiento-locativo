import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Publico } from '../auth/usuario-autenticado';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { RedisPublicador } from '../infrastructure/redis/redis.providers';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisPublicador,
  ) {}

  @Publico()
  @Get()
  async verificar(): Promise<{ estado: string; baseDatos: string; redis: string }> {
    const [db, redis] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.cliente.ping()]);
    const resultado = {
      estado: db.status === 'fulfilled' && redis.status === 'fulfilled' ? 'ok' : 'degradado',
      baseDatos: db.status === 'fulfilled' ? 'ok' : 'caida',
      redis: redis.status === 'fulfilled' ? 'ok' : 'caido',
    };
    if (db.status !== 'fulfilled') throw new ServiceUnavailableException(resultado);
    return resultado;
  }
}
