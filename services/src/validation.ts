import { z } from 'zod';

export const MAX_MONEY_CENTAVOS = 100_000_000_000;
export const MAX_VERSION = 1_000_000_000;
export const STAFF_ROLES = ['cashier', 'barista'] as const;
export const ADMIN_ROLES = ['owner', 'manager'] as const;
export const isStaffRole = (role: string): role is (typeof STAFF_ROLES)[number] => (STAFF_ROLES as readonly string[]).includes(role);
export const isAdminRole = (role: string): role is (typeof ADMIN_ROLES)[number] => (ADMIN_ROLES as readonly string[]).includes(role);

export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export const roleSchema = z.enum(['cashier', 'barista', 'manager', 'owner']);
export type Role = z.infer<typeof roleSchema>;
export const pinSchema = z.string().regex(/^[A-Za-z0-9]{4,16}$/);
export const passwordSchema = z.string().min(6).refine((s) => Buffer.byteLength(s, 'utf8') <= 72);
export const staffLoginSchema = z.strictObject({ accountId: identifier, pin: pinSchema, deviceId: identifier, deviceSecret: z.string().min(1).max(128) });
export const adminLoginSchema = z.strictObject({ accountId: identifier, password: passwordSchema });
export const provisionAccountSchema = z.strictObject({
  id: identifier, displayName: z.string().trim().min(1).max(100), role: roleSchema,
  branchId: identifier, secret: z.string(),
}).superRefine((value, ctx) => {
  const schema = isStaffRole(value.role) ? pinSchema : passwordSchema;
  if (!schema.safeParse(value.secret).success) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Invalid credential format.' });
});
export const provisionDeviceSchema = z.strictObject({ id: identifier, branchId: identifier, secret: z.string().min(32).max(128) });
export const revokeSchema = z.strictObject({ commandId: z.uuid(), expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });
