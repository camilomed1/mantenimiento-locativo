import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { AgregadoRaiz } from '../../../shared/domain/evento-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Coordenada, Geocerca } from './geocerca';

export type TipoMarca = 'ENTRADA' | 'SALIDA';

export interface UbicacionMarca {
  coordenada: Coordenada;
  precisionMetros?: number;
}

export interface PropsMarcaAsistencia {
  id: string;
  clientUuid: string;
  operarioId: string;
  conjuntoId: string;
  tipo: TipoMarca;
  /** Local working day, YYYY-MM-DD. */
  fecha: string;
  horaDispositivo: Date;
  horaServidor: Date;
  desfaseSegundos: number;
  inconsistenciaHora: boolean;
  ubicacion: UbicacionMarca | null;
  /** null when there was no GPS reading. */
  dentroGeocerca: boolean | null;
}

export interface DatosNuevaMarca {
  id: string;
  clientUuid: string;
  operarioId: string;
  conjuntoId: string;
  tipo: TipoMarca;
  horaDispositivo: Date;
  ubicacion: UbicacionMarca | null;
}

export interface ContextoMarca {
  horaServidor: Date;
  integridad: IntegridadTiempo;
  geocerca: Geocerca;
  /** Every mark the operator already has on the same working day (any site). */
  marcasDelDia: MarcaAsistencia[];
}

/**
 * Aggregate of the Attendance module: one check-in or check-out mark.
 *
 * Rules (scenario 2 of the architecture document):
 * - One check-in and one check-out per operator, site and day.
 * - Only one open check-in per operator and day (must check out of site A
 *   before checking in at site B).
 * - A check-out needs a previous check-in at the same site, and cannot be
 *   earlier than it.
 * - Device time and server time are both kept; big gaps are flagged.
 * - GPS position is compared with the site geofence; outside is flagged.
 */
export class MarcaAsistencia extends AgregadoRaiz {
  private constructor(private readonly props: PropsMarcaAsistencia) {
    super();
  }

  static registrar(datos: DatosNuevaMarca, ctx: ContextoMarca): MarcaAsistencia {
    const fecha = ctx.integridad.fechaLocal(datos.horaDispositivo);
    const delDia = ctx.marcasDelDia.filter((m) => m.operarioId === datos.operarioId && m.fecha === fecha);

    if (datos.tipo === 'ENTRADA') {
      MarcaAsistencia.validarEntrada(datos, delDia);
    } else {
      MarcaAsistencia.validarSalida(datos, delDia);
    }

    const dentroGeocerca = datos.ubicacion
      ? ctx.geocerca.contiene(datos.ubicacion.coordenada, datos.ubicacion.precisionMetros)
      : null;

    const marca = new MarcaAsistencia({
      ...datos,
      fecha,
      horaServidor: ctx.horaServidor,
      desfaseSegundos: ctx.integridad.desfaseSegundos(datos.horaDispositivo, ctx.horaServidor),
      inconsistenciaHora: ctx.integridad.esInconsistente(datos.horaDispositivo, ctx.horaServidor),
      dentroGeocerca,
    });

    marca.registrarEvento({
      tipo: datos.tipo === 'ENTRADA' ? 'asistencia.EntradaRegistrada' : 'asistencia.SalidaRegistrada',
      agregadoId: marca.id,
      ocurridoEn: ctx.horaServidor,
      payload: {
        operarioId: marca.operarioId,
        conjuntoId: marca.conjuntoId,
        fecha,
        horaDispositivo: datos.horaDispositivo.toISOString(),
        horaServidor: ctx.horaServidor.toISOString(),
        inconsistenciaHora: marca.inconsistenciaHora,
        dentroGeocerca,
      },
    });
    return marca;
  }

  /** Rebuilds a mark loaded from storage. No rules run, no events are raised. */
  static reconstituir(props: PropsMarcaAsistencia): MarcaAsistencia {
    return new MarcaAsistencia(props);
  }

  private static validarEntrada(datos: DatosNuevaMarca, delDia: MarcaAsistencia[]): void {
    if (delDia.some((m) => m.tipo === 'ENTRADA' && m.conjuntoId === datos.conjuntoId)) {
      throw new ErrorDominio('ENTRADA_DUPLICADA', 'Check-in already registered for this site today');
    }
    const abierta = delDia.find(
      (e) =>
        e.tipo === 'ENTRADA' && !delDia.some((s) => s.tipo === 'SALIDA' && s.conjuntoId === e.conjuntoId),
    );
    if (abierta) {
      throw new ErrorDominio('ENTRADA_ABIERTA', 'There is an open check-in at another site; check out first');
    }
  }

  private static validarSalida(datos: DatosNuevaMarca, delDia: MarcaAsistencia[]): void {
    const mismoSitio = delDia.filter((m) => m.conjuntoId === datos.conjuntoId);
    const entrada = mismoSitio.find((m) => m.tipo === 'ENTRADA');
    if (!entrada) {
      throw new ErrorDominio('SALIDA_SIN_ENTRADA', 'Check-out requires a previous check-in at the same site');
    }
    if (mismoSitio.some((m) => m.tipo === 'SALIDA')) {
      throw new ErrorDominio('SALIDA_DUPLICADA', 'Check-out already registered for this site today');
    }
    if (datos.horaDispositivo.getTime() < entrada.horaDispositivo.getTime()) {
      throw new ErrorDominio('SALIDA_ANTERIOR_A_ENTRADA', 'Check-out time is earlier than check-in time');
    }
  }

  get id() { return this.props.id; }
  get clientUuid() { return this.props.clientUuid; }
  get operarioId() { return this.props.operarioId; }
  get conjuntoId() { return this.props.conjuntoId; }
  get tipo() { return this.props.tipo; }
  get fecha() { return this.props.fecha; }
  get horaDispositivo() { return this.props.horaDispositivo; }
  get horaServidor() { return this.props.horaServidor; }
  get desfaseSegundos() { return this.props.desfaseSegundos; }
  get inconsistenciaHora() { return this.props.inconsistenciaHora; }
  get ubicacion() { return this.props.ubicacion; }
  get dentroGeocerca() { return this.props.dentroGeocerca; }
}
