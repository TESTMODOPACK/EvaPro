import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class ExportTenantDto {
  /**
   * When true, personal identifiers (names, emails, RUTs, dates of birth) are
   * replaced with pseudonyms in the generated export. Useful when the data
   * will be shared outside the org (consultants, audit).
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  anonymize?: boolean;
}
