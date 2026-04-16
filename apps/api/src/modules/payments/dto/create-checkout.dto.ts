import { IsEnum, IsUUID } from 'class-validator';

export enum CheckoutProviderDto {
  STRIPE = 'stripe',
  MERCADOPAGO = 'mercadopago',
}

export class CreateCheckoutDto {
  @IsUUID()
  invoiceId: string;

  @IsEnum(CheckoutProviderDto, { message: 'provider debe ser stripe o mercadopago.' })
  provider: CheckoutProviderDto;
}
