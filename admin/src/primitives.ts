import { parseHubOrigin } from './origin';

export type Unit = 'g' | 'ml' | 'piece';
export type AdminRole = 'owner' | 'manager';
export type RecoveryScope = {
  hubOrigin: string;
  authorityId: string;
  actorId: string;
  branchId: string;
  role: AdminRole;
};

export const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export const idRouteSegment = '[A-Za-z0-9][A-Za-z0-9_\\-]{0,99}';
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isId = (value: unknown): value is string =>
  typeof value === 'string' && idPattern.test(value);

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);

export const isUnit = (value: unknown): value is Unit =>
  value === 'g' || value === 'ml' || value === 'piece';

export const isAdminRole = (value: unknown): value is AdminRole =>
  value === 'owner' || value === 'manager';

export const isSafeInt = (
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export const isPositiveInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  isSafeInt(value, 1, max);

export const isNonnegativeInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  isSafeInt(value, 0, max);

export const isTimestamp = (value: unknown): value is number =>
  isSafeInt(value, 0, 8.64e15);

export function isNonblankText(value: unknown, maxLength: number, requireTrimmed = false): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && (!requireTrimmed || value === trimmed);
}

export function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validIsoDate(value: unknown, verifyCalendar = false): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (!verifyCalendar) return true;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

export function validDatePeriod(from: unknown, through: unknown, verifyCalendar = false): boolean {
  return validIsoDate(from, verifyCalendar) && validIsoDate(through, verifyCalendar) && from <= through;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(
      key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key]),
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function isValidScope(value: unknown): value is RecoveryScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Record<string, unknown>;
  if (!isNonblankText(scope.hubOrigin, 2048) || !isUuid(scope.authorityId) ||
    !isId(scope.actorId) || !isId(scope.branchId) || !isAdminRole(scope.role)) return false;
  try {
    return parseHubOrigin(scope.hubOrigin) === scope.hubOrigin;
  } catch {
    return false;
  }
}

export function matchesScope(target: RecoveryScope, scope: RecoveryScope): boolean {
  return target.hubOrigin === scope.hubOrigin && target.authorityId === scope.authorityId &&
    target.actorId === scope.actorId && target.branchId === scope.branchId && target.role === scope.role;
}
