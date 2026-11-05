import { ActividadProgramada, Ejecucion } from '../domain/ejecucion';
import { Evidencia } from '../domain/evidencia';

export type ResultadoGuardado = 'GUARDADO' | 'CLIENT_UUID_DUPLICADO' | 'REGLA_UNICIDAD_VIOLADA';

/** Output port: persistence of executions and their photo metadata. */
export interface EjecucionRepositorio {
  buscarPorClientUuid(clientUuid: string): Promise<Ejecucion | null>;
  buscarPorProgramacion(programacionId: string): Promise<Ejecucion | null>;
  guardarNueva(ejecucion: Ejecucion): Promise<ResultadoGuardado>;
  /** Returns false if another request finished it first. */
  guardarFinalizacion(ejecucion: Ejecucion): Promise<boolean>;
  buscarEvidenciaPorClientUuid(clientUuid: string): Promise<Evidencia | null>;
  guardarEvidencia(ejecucion: Ejecucion, evidencia: Evidencia): Promise<ResultadoGuardado>;
  /** Photo plus the operator who owns it (for access control). */
  buscarEvidencia(id: string): Promise<{ evidencia: Evidencia; operarioId: string } | null>;
}

/** Output port: read access to the Scheduling module. */
export interface ProgramacionConsulta {
  obtenerActividad(programacionId: string): Promise<ActividadProgramada | null>;
}

/** Output port: object storage for photos (MinIO today, S3 tomorrow). */
export interface AlmacenamientoEvidencias {
  readonly bucket: string;
  guardar(objectKey: string, contenido: Buffer, mimeType: string, sha256: string): Promise<void>;
  urlFirmada(objectKey: string, segundos: number): Promise<string>;
}

export const EJECUCION_REPOSITORIO = Symbol('EjecucionRepositorio');
export const PROGRAMACION_CONSULTA = Symbol('ProgramacionConsulta');
export const ALMACENAMIENTO_EVIDENCIAS = Symbol('AlmacenamientoEvidencias');
