import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { operarioDe, Roles, UsuarioActual, UsuarioAutenticado } from '../../../shared/auth/usuario-autenticado';
import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { ObtenerUrlEvidencia, RegistrarEvidencia } from '../application/evidencias.use-cases';
import { ResultadoOperacion, SincronizarEjecuciones } from '../application/sincronizar-ejecuciones.use-case';
import { TAMANO_MAXIMO_BYTES } from '../domain/evidencia';
import { SincronizarEjecucionesDto, SubirEvidenciaDto } from './ejecucion.dto';

/** Driving adapter: REST entry point of the Execution and Evidence module. */
@ApiTags('ejecuciones')
@ApiBearerAuth()
@Controller('ejecuciones')
export class EjecucionController {
  private readonly logger = new Logger(EjecucionController.name);

  constructor(
    private readonly sincronizar: SincronizarEjecuciones,
    private readonly registrarEvidencia: RegistrarEvidencia,
    private readonly obtenerUrl: ObtenerUrlEvidencia,
  ) {}

  /** Batch of start/finish operations from the offline queue. */
  @Post('sync')
  @HttpCode(200)
  @Roles('OPERARIO')
  async sync(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: SincronizarEjecucionesDto,
  ): Promise<{ resultados: ResultadoOperacion[] }> {
    const operarioId = operarioDe(usuario);
    const resultados = await this.sincronizar.ejecutar(
      dto.operaciones.map((o) =>
        o.tipo === 'INICIO'
          ? {
              tipo: 'INICIO' as const,
              operarioId,
              clientUuid: o.clientUuid,
              programacionId: o.programacionId!,
              horaDispositivo: new Date(o.horaDispositivo),
            }
          : {
              tipo: 'FIN' as const,
              operarioId,
              clientUuid: o.clientUuid,
              horaDispositivo: new Date(o.horaDispositivo),
              observaciones: o.observaciones ?? null,
            },
      ),
    );
    return { resultados };
  }

  /** One compressed photo per request (multipart/form-data, field "foto"). */
  @Post('evidencias')
  @HttpCode(200)
  @Roles('OPERARIO')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Photo in field "foto" plus SubirEvidenciaDto fields' })
  // No storage option = memory storage: the buffer goes straight to MinIO.
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1 } }))
  async subirEvidencia(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: SubirEvidenciaDto,
    @UploadedFile() foto?: Express.Multer.File,
  ): Promise<ResultadoSync> {
    if (!foto) throw new BadRequestException('Field "foto" with the image is required');
    try {
      return await this.registrarEvidencia.ejecutar({
        operarioId: operarioDe(usuario),
        clientUuid: dto.clientUuid,
        ejecucionClientUuid: dto.ejecucionClientUuid,
        momento: dto.momento,
        sha256: dto.sha256,
        horaCaptura: new Date(dto.horaCaptura),
        latitud: dto.latitud ?? null,
        longitud: dto.longitud ?? null,
        archivo: { contenido: foto.buffer, mimeType: foto.mimetype },
      });
    } catch (error) {
      // Storage or database down: the phone keeps the photo and retries.
      this.logger.error(`Photo upload failed for ${dto.clientUuid}: ${(error as Error).message}`);
      return ResultadoSync.reintentar(dto.clientUuid, 'ERROR_TEMPORAL', 'Try again later');
    }
  }

  /** Short-lived signed URL to view a photo (supervisor review, admin panel). */
  @Get('evidencias/:id/url')
  @Roles('ADMINISTRADOR', 'ADMINISTRATIVO', 'SUPERVISOR', 'OPERARIO')
  async urlEvidencia(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ url: string; expiraEnSegundos: number }> {
    try {
      return await this.obtenerUrl.ejecutar(id, { rol: usuario.rol, operarioId: usuario.operarioId });
    } catch (error) {
      if (error instanceof ErrorDominio && error.codigo === 'EVIDENCIA_NO_EXISTE') throw new NotFoundException(error.message);
      if (error instanceof ErrorDominio && error.codigo === 'ACCESO_DENEGADO') throw new ForbiddenException(error.message);
      throw error;
    }
  }
}
