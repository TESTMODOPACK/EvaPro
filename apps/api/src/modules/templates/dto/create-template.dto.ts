import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * Fase 3 (Opción A): sections es ahora OPCIONAL al crear plantillas.
   * Si NO se pasa sections pero SÍ se pasa defaultCycleType, el service
   * auto-genera N subplantillas vacías (form_sub_templates) listas para
   * que el admin las edite por tabs.
   *
   * Si sections se pasa: comportamiento legacy (Fase 2) — se guarda en
   * form_templates.sections; el service migra a sub_templates inline al
   * primer GET con sub_templates.
   */
  @IsArray()
  @IsOptional()
  sections?: any[];

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsString()
  @IsOptional()
  language?: string; // ISO 639-1: es, en, pt

  @IsOptional()
  translations?: Record<string, any>; // { "en": sections[], "pt": sections[] }

  /**
   * Fase 3 (Opción A): si está set, al crear el template se auto-generan
   * las subplantillas (form_sub_templates) correspondientes a los roles
   * del ALLOWED_RELATIONS para ese cycle type, con pesos default.
   * Valores válidos: '90' | '180' | '270' | '360'.
   */
  @IsString()
  @IsIn(['90', '180', '270', '360'])
  @IsOptional()
  defaultCycleType?: string;
}
