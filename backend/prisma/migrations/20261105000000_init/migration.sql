-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMINISTRADOR', 'ADMINISTRATIVO', 'SUPERVISOR', 'OPERARIO');

-- CreateEnum
CREATE TYPE "TipoServicio" AS ENUM ('PISCINA', 'PINTURA', 'JARDINERIA', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoProgramacion" AS ENUM ('BORRADOR', 'PUBLICADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoMarcaAsistencia" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateEnum
CREATE TYPE "EstadoEjecucion" AS ENUM ('EN_CURSO', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "MomentoEvidencia" AS ENUM ('ANTES', 'DURANTE', 'DESPUES');

-- CreateEnum
CREATE TYPE "EstadoOutbox" AS ENUM ('PENDIENTE', 'PUBLICADO', 'FALLIDO');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operario" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "documento" VARCHAR(20) NOT NULL,
    "nombres" VARCHAR(100) NOT NULL,
    "apellidos" VARCHAR(100) NOT NULL,
    "telefono" VARCHAR(20),
    "fecha_ingreso" DATE NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conjunto" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "direccion" VARCHAR(200) NOT NULL,
    "ciudad" VARCHAR(80) NOT NULL,
    "latitud" DECIMAL(9,6) NOT NULL,
    "longitud" DECIMAL(9,6) NOT NULL,
    "radio_geocerca_metros" INTEGER NOT NULL DEFAULT 150,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conjunto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programacion" (
    "id" UUID NOT NULL,
    "operario_id" UUID NOT NULL,
    "conjunto_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "semana_inicio" DATE NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo_servicio" "TipoServicio" NOT NULL,
    "actividad" VARCHAR(200) NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoProgramacion" NOT NULL DEFAULT 'BORRADOR',
    "publicada_en" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asistencia" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "operario_id" UUID NOT NULL,
    "conjunto_id" UUID NOT NULL,
    "tipo" "TipoMarcaAsistencia" NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_dispositivo" TIMESTAMPTZ(3) NOT NULL,
    "hora_servidor" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desfase_segundos" INTEGER NOT NULL,
    "inconsistencia_hora" BOOLEAN NOT NULL DEFAULT false,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "precision_metros" DECIMAL(8,2),
    "dentro_geocerca" BOOLEAN,

    CONSTRAINT "asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ejecucion" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "programacion_id" UUID NOT NULL,
    "operario_id" UUID NOT NULL,
    "estado" "EstadoEjecucion" NOT NULL DEFAULT 'EN_CURSO',
    "hora_inicio_dispositivo" TIMESTAMPTZ(3) NOT NULL,
    "hora_inicio_servidor" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hora_fin_dispositivo" TIMESTAMPTZ(3),
    "hora_fin_servidor" TIMESTAMPTZ(3),
    "inconsistencia_hora" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ejecucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencia" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "ejecucion_id" UUID NOT NULL,
    "momento" "MomentoEvidencia" NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "object_key" VARCHAR(300) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "hora_captura" TIMESTAMPTZ(3) NOT NULL,
    "hora_recepcion" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),

    CONSTRAINT "evidencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_evento" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "agregado_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" "EstadoOutbox" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicado_en" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "usuario_rol_idx" ON "usuario"("rol");

-- CreateIndex
CREATE UNIQUE INDEX "operario_usuario_id_key" ON "operario"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "operario_documento_key" ON "operario"("documento");

-- CreateIndex
CREATE INDEX "programacion_operario_id_fecha_idx" ON "programacion"("operario_id", "fecha");

-- CreateIndex
CREATE INDEX "programacion_conjunto_id_fecha_idx" ON "programacion"("conjunto_id", "fecha");

-- CreateIndex
CREATE INDEX "programacion_supervisor_id_fecha_idx" ON "programacion"("supervisor_id", "fecha");

-- CreateIndex
CREATE INDEX "programacion_semana_inicio_estado_idx" ON "programacion"("semana_inicio", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "asistencia_client_uuid_key" ON "asistencia"("client_uuid");

-- CreateIndex
CREATE INDEX "asistencia_operario_id_fecha_idx" ON "asistencia"("operario_id", "fecha");

-- CreateIndex
CREATE INDEX "asistencia_conjunto_id_fecha_idx" ON "asistencia"("conjunto_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "asistencia_operario_id_conjunto_id_fecha_tipo_key" ON "asistencia"("operario_id", "conjunto_id", "fecha", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "ejecucion_client_uuid_key" ON "ejecucion"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "ejecucion_programacion_id_key" ON "ejecucion"("programacion_id");

-- CreateIndex
CREATE INDEX "ejecucion_operario_id_hora_inicio_dispositivo_idx" ON "ejecucion"("operario_id", "hora_inicio_dispositivo");

-- CreateIndex
CREATE INDEX "ejecucion_estado_idx" ON "ejecucion"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "evidencia_client_uuid_key" ON "evidencia"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "evidencia_object_key_key" ON "evidencia"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "evidencia_ejecucion_id_momento_key" ON "evidencia"("ejecucion_id", "momento");

-- CreateIndex
CREATE INDEX "outbox_evento_estado_creado_en_idx" ON "outbox_evento"("estado", "creado_en");

-- AddForeignKey
ALTER TABLE "operario" ADD CONSTRAINT "operario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programacion" ADD CONSTRAINT "programacion_operario_id_fkey" FOREIGN KEY ("operario_id") REFERENCES "operario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programacion" ADD CONSTRAINT "programacion_conjunto_id_fkey" FOREIGN KEY ("conjunto_id") REFERENCES "conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programacion" ADD CONSTRAINT "programacion_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programacion" ADD CONSTRAINT "programacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_operario_id_fkey" FOREIGN KEY ("operario_id") REFERENCES "operario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_conjunto_id_fkey" FOREIGN KEY ("conjunto_id") REFERENCES "conjunto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecucion" ADD CONSTRAINT "ejecucion_programacion_id_fkey" FOREIGN KEY ("programacion_id") REFERENCES "programacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecucion" ADD CONSTRAINT "ejecucion_operario_id_fkey" FOREIGN KEY ("operario_id") REFERENCES "operario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia" ADD CONSTRAINT "evidencia_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecucion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

