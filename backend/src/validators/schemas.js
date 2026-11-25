import { z } from 'zod';

export const DIARY_CATEGORIES = ['personal', 'gratitud', 'metas', 'recuerdos'];
export const DIARY_MOODS = ['bien', 'tranquilo', 'normal', 'triste', 'agotado'];
export const USER_ROLES = ['user', 'admin'];
export const MAX_DIARY_ENTRIES_PER_USER = 100;
export const MAX_DIARY_CONTENT_LENGTH = 10000;
export const MAX_DIARY_TITLE_LENGTH = 200;

export const passwordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(128, 'La contraseña no puede superar los 128 caracteres.')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una letra mayúscula.')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una letra minúscula.')
  .refine((v) => /[0-9]/.test(v), 'Debe incluir al menos un número.')
  .refine((v) => /[^A-Za-z0-9\s]/.test(v), 'Debe incluir al menos un símbolo.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Ingresa un correo electrónico válido.')
  .max(254, 'El correo electrónico es demasiado largo.');

export const uuidParamSchema = z.string().uuid('Identificador inválido.');

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres.')
      .max(120, 'El nombre no puede superar 120 caracteres.'),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Ingresa tu contraseña.').max(128),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{64}$/, 'El enlace de recuperación no es válido o está incompleto.'),
    newPassword: passwordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual.').max(128),
    newPassword: passwordSchema,
  })
  .strict();

const phoneSchema = z
  .string()
  .trim()
  .max(30, 'El teléfono es demasiado largo.')
  .refine(
    (val) => val === '' || /^[0-9+\-()\s]{7,30}$/.test(val),
    'Usa solo dígitos, espacios y los símbolos +, -, ( ).'
  );

export const profileUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres.')
      .max(120, 'El nombre no puede superar 120 caracteres.'),
    phone: phoneSchema.nullable().optional(),
    sensitiveNote: z
      .string()
      .trim()
      .max(200, 'El dato sensible de prueba no puede superar 200 caracteres.')
      .nullable()
      .optional(),
  })
  .strict();

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD.')
  .refine((val) => {
    const [y, m, d] = val.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Fecha calendario inválida.');

export const diaryCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'El título es obligatorio.')
      .max(MAX_DIARY_TITLE_LENGTH, `El título no puede superar ${MAX_DIARY_TITLE_LENGTH} caracteres.`),
    entryDate: isoDateSchema,
    category: z.enum(DIARY_CATEGORIES, {
      message: 'Selecciona una categoría válida.',
    }),
    mood: z.enum(DIARY_MOODS, {
      message: 'Selecciona un estado de ánimo válido.',
    }),
    content: z
      .string()
      .min(1, 'Escribe algo en tu entrada antes de guardar.')
      .max(MAX_DIARY_CONTENT_LENGTH, `El contenido no puede superar ${MAX_DIARY_CONTENT_LENGTH} caracteres.`),
  })
  .strict();

export const diaryUpdateSchema = diaryCreateSchema
  .extend({
    version: z.number().int().min(1, 'Versión de registro inválida.'),
  })
  .strict();

export const diaryFilterSchema = z.object({
  search: z.string().trim().max(120).optional().default(''),
  category: z.enum(['', ...DIARY_CATEGORIES]).optional().default(''),
  mood: z.enum(['', ...DIARY_MOODS]).optional().default(''),
});

export const adminRoleUpdateSchema = z
  .object({
    role: z.enum(USER_ROLES),
    currentPassword: z.string().min(1, 'Confirma tu contraseña para cambiar roles.').max(128),
    confirmed: z.literal(true, {
      message: 'Debes confirmar explícitamente el cambio de rol.',
    }),
  })
  .strict();
