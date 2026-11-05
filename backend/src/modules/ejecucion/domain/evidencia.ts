import { ErrorDominio } from '../../../shared/domain/error-dominio';

export type MomentoEvidencia = 'ANTES' | 'DURANTE' | 'DESPUES';
export const MOMENTOS_REQUERIDOS: readonly MomentoEvidencia[] = ['ANTES', 'DURANTE', 'DESPUES'];

/** Photos are compressed on the phone (~300 KB); anything bigger is rejected. */
export const TAMANO_MAXIMO_BYTES = 2 * 1024 * 1024;
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/webp'] as const;

export interface PropsEvidencia {
  id: string;
  clientUuid: string;
  ejecucionId: string;
  momento: MomentoEvidencia;
  bucket: string;
  objectKey: string;
  sha256: string;
  mimeType: string;
  tamanoBytes: number;
  horaCaptura: Date;
  horaRecepcion: Date;
  latitud: number | null;
  longitud: number | null;
}

/**
 * Entity: metadata of one photo. The image itself lives in object storage;
 * the SHA-256 lets anyone prove the file was not changed after capture.
 */
export class Evidencia {
  private constructor(private readonly props: PropsEvidencia) {}

  static crear(props: PropsEvidencia): Evidencia {
    if (!/^[a-f0-9]{64}$/.test(props.sha256)) {
      throw new ErrorDominio('HASH_INVALIDO', 'sha256 must be 64 lowercase hex characters');
    }
    if (!(TIPOS_PERMITIDOS as readonly string[]).includes(props.mimeType)) {
      throw new ErrorDominio('TIPO_NO_PERMITIDO', `Only ${TIPOS_PERMITIDOS.join(', ')} are allowed`);
    }
    if (props.tamanoBytes <= 0 || props.tamanoBytes > TAMANO_MAXIMO_BYTES) {
      throw new ErrorDominio('TAMANO_INVALIDO', 'Photo must be compressed to 2 MB or less');
    }
    return new Evidencia(props);
  }

  static reconstituir(props: PropsEvidencia): Evidencia {
    return new Evidencia(props);
  }

  get id() { return this.props.id; }
  get clientUuid() { return this.props.clientUuid; }
  get ejecucionId() { return this.props.ejecucionId; }
  get momento() { return this.props.momento; }
  get bucket() { return this.props.bucket; }
  get objectKey() { return this.props.objectKey; }
  get sha256() { return this.props.sha256; }
  get mimeType() { return this.props.mimeType; }
  get tamanoBytes() { return this.props.tamanoBytes; }
  get horaCaptura() { return this.props.horaCaptura; }
  get horaRecepcion() { return this.props.horaRecepcion; }
  get latitud() { return this.props.latitud; }
  get longitud() { return this.props.longitud; }
}
