import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { CONFIGURACION, Configuracion } from '../../../config/configuracion';
import { AlmacenamientoEvidencias } from '../application/puertos';

const REGION = 'us-east-1';

/**
 * Driven adapter: photo storage on MinIO (S3 API). Replacing it with AWS S3
 * only means writing another class that implements AlmacenamientoEvidencias.
 */
@Injectable()
export class MinioAlmacenamiento implements AlmacenamientoEvidencias, OnModuleInit {
  private readonly logger = new Logger(MinioAlmacenamiento.name);
  /** Talks to MinIO from inside the Docker network. */
  private readonly interno: Client;
  /**
   * Signs URLs with the host the browser can reach. Signing is local (no
   * network call) because the region is fixed.
   */
  private readonly publico: Client;
  readonly bucket: string;

  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    const { minio } = config;
    this.bucket = minio.bucketEvidencias;
    this.interno = new Client({
      endPoint: minio.endpoint,
      port: minio.puerto,
      useSSL: minio.ssl,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      region: REGION,
    });
    const url = new URL(minio.urlPublica);
    this.publico = new Client({
      endPoint: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:',
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      region: REGION,
    });
  }

  private bucketListo = false;

  /** Prepares the bucket in the background so a slow MinIO never blocks startup. */
  onModuleInit(): void {
    void this.prepararBucket(10);
  }

  /** Creates the private bucket if missing (idempotent). */
  private async prepararBucket(intentos: number): Promise<void> {
    for (let intento = 1; intento <= intentos && !this.bucketListo; intento++) {
      try {
        if (!(await this.interno.bucketExists(this.bucket))) {
          await this.interno.makeBucket(this.bucket, REGION);
          this.logger.log(`Bucket "${this.bucket}" created`);
        }
        this.bucketListo = true;
      } catch (error) {
        this.logger.warn(`MinIO not ready (attempt ${intento}/${intentos}): ${(error as Error).message}`);
        if (intento < intentos) await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async guardar(objectKey: string, contenido: Buffer, mimeType: string, sha256: string): Promise<void> {
    if (!this.bucketListo) await this.prepararBucket(1);
    await this.interno.putObject(this.bucket, objectKey, contenido, contenido.length, {
      'Content-Type': mimeType,
      'x-amz-meta-sha256': sha256,
    });
  }

  urlFirmada(objectKey: string, segundos: number): Promise<string> {
    return this.publico.presignedGetObject(this.bucket, objectKey, segundos);
  }
}
