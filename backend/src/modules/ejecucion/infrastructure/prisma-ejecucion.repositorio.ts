import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { filasOutbox } from '../../../shared/infrastructure/outbox/outbox';
import { PrismaService, violacionUnica } from '../../../shared/infrastructure/prisma/prisma.service';
import { EjecucionRepositorio, ResultadoGuardado } from '../application/puertos';
import { Ejecucion } from '../domain/ejecucion';
import { Evidencia } from '../domain/evidencia';

const conRelaciones = {
  programacion: { select: { conjuntoId: true } },
  evidencias: { select: { momento: true } },
} satisfies Prisma.EjecucionInclude;

type FilaEjecucion = Prisma.EjecucionGetPayload<{ include: typeof conRelaciones }>;
type FilaEvidencia = Prisma.EvidenciaGetPayload<object>;

/** Driven adapter: EjecucionRepositorio on PostgreSQL via Prisma. */
@Injectable()
export class PrismaEjecucionRepositorio implements EjecucionRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorClientUuid(clientUuid: string): Promise<Ejecucion | null> {
    const fila = await this.prisma.ejecucion.findUnique({ where: { clientUuid }, include: conRelaciones });
    return fila ? this.aDominio(fila) : null;
  }

  async buscarPorProgramacion(programacionId: string): Promise<Ejecucion | null> {
    const fila = await this.prisma.ejecucion.findUnique({ where: { programacionId }, include: conRelaciones });
    return fila ? this.aDominio(fila) : null;
  }

  async guardarNueva(e: Ejecucion): Promise<ResultadoGuardado> {
    return this.conUnicidad(() =>
      this.prisma.$transaction([
        this.prisma.ejecucion.create({
          data: {
            id: e.id,
            clientUuid: e.clientUuid,
            programacionId: e.programacionId,
            operarioId: e.operarioId,
            estado: e.estado,
            horaInicioDispositivo: e.horaInicioDispositivo,
            horaInicioServidor: e.horaInicioServidor,
            inconsistenciaHora: e.inconsistenciaHora,
          },
        }),
        this.prisma.outboxEvento.createMany({ data: filasOutbox(e.extraerEventos()) }),
      ]),
    );
  }

  async guardarFinalizacion(e: Ejecucion): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional update = optimistic lock on the state transition.
      const { count } = await tx.ejecucion.updateMany({
        where: { id: e.id, estado: 'EN_CURSO' },
        data: {
          estado: 'FINALIZADA',
          horaFinDispositivo: e.horaFinDispositivo,
          horaFinServidor: e.horaFinServidor,
          observaciones: e.observaciones,
          inconsistenciaHora: e.inconsistenciaHora,
        },
      });
      if (count === 0) return false;
      await tx.outboxEvento.createMany({ data: filasOutbox(e.extraerEventos()) });
      return true;
    });
  }

  async buscarEvidenciaPorClientUuid(clientUuid: string): Promise<Evidencia | null> {
    const fila = await this.prisma.evidencia.findUnique({ where: { clientUuid } });
    return fila ? this.evidenciaADominio(fila) : null;
  }

  async guardarEvidencia(e: Ejecucion, ev: Evidencia): Promise<ResultadoGuardado> {
    return this.conUnicidad(() =>
      this.prisma.$transaction([
        this.prisma.evidencia.create({
          data: {
            id: ev.id,
            clientUuid: ev.clientUuid,
            ejecucionId: e.id,
            momento: ev.momento,
            bucket: ev.bucket,
            objectKey: ev.objectKey,
            sha256: ev.sha256,
            mimeType: ev.mimeType,
            tamanoBytes: ev.tamanoBytes,
            horaCaptura: ev.horaCaptura,
            horaRecepcion: ev.horaRecepcion,
            latitud: ev.latitud,
            longitud: ev.longitud,
          },
        }),
        this.prisma.outboxEvento.createMany({ data: filasOutbox(e.extraerEventos()) }),
      ]),
    );
  }

  async buscarEvidencia(id: string): Promise<{ evidencia: Evidencia; operarioId: string } | null> {
    const fila = await this.prisma.evidencia.findUnique({
      where: { id },
      include: { ejecucion: { select: { operarioId: true } } },
    });
    return fila ? { evidencia: this.evidenciaADominio(fila), operarioId: fila.ejecucion.operarioId } : null;
  }

  private async conUnicidad(operacion: () => Promise<unknown>): Promise<ResultadoGuardado> {
    try {
      await operacion();
      return 'GUARDADO';
    } catch (error) {
      const violacion = violacionUnica(error);
      if (violacion === 'CLIENT_UUID') return 'CLIENT_UUID_DUPLICADO';
      if (violacion === 'OTRA') return 'REGLA_UNICIDAD_VIOLADA';
      throw error;
    }
  }

  private aDominio(f: FilaEjecucion): Ejecucion {
    return Ejecucion.reconstituir({
      id: f.id,
      clientUuid: f.clientUuid,
      programacionId: f.programacionId,
      operarioId: f.operarioId,
      conjuntoId: f.programacion.conjuntoId,
      estado: f.estado,
      horaInicioDispositivo: f.horaInicioDispositivo,
      horaInicioServidor: f.horaInicioServidor,
      horaFinDispositivo: f.horaFinDispositivo,
      horaFinServidor: f.horaFinServidor,
      inconsistenciaHora: f.inconsistenciaHora,
      observaciones: f.observaciones,
      momentosRegistrados: f.evidencias.map((ev) => ev.momento),
    });
  }

  private evidenciaADominio(f: FilaEvidencia): Evidencia {
    return Evidencia.reconstituir({
      id: f.id,
      clientUuid: f.clientUuid,
      ejecucionId: f.ejecucionId,
      momento: f.momento,
      bucket: f.bucket,
      objectKey: f.objectKey,
      sha256: f.sha256,
      mimeType: f.mimeType,
      tamanoBytes: f.tamanoBytes,
      horaCaptura: f.horaCaptura,
      horaRecepcion: f.horaRecepcion,
      latitud: f.latitud?.toNumber() ?? null,
      longitud: f.longitud?.toNumber() ?? null,
    });
  }
}
