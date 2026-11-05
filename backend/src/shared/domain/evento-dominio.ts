/**
 * Something that happened in the domain (EntradaRegistrada, EvidenciaRecibida...).
 * Aggregates record events; repositories save them to the outbox table in the
 * same transaction as the data change.
 */
export interface EventoDominio {
  tipo: string;
  agregadoId: string;
  ocurridoEn: Date;
  payload: Record<string, unknown>;
}

export abstract class AgregadoRaiz {
  private eventos: EventoDominio[] = [];

  protected registrarEvento(evento: EventoDominio): void {
    this.eventos.push(evento);
  }

  /** Returns pending events and clears the list. */
  extraerEventos(): EventoDominio[] {
    const pendientes = this.eventos;
    this.eventos = [];
    return pendientes;
  }
}
