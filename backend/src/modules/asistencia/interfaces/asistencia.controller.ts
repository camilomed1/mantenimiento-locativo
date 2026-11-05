import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { operarioDe, Roles, UsuarioActual, UsuarioAutenticado } from '../../../shared/auth/usuario-autenticado';
import { SincronizarAsistencias } from '../application/sincronizar-asistencias.use-case';
import { RespuestaSync, SincronizarAsistenciasDto } from './asistencia.dto';

/** Driving adapter: REST entry point of the Attendance module. */
@ApiTags('asistencia')
@ApiBearerAuth()
@Controller('asistencia')
export class AsistenciaController {
  constructor(private readonly sincronizar: SincronizarAsistencias) {}

  /**
   * Receives the offline queue of check-in / check-out marks.
   * Always 200 with one result per mark (ACEPTADO, DUPLICADO, RECHAZADO, REINTENTAR).
   */
  @Post('sync')
  @HttpCode(200)
  @Roles('OPERARIO')
  async sync(@UsuarioActual() usuario: UsuarioAutenticado, @Body() dto: SincronizarAsistenciasDto): Promise<RespuestaSync> {
    const operarioId = operarioDe(usuario);
    const resultados = await this.sincronizar.ejecutar(
      dto.marcas.map((m) => ({
        operarioId,
        clientUuid: m.clientUuid,
        conjuntoId: m.conjuntoId,
        tipo: m.tipo,
        horaDispositivo: new Date(m.horaDispositivo),
        latitud: m.latitud,
        longitud: m.longitud,
        precisionMetros: m.precisionMetros,
      })),
    );
    return { resultados };
  }
}
