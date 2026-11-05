import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { ProgramacionConsulta } from '../application/puertos';
import { ActividadProgramada } from '../domain/ejecucion';

/**
 * Anti-corruption adapter over the Scheduling module's data. It only
 * returns what this module needs (ActividadProgramada).
 */
@Injectable()
export class PrismaProgramacionConsulta implements ProgramacionConsulta {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerActividad(programacionId: string): Promise<ActividadProgramada | null> {
    const p = await this.prisma.programacion.findUnique({
      where: { id: programacionId },
      select: { id: true, operarioId: true, conjuntoId: true, estado: true },
    });
    return p ? { id: p.id, operarioId: p.operarioId, conjuntoId: p.conjuntoId, publicada: p.estado === 'PUBLICADA' } : null;
  }
}
