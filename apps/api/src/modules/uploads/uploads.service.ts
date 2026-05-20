import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { AuditService } from '../audit/audit.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
];

@Injectable()
export class UploadsService {
  constructor(private readonly auditService: AuditService) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    tenantId: string,
    folder?: string,
    uploaderUserId?: string,
  ): Promise<{ url: string; publicId: string; originalName: string; size: number }> {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      throw new BadRequestException('Cloudinary no est\u00e1 configurado. Contacte al administrador del sistema.');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`El archivo excede el l\u00edmite de ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de archivo no permitido. Formatos aceptados: PDF, Word, Excel, PowerPoint, im\u00e1genes, texto, CSV.',
      );
    }

    const uploadFolder = `evapro/${tenantId}/${folder || 'attachments'}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: uploadFolder,
          resource_type: 'auto',
          public_id: `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
          access_mode: 'authenticated',
        },
        (error, result) => {
          if (error) {
            reject(new BadRequestException(`Error al subir archivo: ${error.message}`));
          } else {
            // B2-15: trazabilidad de quién subió qué. Antes el upload no
            // dejaba rastro en audit → imposible revocar/investigar.
            // Una tabla dedicada de uploads (ownership por entidad) queda
            // como follow-up; el audit log cubre el mínimo trazabilidad.
            this.auditService
              .log(tenantId, uploaderUserId ?? null, 'upload.created', 'upload', result!.public_id, {
                folder: uploadFolder,
                originalName: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                url: result!.secure_url,
              })
              .catch(() => undefined);
            resolve({
              url: result!.secure_url,
              publicId: result!.public_id,
              originalName: file.originalname,
              size: file.size,
            });
          }
        },
      );
      uploadStream.end(file.buffer);
    });
  }
}
