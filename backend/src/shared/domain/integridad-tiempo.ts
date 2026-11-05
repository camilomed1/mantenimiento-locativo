export interface ConfigIntegridadTiempo {
  /** Device clock ahead of the server by more than this is suspicious. */
  toleranciaSegundos: number;
  /** A record that arrives later than this after capture is suspicious. */
  maxHorasOffline: number;
  /** IANA time zone used to decide the working day (e.g. America/Bogota). */
  zonaHoraria: string;
}

/**
 * Policy for the "two clocks" decision (critical decision #9).
 * The device time is kept because marks are captured offline. The server
 * time is the trusted reference. Big differences are flagged, not rejected,
 * so no real work is lost; supervisors review flagged records.
 */
export class IntegridadTiempo {
  private readonly formatoFecha: Intl.DateTimeFormat;

  constructor(private readonly config: ConfigIntegridadTiempo) {
    this.formatoFecha = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.zonaHoraria,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  /** Server time minus device time, in seconds. Positive = arrived later (normal offline). */
  desfaseSegundos(horaDispositivo: Date, horaServidor: Date): number {
    return Math.round((horaServidor.getTime() - horaDispositivo.getTime()) / 1000);
  }

  esInconsistente(horaDispositivo: Date, horaServidor: Date): boolean {
    const desfase = this.desfaseSegundos(horaDispositivo, horaServidor);
    const relojAdelantado = desfase < -this.config.toleranciaSegundos;
    const demasiadoAntiguo = desfase > this.config.maxHorasOffline * 3600;
    return relojAdelantado || demasiadoAntiguo;
  }

  /** Local working day (YYYY-MM-DD) of an instant. */
  fechaLocal(instante: Date): string {
    return this.formatoFecha.format(instante);
  }
}
