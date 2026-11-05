import { Geocerca } from '../domain/geocerca';
import { MarcaAsistencia } from '../domain/marca-asistencia';

/** Result of trying to persist a new mark. */
export type ResultadoGuardado =
  | 'GUARDADO'
  /** Another request with the same client_uuid won the race (idempotent retry). */
  | 'CLIENT_UUID_DUPLICADO'
  /** The (operario, conjunto, fecha, tipo) constraint fired. */
  | 'REGLA_UNICIDAD_VIOLADA';

/** Output port: persistence of attendance marks. */
export interface AsistenciaRepositorio {
  buscarPorClientUuid(clientUuid: string): Promise<MarcaAsistencia | null>;
  listarDelDia(operarioId: string, fecha: string): Promise<MarcaAsistencia[]>;
  /** Saves the mark and its domain events atomically. */
  guardar(marca: MarcaAsistencia): Promise<ResultadoGuardado>;
}

/** Output port: geofence of a site (owned by the Sites/Scheduling side). */
export interface ConjuntoConsulta {
  obtenerGeocerca(conjuntoId: string): Promise<Geocerca | null>;
}

/** Output port: asks the Scheduling module whether a visit is planned. */
export interface AgendaConsulta {
  estaProgramado(operarioId: string, conjuntoId: string, fecha: string): Promise<boolean>;
}

export const ASISTENCIA_REPOSITORIO = Symbol('AsistenciaRepositorio');
export const CONJUNTO_CONSULTA = Symbol('ConjuntoConsulta');
export const AGENDA_CONSULTA = Symbol('AgendaConsulta');
