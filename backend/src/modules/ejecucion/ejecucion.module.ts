import { Logger, Module } from '@nestjs/common';
import { IntegridadTiempo } from '../../shared/domain/integridad-tiempo';
import { Reloj, RELOJ } from '../../shared/domain/reloj';
import { ObtenerUrlEvidencia, RegistrarEvidencia } from './application/evidencias.use-cases';
import { FinalizarEjecucion, IniciarEjecucion } from './application/gestionar-ejecucion.use-cases';
import {
  ALMACENAMIENTO_EVIDENCIAS,
  AlmacenamientoEvidencias,
  EJECUCION_REPOSITORIO,
  EjecucionRepositorio,
  PROGRAMACION_CONSULTA,
  ProgramacionConsulta,
} from './application/puertos';
import { SincronizarEjecuciones } from './application/sincronizar-ejecuciones.use-case';
import { MinioAlmacenamiento } from './infrastructure/minio-almacenamiento';
import { PrismaEjecucionRepositorio } from './infrastructure/prisma-ejecucion.repositorio';
import { PrismaProgramacionConsulta } from './infrastructure/prisma-programacion.consulta';
import { EjecucionController } from './interfaces/ejecucion.controller';

/** Composition root of the Execution and Evidence module. */
@Module({
  controllers: [EjecucionController],
  providers: [
    { provide: EJECUCION_REPOSITORIO, useClass: PrismaEjecucionRepositorio },
    { provide: PROGRAMACION_CONSULTA, useClass: PrismaProgramacionConsulta },
    { provide: ALMACENAMIENTO_EVIDENCIAS, useClass: MinioAlmacenamiento },
    {
      provide: IniciarEjecucion,
      inject: [EJECUCION_REPOSITORIO, PROGRAMACION_CONSULTA, RELOJ, IntegridadTiempo],
      useFactory: (r: EjecucionRepositorio, p: ProgramacionConsulta, reloj: Reloj, i: IntegridadTiempo) =>
        new IniciarEjecucion(r, p, reloj, i),
    },
    {
      provide: FinalizarEjecucion,
      inject: [EJECUCION_REPOSITORIO, RELOJ, IntegridadTiempo],
      useFactory: (r: EjecucionRepositorio, reloj: Reloj, i: IntegridadTiempo) => new FinalizarEjecucion(r, reloj, i),
    },
    {
      provide: SincronizarEjecuciones,
      inject: [IniciarEjecucion, FinalizarEjecucion],
      useFactory: (ini: IniciarEjecucion, fin: FinalizarEjecucion) =>
        new SincronizarEjecuciones(ini, fin, new Logger('SincronizarEjecuciones')),
    },
    {
      provide: RegistrarEvidencia,
      inject: [EJECUCION_REPOSITORIO, ALMACENAMIENTO_EVIDENCIAS, RELOJ],
      useFactory: (r: EjecucionRepositorio, a: AlmacenamientoEvidencias, reloj: Reloj) =>
        new RegistrarEvidencia(r, a, reloj),
    },
    {
      provide: ObtenerUrlEvidencia,
      inject: [EJECUCION_REPOSITORIO, ALMACENAMIENTO_EVIDENCIAS],
      useFactory: (r: EjecucionRepositorio, a: AlmacenamientoEvidencias) => new ObtenerUrlEvidencia(r, a),
    },
  ],
})
export class EjecucionModule {}
