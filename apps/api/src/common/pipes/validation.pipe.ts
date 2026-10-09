/**
 * ValidationPipe berbasis Zod.
 *
 * Menggantikan ValidationPipe bawaan Nest (yang bergantung pada class-validator)
 * dengan perilaku yang setara:
 *
 *   - `whitelist`            : kunci yang tidak ada di skema dibuang (strip)
 *   - `forbidNonWhitelisted` : bila ada kunci asing, permintaan DITOLAK
 *   - `transform`            : keluaran sudah dalam bentuk hasil parse (coerce)
 *
 * Seluruh skema berasal dari `@osda/contracts`; tidak ada DTO class di API ini.
 */
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
  Type,
} from '@nestjs/common';
import { ZodError, ZodType, z } from 'zod';

/** Bentuk (shape) object schema Zod. */
type BentukObjek = { shape?: Record<string, unknown> };

export interface OpsiValidationPipe {
  /** Tolak kunci yang tidak dikenal (default true). */
  forbidNonWhitelisted?: boolean;
  /** Buang kunci yang tidak dikenal (default true). */
  whitelist?: boolean;
}

@Injectable()
export class ValidationPipe implements PipeTransform {
  private readonly skemaBawaan: ZodType | null;
  private readonly opsi: OpsiValidationPipe;

  constructor(skema?: ZodType | OpsiValidationPipe, opsi: OpsiValidationPipe = {}) {
    if (skema instanceof ZodType) {
      this.skemaBawaan = skema;
      this.opsi = { forbidNonWhitelisted: true, whitelist: true, ...opsi };
    } else {
      this.skemaBawaan = null;
      this.opsi = { forbidNonWhitelisted: true, whitelist: true, ...skema };
    }
  }

  transform(nilai: unknown, metadata?: ArgumentMetadata): unknown {
    const skema = this.pilihSkema(metadata);
    if (!skema) return nilai;

    const bersih = this.opsi.whitelist === false ? nilai : this.periksaKunciAsing(nilai, skema);

    const hasil = skema.safeParse(bersih);
    if (hasil.success) return hasil.data;

    this.lemparGalatValidasi(hasil.error);
  }

  /** Pilih skema: eksplisit dari constructor, atau metatype bila itu Zod schema. */
  private pilihSkema(metadata?: ArgumentMetadata): ZodType | null {
    if (this.skemaBawaan) return this.skemaBawaan;
    const metatype = metadata?.metatype as (Type<unknown> & ZodType) | undefined;
    if (metatype instanceof ZodType) return metatype;
    return null;
  }

  /**
   * Deteksi kunci asing sebelum parse. Zod `.strip()` (perilaku bawaan) sudah
   * membuangnya; pemeriksaan ini membuat `forbidNonWhitelisted` benar-benar
   * menolak permintaan alih-alih diam-diam membuang kunci.
   */
  private periksaKunciAsing(nilai: unknown, skema: ZodType): unknown {
    if (!this.opsi.forbidNonWhitelisted) return nilai;
    if (typeof nilai !== 'object' || nilai === null || Array.isArray(nilai)) return nilai;

    const bentuk = this.bentukSkema(skema);
    if (!bentuk) return nilai;

    const dikenal = Object.keys(bentuk);
    const asing = Object.keys(nilai as Record<string, unknown>).filter((k) => !dikenal.includes(k));
    if (asing.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Kunci tidak dikenal pada masukan: ${asing.join(', ')}`,
        },
      });
    }
    return nilai;
  }

  /** Ambil bentuk (shape) object schema bila tipe schema memungkinkan. */
  private bentukSkema(skema: ZodType): BentukObjek | null {
    const s = skema as unknown as BentukObjek & { _def?: BendukDef };
    if (s.shape) return s.shape as BentukObjek;
    const dalam = s._def?.schema as BentukObjek | undefined;
    if (dalam?.shape) return dalam.shape as BentukObjek;
    return null;
  }

  private lemparGalatValidasi(galat: ZodError): never {
    const rincian = galat.issues.map((isu) => ({
      path: isu.path.join('.'),
      kode: isu.code,
      pesan: isu.message,
    }));
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Data yang dikirim tidak valid.',
        detail: rincian,
      },
    });
  }
}

type BendukDef = { schema?: BentukObjek };
