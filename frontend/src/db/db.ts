import Dexie, { type EntityTable } from 'dexie';

/**
 * Local database (IndexedDB via Dexie). It is the source of truth on the
 * phone: every action is saved here first, then the sync engine sends it.
 */

/** Local sync state of a record. */
export type EstadoLocal = 'PENDIENTE' | 'SINCRONIZADO' | 'RECHAZADO';

export interface InfoSync {
  sync: EstadoLocal;
  intentos: number;
  /** Epoch ms; the record is not sent before this (exponential backoff). */
  proximoIntento: number;
  codigo?: string;
  mensaje?: string;
  /** Server reception time (ISO), shown next to the device time. */
  horaServidor?: string;
}

export interface Sesion {
  id: 'actual';
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nombre: string; rol: string; operarioId: string | null };
  /** True when the refresh token was rejected; the user must log in again. */
  expirada: boolean;
}

export interface ConjuntoAgenda {
  id: string;
  nombre: string;
  direccion: string;
  latitud: number;
  longitud: number;
  radioGeocercaMetros: number;
}

/** Scheduled activity downloaded while online. */
export interface ActividadAgenda {
  programacionId: string;
  fecha: string;
  tipoServicio: string;
  actividad: string;
  descripcion: string | null;
  conjunto: ConjuntoAgenda;
  /** Execution state known by the server (e.g. started from another device). */
  ejecucionServidor: { clientUuid: string; estado: string } | null;
}

export interface Ubicacion {
  latitud: number;
  longitud: number;
  precisionMetros: number;
}

export interface Marca extends InfoSync {
  clientUuid: string;
  conjuntoId: string;
  fecha: string;
  tipo: 'ENTRADA' | 'SALIDA';
  horaDispositivo: string;
  ubicacion: Ubicacion | null;
  /** Local geofence check, only to warn the operator. The server decides. */
  dentroGeocerca: boolean | null;
}

export interface Ejecucion {
  /** Same uuid for start and finish (the server uses it for both). */
  clientUuid: string;
  programacionId: string;
  fecha: string;
  horaInicio: string;
  inicio: InfoSync;
  horaFin: string | null;
  observaciones: string | null;
  fin: InfoSync | null;
}

export type Momento = 'ANTES' | 'DURANTE' | 'DESPUES';

export interface Foto extends InfoSync {
  clientUuid: string;
  ejecucionClientUuid: string;
  momento: Momento;
  /** Compressed JPEG. Deleted after sync to free space on low-end phones. */
  blob: Blob | null;
  /** Small preview kept after the full photo is deleted. */
  miniatura: Blob | null;
  sha256: string;
  mimeType: string;
  tamanoBytes: number;
  horaCaptura: string;
  ubicacion: Ubicacion | null;
}

export interface Ajuste {
  clave: string;
  valor: string;
}

export class BaseLocal extends Dexie {
  sesion!: EntityTable<Sesion, 'id'>;
  agenda!: EntityTable<ActividadAgenda, 'programacionId'>;
  marcas!: EntityTable<Marca, 'clientUuid'>;
  ejecuciones!: EntityTable<Ejecucion, 'clientUuid'>;
  fotos!: EntityTable<Foto, 'clientUuid'>;
  ajustes!: EntityTable<Ajuste, 'clave'>;

  constructor(nombre = 'mantenimiento-locativo') {
    super(nombre);
    this.version(1).stores({
      sesion: 'id',
      agenda: 'programacionId, fecha',
      marcas: 'clientUuid, [fecha+conjuntoId], sync',
      ejecuciones: 'clientUuid, &programacionId, fecha',
      fotos: 'clientUuid, ejecucionClientUuid, sync',
      ajustes: 'clave',
    });
  }
}

export const db = new BaseLocal();

export function nuevoInfoSync(): InfoSync {
  return { sync: 'PENDIENTE', intentos: 0, proximoIntento: 0 };
}
