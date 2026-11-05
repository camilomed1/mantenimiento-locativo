import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { AgregadoRaiz } from '../../../shared/domain/evento-dominio';
import { IntegridadTiempo } from '../../../shared/domain/integridad-tiempo';
import { Evidencia, MOMENTOS_REQUERIDOS, MomentoEvidencia, PropsEvidencia } from './evidencia';

export type EstadoEjecucion = 'EN_CURSO' | 'FINALIZADA';

/** What this module needs to know about a scheduled activity. */
export interface ActividadProgramada {
  id: string;
  operarioId: string;
  conjuntoId: string;
  publicada: boolean;
}

export interface PropsEjecucion {
  id: string;
  clientUuid: string;
  programacionId: string;
  operarioId: string;
  conjuntoId: string;
  estado: EstadoEjecucion;
  horaInicioDispositivo: Date;
  horaInicioServidor: Date;
  horaFinDispositivo: Date | null;
  horaFinServidor: Date | null;
  inconsistenciaHora: boolean;
  observaciones: string | null;
  /** Moments that already have a photo stored. */
  momentosRegistrados: MomentoEvidencia[];
}

export interface DatosInicio {
  id: string;
  clientUuid: string;
  operarioId: string;
  actividad: ActividadProgramada;
  horaDispositivo: Date;
  horaServidor: Date;
  integridad: IntegridadTiempo;
}

export interface DatosFin {
  horaDispositivo: Date;
  horaServidor: Date;
  observaciones: string | null;
  integridad: IntegridadTiempo;
}

export type DatosEvidencia = Omit<PropsEvidencia, 'ejecucionId'>;

/**
 * Aggregate of the Execution and Evidence module: the work done on one
 * scheduled activity.
 *
 * Rules:
 * - Only the assigned operator can start it, and only if the schedule is published.
 * - One photo per moment (ANTES, DURANTE, DESPUES); no photos after it is finished.
 * - It can only finish when the three photos are stored (business rule:
 *   "three evidences per activity"). If a photo is still in the phone queue
 *   the finish is retried later, not lost.
 * - End time cannot be before start time; clock gaps are flagged.
 */
export class Ejecucion extends AgregadoRaiz {
  private constructor(private props: PropsEjecucion) {
    super();
  }

  static iniciar(d: DatosInicio): Ejecucion {
    if (d.actividad.operarioId !== d.operarioId) {
      throw new ErrorDominio('ACTIVIDAD_NO_ASIGNADA', 'This activity is assigned to another operator');
    }
    if (!d.actividad.publicada) {
      throw new ErrorDominio('PROGRAMACION_NO_PUBLICADA', 'The schedule for this activity is not published');
    }
    const ejecucion = new Ejecucion({
      id: d.id,
      clientUuid: d.clientUuid,
      programacionId: d.actividad.id,
      operarioId: d.operarioId,
      conjuntoId: d.actividad.conjuntoId,
      estado: 'EN_CURSO',
      horaInicioDispositivo: d.horaDispositivo,
      horaInicioServidor: d.horaServidor,
      horaFinDispositivo: null,
      horaFinServidor: null,
      inconsistenciaHora: d.integridad.esInconsistente(d.horaDispositivo, d.horaServidor),
      observaciones: null,
      momentosRegistrados: [],
    });
    ejecucion.registrarEvento({
      tipo: 'ejecucion.ActividadIniciada',
      agregadoId: ejecucion.id,
      ocurridoEn: d.horaServidor,
      payload: {
        programacionId: d.actividad.id,
        operarioId: d.operarioId,
        conjuntoId: d.actividad.conjuntoId,
        horaDispositivo: d.horaDispositivo.toISOString(),
        inconsistenciaHora: ejecucion.inconsistenciaHora,
      },
    });
    return ejecucion;
  }

  static reconstituir(props: PropsEjecucion): Ejecucion {
    return new Ejecucion({ ...props, momentosRegistrados: [...props.momentosRegistrados] });
  }

  agregarEvidencia(datos: DatosEvidencia): Evidencia {
    if (this.props.estado === 'FINALIZADA') {
      throw new ErrorDominio('EJECUCION_FINALIZADA', 'The activity is already finished');
    }
    if (this.props.momentosRegistrados.includes(datos.momento)) {
      throw new ErrorDominio('MOMENTO_YA_REGISTRADO', `A ${datos.momento} photo already exists for this activity`);
    }
    const evidencia = Evidencia.crear({ ...datos, ejecucionId: this.id });
    this.props.momentosRegistrados.push(datos.momento);
    this.registrarEvento({
      tipo: 'ejecucion.EvidenciaRecibida',
      agregadoId: this.id,
      ocurridoEn: datos.horaRecepcion,
      payload: {
        evidenciaId: evidencia.id,
        momento: datos.momento,
        operarioId: this.operarioId,
        conjuntoId: this.conjuntoId,
        horaCaptura: datos.horaCaptura.toISOString(),
      },
    });
    return evidencia;
  }

  finalizar(d: DatosFin): void {
    if (this.props.estado === 'FINALIZADA') {
      throw new ErrorDominio('EJECUCION_FINALIZADA', 'The activity is already finished');
    }
    if (d.horaDispositivo.getTime() < this.props.horaInicioDispositivo.getTime()) {
      throw new ErrorDominio('FIN_ANTERIOR_A_INICIO', 'End time is earlier than start time');
    }
    const faltantes = this.momentosFaltantes();
    if (faltantes.length > 0) {
      throw new ErrorDominio('EVIDENCIAS_INCOMPLETAS', `Missing photos: ${faltantes.join(', ')}`, true);
    }
    this.props = {
      ...this.props,
      estado: 'FINALIZADA',
      horaFinDispositivo: d.horaDispositivo,
      horaFinServidor: d.horaServidor,
      observaciones: d.observaciones,
      inconsistenciaHora: this.props.inconsistenciaHora || d.integridad.esInconsistente(d.horaDispositivo, d.horaServidor),
    };
    this.registrarEvento({
      tipo: 'ejecucion.ActividadFinalizada',
      agregadoId: this.id,
      ocurridoEn: d.horaServidor,
      payload: {
        programacionId: this.programacionId,
        operarioId: this.operarioId,
        conjuntoId: this.conjuntoId,
        horaDispositivo: d.horaDispositivo.toISOString(),
        inconsistenciaHora: this.inconsistenciaHora,
      },
    });
  }

  momentosFaltantes(): MomentoEvidencia[] {
    return MOMENTOS_REQUERIDOS.filter((m) => !this.props.momentosRegistrados.includes(m));
  }

  get id() { return this.props.id; }
  get clientUuid() { return this.props.clientUuid; }
  get programacionId() { return this.props.programacionId; }
  get operarioId() { return this.props.operarioId; }
  get conjuntoId() { return this.props.conjuntoId; }
  get estado() { return this.props.estado; }
  get horaInicioDispositivo() { return this.props.horaInicioDispositivo; }
  get horaInicioServidor() { return this.props.horaInicioServidor; }
  get horaFinDispositivo() { return this.props.horaFinDispositivo; }
  get horaFinServidor() { return this.props.horaFinServidor; }
  get inconsistenciaHora() { return this.props.inconsistenciaHora; }
  get observaciones() { return this.props.observaciones; }
}
