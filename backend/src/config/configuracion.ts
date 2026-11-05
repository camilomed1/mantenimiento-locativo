/** Typed view of the environment. Fails fast if a secret is missing. */
export interface Configuracion {
  puerto: number;
  corsOrigenes: string[];
  zonaHoraria: string;
  toleranciaRelojSegundos: number;
  maxHorasOffline: number;
  jwt: { accessSecret: string; refreshSecret: string; accessTtl: string; refreshTtl: string };
  redis: { host: string; puerto: number; password?: string };
  minio: {
    endpoint: string;
    puerto: number;
    ssl: boolean;
    accessKey: string;
    secretKey: string;
    bucketEvidencias: string;
    /** Base URL the browser uses to open signed photo URLs. */
    urlPublica: string;
  };
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Missing required environment variable: ${nombre}`);
  return valor;
}

export function cargarConfiguracion(): Configuracion {
  return {
    puerto: Number(process.env.PORT ?? 3000),
    corsOrigenes: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    zonaHoraria: process.env.ZONA_HORARIA ?? 'America/Bogota',
    toleranciaRelojSegundos: Number(process.env.CLOCK_SKEW_TOLERANCE_SECONDS ?? 300),
    maxHorasOffline: Number(process.env.MAX_OFFLINE_HOURS ?? 72),
    jwt: {
      accessSecret: requerida('JWT_ACCESS_SECRET'),
      refreshSecret: requerida('JWT_REFRESH_SECRET'),
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      puerto: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    minio: {
      endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      puerto: Number(process.env.MINIO_PORT ?? 9000),
      ssl: process.env.MINIO_USE_SSL === 'true',
      accessKey: requerida('MINIO_ACCESS_KEY'),
      secretKey: requerida('MINIO_SECRET_KEY'),
      bucketEvidencias: process.env.MINIO_BUCKET_EVIDENCIAS ?? 'evidencias',
      urlPublica: process.env.MINIO_PUBLIC_URL ?? 'http://localhost:9000',
    },
  };
}

export const CONFIGURACION = Symbol('Configuracion');
