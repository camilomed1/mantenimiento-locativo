import { BadRequestException, Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { operarioDe, Roles, UsuarioActual, UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import { IntegridadTiempo } from '../../shared/domain/integridad-tiempo';
import { RELOJ, Reloj } from '../../shared/domain/reloj';
import { fechaSql, PrismaService } from '../../shared/infrastructure/prisma/prisma.service';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read-only query (Scheduling side) the PWA calls while it has signal, so the
 * operator's week is stored in IndexedDB before going offline. It returns
 * the site geofence too, so the phone can warn the operator locally.
 * Not one of the two selected modules; it exists so they can be demoed.
 */
@ApiTags('agenda')
@ApiBearerAuth()
@Controller('agenda')
export class AgendaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integridad: IntegridadTiempo,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  @Get()
  @Roles('OPERARIO')
  @ApiQuery({ name: 'desde', required: false, example: '2026-11-02' })
  @ApiQuery({ name: 'hasta', required: false, example: '2026-11-06' })
  async miAgenda(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const hoy = this.integridad.fechaLocal(this.reloj.ahora());
    const inicio = desde ?? hoy;
    const fin = hasta ?? fechaSql.aTexto(new Date(fechaSql.aDate(inicio).getTime() + 6 * 86_400_000));
    if (!FECHA.test(inicio) || !FECHA.test(fin)) throw new BadRequestException('Dates must be YYYY-MM-DD');

    const filas = await this.prisma.programacion.findMany({
      where: {
        operarioId: operarioDe(usuario),
        estado: 'PUBLICADA',
        fecha: { gte: fechaSql.aDate(inicio), lte: fechaSql.aDate(fin) },
      },
      orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
      include: {
        conjunto: {
          select: { id: true, nombre: true, direccion: true, latitud: true, longitud: true, radioGeocercaMetros: true },
        },
        ejecucion: {
          select: { clientUuid: true, estado: true, evidencias: { select: { id: true, momento: true } } },
        },
      },
    });

    return {
      desde: inicio,
      hasta: fin,
      actividades: filas.map((p) => ({
        programacionId: p.id,
        fecha: fechaSql.aTexto(p.fecha),
        tipoServicio: p.tipoServicio,
        actividad: p.actividad,
        descripcion: p.descripcion,
        conjunto: {
          id: p.conjunto.id,
          nombre: p.conjunto.nombre,
          direccion: p.conjunto.direccion,
          latitud: p.conjunto.latitud.toNumber(),
          longitud: p.conjunto.longitud.toNumber(),
          radioGeocercaMetros: p.conjunto.radioGeocercaMetros,
        },
        ejecucion: p.ejecucion,
      })),
    };
  }
}

@Module({ controllers: [AgendaController] })
export class AgendaModule {}
