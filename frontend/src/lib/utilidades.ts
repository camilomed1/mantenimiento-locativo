/** Company time zone; decides which "day" a mark belongs to (same rule as the server). */
export const ZONA_HORARIA = 'America/Bogota';

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const formatoHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const formatoDia = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** YYYY-MM-DD in the company time zone. */
export const fechaLocal = (d: Date = new Date()) => formatoFecha.format(d);
export const horaCorta = (iso: string | null | undefined) => (iso ? formatoHora.format(new Date(iso)) : '--:--');
/** "Jueves, 5 de noviembre" (only the first letter uppercase). */
export const diaLargo = (fecha: string) => {
  const t = formatoDia.format(new Date(`${fecha}T12:00:00-05:00`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * UUID v4. crypto.randomUUID only exists on HTTPS/localhost; the fallback
 * uses getRandomValues, which works everywhere.
 */
export function nuevoUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Great-circle distance in meters (same formula as the server). */
export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
