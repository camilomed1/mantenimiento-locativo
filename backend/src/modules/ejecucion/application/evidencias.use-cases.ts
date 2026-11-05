import { createHash, randomUUID } from 'node:crypto';
import { ErrorDominio } from '../../../shared/domain/error-dominio';
import { Reloj } from '../../../shared/domain/reloj';
import { ResultadoSync } from '../../../shared/domain/resultado-sync';
import { MomentoEvidencia } from '../domain/evidencia';
import { AlmacenamientoEvidencias, EjecucionRepositorio } from './puertos';

export interface RegistrarEvidenciaComando {
  operarioId: string;
  clientUuid: string;
  /** client_uuid of the execution (created when the activity was started). */
  ejecucionClientUuid: string;
  momento: MomentoEvidencia;
  /** SHA-256 computed on the phone over the compressed file. */
  sha256: string;
  horaCaptura: Date;
  latitud: number | null;
  longitud: number | null;
  archivo: { contenido: Buffer; mimeType: string };
}

const EXTENSIONES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Use case: receive one compressed photo from the offline queue.
 *
 * Idempotency on two levels:
 * - DB: client_uuid is UNIQUE, so a retried upload returns DUPLICADO.
 * - Storage: the object key is deterministic, so if the DB insert fails
 *   after the upload, the retry overwrites the same object (no orphans).
 */
export class RegistrarEvidencia {
  constructor(
    private readonly repositorio: EjecucionRepositorio,
    private readonly almacenamiento: AlmacenamientoEvidencias,
    private readonly reloj: Reloj,
  ) {}

  async ejecutar(cmd: RegistrarEvidenciaComando): Promise<ResultadoSync> {
    const existente = await this.repositorio.buscarEvidenciaPorClientUuid(cmd.clientUuid);
    if (existente) return ResultadoSync.duplicado(cmd.clientUuid, existente.horaRecepcion);

    try {
      const ejecucion = await this.repositorio.buscarPorClientUuid(cmd.ejecucionClientUuid);
      if (!ejecucion) {
        throw new ErrorDominio('EJECUCION_NO_SINCRONIZADA', 'The start of this activity has not synced yet', true);
      }
      if (ejecucion.operarioId !== cmd.operarioId) {
        throw new ErrorDominio('ACTIVIDAD_NO_ASIGNADA', 'This activity belongs to another operator');
      }

      // Integrity: the received bytes must be exactly what the phone hashed.
      const hashRecibido = createHash('sha256').update(cmd.archivo.contenido).digest('hex');
      const sha256 = cmd.sha256.toLowerCase();
      if (hashRecibido !== sha256) {
        throw new ErrorDominio('HASH_NO_COINCIDE', 'File is corrupted in transit; upload it again', true);
      }

      const horaRecepcion = this.reloj.ahora();
      const ext = EXTENSIONES[cmd.archivo.mimeType] ?? 'bin';
      const dia = ejecucion.horaInicioServidor.toISOString().slice(0, 10).replace(/-/g, '/');
      const objectKey = `${dia}/${ejecucion.id}/${cmd.clientUuid}.${ext}`;

      // Domain rules run before touching storage.
      const evidencia = ejecucion.agregarEvidencia({
        id: randomUUID(),
        clientUuid: cmd.clientUuid,
        momento: cmd.momento,
        bucket: this.almacenamiento.bucket,
        objectKey,
        sha256,
        mimeType: cmd.archivo.mimeType,
        tamanoBytes: cmd.archivo.contenido.length,
        horaCaptura: cmd.horaCaptura,
        horaRecepcion,
        latitud: cmd.latitud,
        longitud: cmd.longitud,
      });

      await this.almacenamiento.guardar(objectKey, cmd.archivo.contenido, cmd.archivo.mimeType, sha256);

      switch (await this.repositorio.guardarEvidencia(ejecucion, evidencia)) {
        case 'GUARDADO':
          return ResultadoSync.aceptado(cmd.clientUuid, horaRecepcion);
        case 'CLIENT_UUID_DUPLICADO':
          return ResultadoSync.duplicado(cmd.clientUuid);
        case 'REGLA_UNICIDAD_VIOLADA':
          throw new ErrorDominio('MOMENTO_YA_REGISTRADO', `A ${cmd.momento} photo already exists for this activity`);
      }
    } catch (error) {
      if (!(error instanceof ErrorDominio)) throw error;
      // A concurrent retry of this same photo may have been stored meanwhile.
      const guardadaMientras = await this.repositorio.buscarEvidenciaPorClientUuid(cmd.clientUuid);
      if (guardadaMientras) return ResultadoSync.duplicado(cmd.clientUuid, guardadaMientras.horaRecepcion);
      return ResultadoSync.desdeError(cmd.clientUuid, error);
    }
  }
}

export interface Solicitante {
  rol: 'ADMINISTRADOR' | 'ADMINISTRATIVO' | 'SUPERVISOR' | 'OPERARIO';
  operarioId: string | null;
}

/** Use case: get a short-lived signed URL to view a photo. */
export class ObtenerUrlEvidencia {
  static readonly SEGUNDOS_VALIDEZ = 600;

  constructor(
    private readonly repositorio: EjecucionRepositorio,
    private readonly almacenamiento: AlmacenamientoEvidencias,
  ) {}

  async ejecutar(evidenciaId: string, solicitante: Solicitante): Promise<{ url: string; expiraEnSegundos: number }> {
    const encontrada = await this.repositorio.buscarEvidencia(evidenciaId);
    if (!encontrada) throw new ErrorDominio('EVIDENCIA_NO_EXISTE', 'Photo not found');
    if (solicitante.rol === 'OPERARIO' && solicitante.operarioId !== encontrada.operarioId) {
      throw new ErrorDominio('ACCESO_DENEGADO', 'Operators can only see their own photos');
    }
    const url = await this.almacenamiento.urlFirmada(encontrada.evidencia.objectKey, ObtenerUrlEvidencia.SEGUNDOS_VALIDEZ);
    return { url, expiraEnSegundos: ObtenerUrlEvidencia.SEGUNDOS_VALIDEZ };
  }
}
