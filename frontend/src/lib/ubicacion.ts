import type { Ubicacion } from '../db/db';

/**
 * Best-effort GPS reading. GPS works without mobile data, but on cheap phones
 * the first fix can be slow; after the timeout the mark is saved without
 * position instead of making the operator wait.
 */
export function obtenerUbicacion(tiempoMs = 10_000): Promise<Ubicacion | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolver) => {
    // The browser's own timeout only starts after the permission prompt is
    // answered; this hard limit covers an ignored prompt too.
    const limite = setTimeout(() => resolver(null), tiempoMs + 2_000);
    const fin = (u: Ubicacion | null) => {
      clearTimeout(limite);
      resolver(u);
    };
    navigator.geolocation.getCurrentPosition(
      (p) =>
        fin({
          latitud: Number(p.coords.latitude.toFixed(6)),
          longitud: Number(p.coords.longitude.toFixed(6)),
          precisionMetros: Math.round(p.coords.accuracy * 100) / 100,
        }),
      () => fin(null),
      { enableHighAccuracy: true, timeout: tiempoMs, maximumAge: 60_000 },
    );
  });
}
