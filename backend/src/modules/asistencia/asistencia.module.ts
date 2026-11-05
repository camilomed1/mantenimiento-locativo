import { Logger, Module } from '@nestjs/common';
import { IntegridadTiempo } from '../../shared/domain/integridad-tiempo';
import { Reloj, RELOJ } from '../../shared/domain/reloj';
import {
  AGENDA_CONSULTA,
  AgendaConsulta,
  ASISTENCIA_REPOSITORIO,
  AsistenciaRepositorio,
  CONJUNTO_CONSULTA,
  ConjuntoConsulta,
} from './application/puertos';
import { RegistrarMarcaAsistencia } from './application/registrar-marca.use-case';
import { SincronizarAsistencias } from './application/sincronizar-asistencias.use-case';
import { PrismaAsistenciaRepositorio } from './infrastructure/prisma-asistencia.repositorio';
import { PrismaAgendaConsulta, PrismaConjuntoConsulta } from './infrastructure/prisma-consultas';
import { AsistenciaController } from './interfaces/asistencia.controller';

/**
 * Composition root of the Attendance module. The application and domain
 * layers have no Nest decorators; they are wired here with factories, so
 * the framework stays at the edge (hexagonal architecture).
 */
@Module({
  controllers: [AsistenciaController],
  providers: [
    { provide: ASISTENCIA_REPOSITORIO, useClass: PrismaAsistenciaRepositorio },
    { provide: CONJUNTO_CONSULTA, useClass: PrismaConjuntoConsulta },
    { provide: AGENDA_CONSULTA, useClass: PrismaAgendaConsulta },
    {
      provide: RegistrarMarcaAsistencia,
      inject: [ASISTENCIA_REPOSITORIO, CONJUNTO_CONSULTA, AGENDA_CONSULTA, RELOJ, IntegridadTiempo],
      useFactory: (
        repo: AsistenciaRepositorio,
        conjuntos: ConjuntoConsulta,
        agenda: AgendaConsulta,
        reloj: Reloj,
        integridad: IntegridadTiempo,
      ) => new RegistrarMarcaAsistencia(repo, conjuntos, agenda, reloj, integridad),
    },
    {
      provide: SincronizarAsistencias,
      inject: [RegistrarMarcaAsistencia],
      useFactory: (registrar: RegistrarMarcaAsistencia) =>
        new SincronizarAsistencias(registrar, new Logger('SincronizarAsistencias')),
    },
  ],
})
export class AsistenciaModule {}
