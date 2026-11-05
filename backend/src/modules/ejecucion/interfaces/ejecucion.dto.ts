import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsHexadecimal,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OperacionEjecucionDto {
  @IsIn(['INICIO', 'FIN'])
  tipo: 'INICIO' | 'FIN';

  /** Created on the phone when "Start" is tapped; reused by "Finish". */
  @IsUUID()
  clientUuid: string;

  @ValidateIf((o: OperacionEjecucionDto) => o.tipo === 'INICIO')
  @IsUUID()
  programacionId?: string;

  @IsISO8601({ strict: true })
  horaDispositivo: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string;
}

export class SincronizarEjecucionesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperacionEjecucionDto)
  operaciones: OperacionEjecucionDto[];
}

/** Text fields of the multipart upload (the file goes in the "foto" field). */
export class SubirEvidenciaDto {
  @IsUUID()
  clientUuid: string;

  @IsUUID()
  ejecucionClientUuid: string;

  @IsIn(['ANTES', 'DURANTE', 'DESPUES'])
  momento: 'ANTES' | 'DURANTE' | 'DESPUES';

  @IsHexadecimal()
  @Length(64, 64)
  sha256: string;

  @IsISO8601({ strict: true })
  horaCaptura: string;

  // Multipart fields arrive as strings.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;
}
