import { Controller, Get, Injectable, Logger, MessageEvent, Module, OnModuleInit, Sse } from '@nestjs/common';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { filter, interval, map, merge, Observable, share, Subject } from 'rxjs';
import { Roles } from '../../shared/auth/usuario-autenticado';
import { CANAL_EVENTOS, RedisSuscriptor } from '../../shared/infrastructure/redis/redis.providers';

interface EventoPublicado {
  id: string;
  tipo: string;
  agregadoId: string;
  payload: Record<string, unknown>;
}

/**
 * Listens to domain events published by the outbox relay (via Redis, so it
 * works with several backend instances) and fans them out to SSE clients.
 */
@Injectable()
export class FlujoEventos implements OnModuleInit {
  private readonly logger = new Logger(FlujoEventos.name);
  private readonly eventos = new Subject<EventoPublicado>();
  readonly eventos$ = this.eventos.asObservable().pipe(share());

  constructor(private readonly redis: RedisSuscriptor) {}

  onModuleInit(): void {
    this.redis.cliente.on('message', (canal, mensaje) => {
      if (canal !== CANAL_EVENTOS) return;
      try {
        this.eventos.next(JSON.parse(mensaje) as EventoPublicado);
      } catch {
        this.logger.warn('Ignored malformed event');
      }
    });
    // Not awaited: the API must start even if Redis is down.
    this.redis.cliente.subscribe(CANAL_EVENTOS).catch((e: Error) => this.logger.warn(`Subscribe failed: ${e.message}`));
  }
}

/**
 * Real-time feed for the admin/supervisor panel (critical decision #7: SSE).
 * "Real time" means "as soon as the operator syncs"; offline data arrives late,
 * and each event carries the device capture time.
 * Send the token in the Authorization header (use fetch streaming on the panel,
 * not EventSource, so the token never goes in the URL).
 */
@ApiTags('monitoreo')
@ApiBearerAuth()
@Controller('monitoreo')
export class MonitoreoController {
  constructor(
    private readonly flujo: FlujoEventos,
    private readonly prisma: PrismaService,
  ) {}

  /** Names for the ids carried by the events (read model for the panel). */
  @Get('catalogo')
  @Roles('ADMINISTRADOR', 'ADMINISTRATIVO', 'SUPERVISOR')
  async catalogo(): Promise<{ operarios: Record<string, string>; conjuntos: Record<string, string> }> {
    const [operarios, conjuntos] = await Promise.all([
      this.prisma.operario.findMany({ select: { id: true, nombres: true, apellidos: true } }),
      this.prisma.conjunto.findMany({ select: { id: true, nombre: true } }),
    ]);
    return {
      operarios: Object.fromEntries(operarios.map((o) => [o.id, `${o.nombres} ${o.apellidos}`])),
      conjuntos: Object.fromEntries(conjuntos.map((c) => [c.id, c.nombre])),
    };
  }

  @Sse('stream')
  @Roles('ADMINISTRADOR', 'ADMINISTRATIVO', 'SUPERVISOR')
  stream(): Observable<MessageEvent> {
    const eventos = this.flujo.eventos$.pipe(
      filter((e) => e.tipo.startsWith('asistencia.') || e.tipo.startsWith('ejecucion.')),
      map((e): MessageEvent => ({ id: e.id, type: e.tipo, data: { agregadoId: e.agregadoId, ...e.payload } })),
    );
    // Keeps proxies from closing an idle connection.
    const latido = interval(25_000).pipe(map((): MessageEvent => ({ type: 'latido', data: {} })));
    return merge(eventos, latido);
  }
}

@Module({ controllers: [MonitoreoController], providers: [FlujoEventos] })
export class MonitoreoModule {}
