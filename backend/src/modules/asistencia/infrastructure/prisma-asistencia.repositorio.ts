import { Injectable } from '@nestjs/common';
import { Asistencia } from '@prisma/client';
import { filasOutbox } from '../../../shared/infrastructure/outbox/outbox';
import { fechaSql, PrismaService, violacionUnica } from '../../../shared/infrastructure/prisma/prisma.service';
import { AsistenciaRepositorio, ResultadoGuardado } from '../application/puertos';
import { Coordenada } from '../domain/geocerca';
import { MarcaAsistencia } from '../domain/marca-asistencia';

/** Driven adapter: AsistenciaRepositorio on PostgreSQL via Prisma. */
@Injectable()
export class PrismaAsistenciaRepositorio implements AsistenciaRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorClientUuid(clientUuid: string): Promise<MarcaAsistencia | null> {
    const fila = await this.prisma.asistencia.findUnique({ where: { clientUuid } });
    return fila ? this.aDominio(fila) : null;
  }

  async listarDelDia(operarioId: string, fecha: string): Promise<MarcaAsistencia[]> {
    const filas = await this.prisma.asistencia.findMany({
      where: { operarioId, fecha: fechaSql.aDate(fecha) },
      orderBy: { horaDispositivo: 'asc' },
    });
    return filas.map((f) => this.aDominio(f));
  }

  async guardar(marca: MarcaAsistencia): Promise<ResultadoGuardado> {
    try {
      await this.prisma.$transaction([
        this.prisma.asistencia.create({
          data: {
            id: marca.id,
            clientUuid: marca.clientUuid,
            operarioId: marca.operarioId,
            conjuntoId: marca.conjuntoId,
            tipo: marca.tipo,
            fecha: fechaSql.aDate(marca.fecha),
            horaDispositivo: marca.horaDispositivo,
            horaServidor: marca.horaServidor,
            desfaseSegundos: marca.desfaseSegundos,
            inconsistenciaHora: marca.inconsistenciaHora,
            latitud: marca.ubicacion?.coordenada.latitud,
            longitud: marca.ubicacion?.coordenada.longitud,
            precisionMetros: marca.ubicacion?.precisionMetros,
            dentroGeocerca: marca.dentroGeocerca,
          },
        }),
        this.prisma.outboxEvento.createMany({ data: filasOutbox(marca.extraerEventos()) }),
      ]);
      return 'GUARDADO';
    } catch (error) {
      const violacion = violacionUnica(error);
      if (violacion === 'CLIENT_UUID') return 'CLIENT_UUID_DUPLICADO';
      if (violacion === 'OTRA') return 'REGLA_UNICIDAD_VIOLADA';
      throw error;
    }
  }

  private aDominio(f: Asistencia): MarcaAsistencia {
    return MarcaAsistencia.reconstituir({
      id: f.id,
      clientUuid: f.clientUuid,
      operarioId: f.operarioId,
      conjuntoId: f.conjuntoId,
      tipo: f.tipo,
      fecha: fechaSql.aTexto(f.fecha),
      horaDispositivo: f.horaDispositivo,
      horaServidor: f.horaServidor,
      desfaseSegundos: f.desfaseSegundos,
      inconsistenciaHora: f.inconsistenciaHora,
      ubicacion:
        f.latitud !== null && f.longitud !== null
          ? {
              coordenada: new Coordenada(f.latitud.toNumber(), f.longitud.toNumber()),
              precisionMetros: f.precisionMetros?.toNumber(),
            }
          : null,
      dentroGeocerca: f.dentroGeocerca,
    });
  }
}
