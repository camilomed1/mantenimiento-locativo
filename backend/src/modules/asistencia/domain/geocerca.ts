import { ErrorDominio } from '../../../shared/domain/error-dominio';

const RADIO_TIERRA_METROS = 6_371_000;

/** Value object: a GPS position. */
export class Coordenada {
  constructor(
    readonly latitud: number,
    readonly longitud: number,
  ) {
    if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90) {
      throw new ErrorDominio('COORDENADA_INVALIDA', 'Latitude must be between -90 and 90');
    }
    if (!Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
      throw new ErrorDominio('COORDENADA_INVALIDA', 'Longitude must be between -180 and 180');
    }
  }

  /** Great-circle distance (haversine), in meters. */
  distanciaA(otra: Coordenada): number {
    const rad = (g: number) => (g * Math.PI) / 180;
    const dLat = rad(otra.latitud - this.latitud);
    const dLon = rad(otra.longitud - this.longitud);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(this.latitud)) * Math.cos(rad(otra.latitud)) * Math.sin(dLon / 2) ** 2;
    return 2 * RADIO_TIERRA_METROS * Math.asin(Math.sqrt(a));
  }
}

/** Value object: circular area around a work site (conjunto). */
export class Geocerca {
  constructor(
    readonly centro: Coordenada,
    readonly radioMetros: number,
  ) {}

  /**
   * Cheap phones report a GPS accuracy radius. Part of it is given as
   * benefit of the doubt, capped at the geofence radius so a very
   * inaccurate reading cannot make any position "inside".
   */
  contiene(punto: Coordenada, precisionMetros = 0): boolean {
    const margen = Math.min(Math.max(precisionMetros, 0), this.radioMetros);
    return this.centro.distanciaA(punto) - margen <= this.radioMetros;
  }
}
