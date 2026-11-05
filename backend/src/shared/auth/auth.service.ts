import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { CONFIGURACION, Configuracion } from '../../config/configuracion';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PayloadAcceso } from './usuario-autenticado';

interface PayloadRefresh {
  sub: string;
  tipo: 'refresh';
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nombre: string; rol: string; operarioId: string | null };
}

/**
 * Minimal Identity and Access adapter needed by the two selected modules.
 * Short-lived access token (15 min) + refresh token (7 days): an operator
 * who was offline for hours refreshes first, then syncs the queue.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(CONFIGURACION) private readonly config: Configuracion,
  ) {}

  async login(email: string, password: string): Promise<Tokens> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { operario: { select: { id: true } } },
    });
    const valido = usuario?.activo && (await argon2.verify(usuario.passwordHash, password));
    if (!usuario || !valido) throw new UnauthorizedException('Invalid email or password');
    return this.emitir(usuario.id, usuario.nombre, usuario.rol, usuario.operario?.id ?? null);
  }

  async refrescar(refreshToken: string): Promise<Tokens> {
    let payload: PayloadRefresh;
    try {
      payload = await this.jwt.verifyAsync<PayloadRefresh>(refreshToken, { secret: this.config.jwt.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.tipo !== 'refresh') throw new UnauthorizedException('Wrong token type');

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      include: { operario: { select: { id: true } } },
    });
    if (!usuario?.activo) throw new UnauthorizedException('User disabled');
    return this.emitir(usuario.id, usuario.nombre, usuario.rol, usuario.operario?.id ?? null);
  }

  private async emitir(id: string, nombre: string, rol: PayloadAcceso['rol'], operarioId: string | null): Promise<Tokens> {
    const acceso: PayloadAcceso = { sub: id, rol, operarioId, tipo: 'access' };
    const refresh: PayloadRefresh = { sub: id, tipo: 'refresh' };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(acceso, {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.config.jwt.accessTtl as JwtSignOptions['expiresIn'],
      }),
      this.jwt.signAsync(refresh, {
        secret: this.config.jwt.refreshSecret,
        expiresIn: this.config.jwt.refreshTtl as JwtSignOptions['expiresIn'],
      }),
    ]);
    return { accessToken, refreshToken, usuario: { id, nombre, rol, operarioId } };
  }
}
