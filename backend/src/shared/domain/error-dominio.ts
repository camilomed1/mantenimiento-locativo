/**
 * A broken business rule. It never depends on HTTP or the database.
 *
 * `reintentable` tells the offline client what to do with the record:
 * - false: the record is invalid and will never be accepted (show it to the user).
 * - true:  the record is valid but arrived too early (for example a photo whose
 *          activity has not synced yet). Keep it in the queue and retry later.
 */
export class ErrorDominio extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly reintentable = false,
  ) {
    super(mensaje);
    this.name = 'ErrorDominio';
  }
}
