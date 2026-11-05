import { Injectable } from '@nestjs/common';
import { fechaSql, PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { AgendaConsulta, ConjuntoConsulta } from '../application/puertos';
import { Coordenada, Geocerca } from '../domain/geocerca';

/**
 * Anti-corruption adapters. Sites and schedules belong to other modules;
 * Attendance only sees them through its own ports, as read-only data. When
 * the Scheduling module exists, these adapters call its public facade
 * instead of reading the tables.
 */
@Injectable()
export class PrismaConjuntoConsulta implements ConjuntoConsulta {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerGeocerca(conjuntoId: string): Promise<Geocerca | null> {
    const c = await this.prisma.conjunto.findFirst({
      where: { id: conjuntoId, activo: true },
      select: { latitud: true, longitud: true, radioGeocercaMetros: true },
    });
    return c ? new Geocerca(new Coordenada(c.latitud.toNumber(), c.longitud.toNumber()), c.radioGeocercaMetros) : null;
  }
}

@Injectable()
export class PrismaAgendaConsulta implements AgendaConsulta {
  constructor(private readonly prisma: PrismaService) {}

  async estaProgramado(operarioId: string, conjuntoId: string, fecha: string): Promise<boolean> {
    const total = await this.prisma.programacion.count({
      where: { operarioId, conjuntoId, fecha: fechaSql.aDate(fecha), estado: 'PUBLICADA' },
    });
    return total > 0;
  }
}
