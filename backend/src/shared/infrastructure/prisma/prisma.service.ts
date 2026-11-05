import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Detects a UNIQUE violation and tells whether it was the client_uuid
 * (idempotent retry) or another business constraint.
 */
export function violacionUnica(error: unknown): 'CLIENT_UUID' | 'OTRA' | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  const objetivo = JSON.stringify(error.meta?.target ?? '');
  return objetivo.includes('client_uuid') || objetivo.includes('clientUuid') ? 'CLIENT_UUID' : 'OTRA';
}

/** Postgres DATE columns: 'YYYY-MM-DD' <-> Date at UTC midnight. */
export const fechaSql = {
  aDate: (fecha: string): Date => new Date(`${fecha}T00:00:00.000Z`),
  aTexto: (fecha: Date): string => fecha.toISOString().slice(0, 10),
};
