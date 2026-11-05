import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ResultadoSync } from '../../../shared/domain/resultado-sync';

export class MarcaAsistenciaDto {
  /** UUID generated on the phone when the button was pressed. */
  @IsUUID()
  clientUuid: string;

  @IsUUID()
  conjuntoId: string;

  @IsIn(['ENTRADA', 'SALIDA'])
  tipo: 'ENTRADA' | 'SALIDA';

  /** Device time, ISO 8601 with offset (e.g. 2026-11-05T07:02:11.000-05:00). */
  @IsISO8601({ strict: true })
  horaDispositivo: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precisionMetros?: number;
}

export class SincronizarAsistenciasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MarcaAsistenciaDto)
  marcas: MarcaAsistenciaDto[];
}

export interface RespuestaSync {
  resultados: ResultadoSync[];
}
