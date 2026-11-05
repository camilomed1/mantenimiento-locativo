import { db, type Sesion } from '../db/db';
import { iniciarSesion } from '../lib/api';
import { contarPendientes, motor } from './motor';

export class ErrorSesion extends Error {}

/**
 * Logs in and protects queued data. The server takes the operator from the
 * token, so records captured by user A must never be sent with user B's
 * token. If another user's records are still pending, login is refused.
 */
export async function entrar(email: string, password: string): Promise<Sesion> {
  const propietario = (await db.ajustes.get('propietario'))?.valor;
  const sesion = await iniciarSesion(email, password);

  // The session is stored only after this check, so the login screen stays
  // mounted and can show the refusal.
  if (propietario && propietario !== sesion.usuario.id) {
    if ((await contarPendientes()) > 0) {
      throw new ErrorSesion(
        'Este teléfono tiene registros sin enviar de otro usuario. Ese usuario debe ingresar y sincronizar primero.',
      );
    }
    await db.transaction('rw', [db.agenda, db.marcas, db.ejecuciones, db.fotos], async () => {
      await Promise.all([db.agenda.clear(), db.marcas.clear(), db.ejecuciones.clear(), db.fotos.clear()]);
    });
  }
  await db.ajustes.put({ clave: 'propietario', valor: sesion.usuario.id });
  await db.sesion.put(sesion);
  void motor.sincronizar();
  return sesion;
}
