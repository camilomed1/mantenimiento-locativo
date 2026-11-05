import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Rol } from '@prisma/client';
import { CONFIGURACION, Configuracion } from '../../config/configuracion';
import { ES_PUBLICO, PayloadAcceso, ROLES, UsuarioAutenticado } from './usuario-autenticado';

/** Global guard: every endpoint requires a valid access token unless @Publico(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(CONFIGURACION) private readonly config: Configuracion,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [esquema, token] = String(req.headers.authorization ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = await this.jwt.verifyAsync<PayloadAcceso>(token, { secret: this.config.jwt.accessSecret });
      if (payload.tipo !== 'access') throw new Error('Wrong token type');
      const usuario: UsuarioAutenticado = {
        usuarioId: payload.sub,
        rol: payload.rol,
        operarioId: payload.operarioId,
      };
      req.usuario = usuario;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/** Global guard: checks @Roles(...) after authentication. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const usuario: UsuarioAutenticado | undefined = ctx.switchToHttp().getRequest().usuario;
    if (!usuario || !roles.includes(usuario.rol)) {
      throw new ForbiddenException('Role not allowed for this operation');
    }
    return true;
  }
}
