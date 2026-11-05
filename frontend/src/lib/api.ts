import { db, type Sesion } from '../db/db';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api';

/** The request never reached the server (no signal, server down, timeout). */
export class SinConexionError extends Error {
  constructor() {
    super('Sin conexión con el servidor');
    this.name = 'SinConexionError';
  }
}

/** The session can no longer be refreshed; the user must log in again. */
export class SesionExpiradaError extends Error {
  constructor() {
    super('La sesión expiró. Inicie sesión de nuevo cuando tenga señal.');
    this.name = 'SesionExpiradaError';
  }
}

export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}

const TIEMPO_MAXIMO_MS = 30_000;

async function fetchConLimite(url: string, init: RequestInit): Promise<Response> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? control.signal });
  } catch {
    throw new SinConexionError();
  } finally {
    clearTimeout(t);
  }
}

async function leerError(r: Response): Promise<string> {
  try {
    const cuerpo = await r.json();
    return Array.isArray(cuerpo.message) ? cuerpo.message.join(', ') : (cuerpo.message ?? r.statusText);
  } catch {
    return r.statusText;
  }
}

/** Calls the login endpoint. The caller decides whether to store the session. */
export async function iniciarSesion(email: string, password: string): Promise<Sesion> {
  const r = await fetchConLimite(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new ErrorHttp(r.status, r.status === 401 ? 'Correo o contraseña incorrectos' : await leerError(r));
  const t = await r.json();
  return { id: 'actual', accessToken: t.accessToken, refreshToken: t.refreshToken, usuario: t.usuario, expirada: false };
}

let refrescoEnCurso: Promise<string> | null = null;

/** One refresh at a time, even if several requests get 401 together. */
function refrescar(sesion: Sesion): Promise<string> {
  refrescoEnCurso ??= (async () => {
    try {
      const r = await fetchConLimite(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sesion.refreshToken }),
      });
      if (r.status === 401 || r.status === 400) {
        await db.sesion.update('actual', { expirada: true });
        throw new SesionExpiradaError();
      }
      if (!r.ok) throw new ErrorHttp(r.status, await leerError(r));
      const t = await r.json();
      await db.sesion.update('actual', { accessToken: t.accessToken, refreshToken: t.refreshToken, expirada: false });
      return t.accessToken as string;
    } finally {
      refrescoEnCurso = null;
    }
  })();
  return refrescoEnCurso;
}

/**
 * Authenticated request. After hours offline the access token (15 min) has
 * expired: the first 401 triggers a refresh and the request is repeated once.
 */
export async function pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
  const sesion = await db.sesion.get('actual');
  if (!sesion || sesion.expirada) throw new SesionExpiradaError();

  const enviar = (token: string) =>
    fetchConLimite(`${API_URL}${ruta}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });

  let r = await enviar(sesion.accessToken);
  if (r.status === 401) r = await enviar(await refrescar(sesion));
  return r;
}

export async function pedirJson<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const r = await pedir(ruta, init);
  if (!r.ok) throw new ErrorHttp(r.status, await leerError(r));
  return r.json() as Promise<T>;
}

export const postJson = <T>(ruta: string, cuerpo: unknown) =>
  pedirJson<T>(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

export async function cerrarSesion(): Promise<void> {
  await db.sesion.delete('actual');
}
