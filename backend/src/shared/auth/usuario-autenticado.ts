import { createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Rol } from '@prisma/client';

/** Identity extracted from the access token. */
export interface UsuarioAutenticado {
  usuarioId: string;
  rol: Rol;
  /** Present only when rol = OPERARIO. */
  operarioId: string | null;
}

export interface PayloadAcceso {
  sub: string;
  rol: Rol;
  operarioId: string | null;
  tipo: 'access';
}

export const ES_PUBLICO = 'esPublico';
/** Marks an endpoint as reachable without a token (login, health). */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const ROLES = 'roles';
/** Restricts an endpoint to the given roles (RBAC). */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

/** Operator id from the token. The body never decides who the operator is. */
export function operarioDe(usuario: UsuarioAutenticado): string {
  if (!usuario.operarioId) throw new ForbiddenException('User has no operator profile');
  return usuario.operarioId;
}

/** Injects the authenticated user into a controller method. */
export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioAutenticado => ctx.switchToHttp().getRequest().usuario,
);
