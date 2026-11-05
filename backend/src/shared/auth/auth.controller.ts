import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsJWT, IsString, MaxLength } from 'class-validator';
import { AuthService, Tokens } from './auth.service';
import { Publico } from './usuario-autenticado';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

class RefreshDto {
  @IsJWT()
  refreshToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<Tokens> {
    return this.auth.login(dto.email, dto.password);
  }

  @Publico()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<Tokens> {
    return this.auth.refrescar(dto.refreshToken);
  }
}
