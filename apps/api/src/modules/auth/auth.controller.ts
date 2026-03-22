import { Controller, Post, Body, Req, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

class RequestResetDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @MinLength(6)
  newPassword: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.tenantId
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
    return this.authService.login(user, typeof ip === 'string' ? ip : ip?.[0]);
  }

  @Post('request-reset')
  @HttpCode(HttpStatus.OK)
  async requestReset(@Body() dto: RequestResetDto) {
    await this.authService.requestPasswordReset(dto.email, dto.tenantSlug);
    return { message: 'Si el correo existe, se envió un código de recuperación.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword, dto.tenantSlug);
    return { message: 'Contraseña actualizada exitosamente.' };
  }
}
