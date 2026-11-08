import { exactKeys, idRouteSegment, isId, isNonblankText, isSafeInt, isTimestamp, isUuid } from './primitives';

export const inventoryAlertsPath = '/api/v1/inventory/alerts';
export const inventoryThresholdsPath = '/api/v1/inventory/thresholds';
export const maxThresholdMilli = 1_000_000_000_000;
export const maxAlertNote = 160;
export type Threshold = { ingredientId: string; thresholdMilli: number | null; version: number };
type Snapshot = { onHandMilli: number; reservedMilli: number; availableMilli: number; thresholdMilli: number | null };
export type StockAlert = Snapshot & {
  id: string; branchId: string; ingredientId: string; kind: 'low_stock' | 'shortage';
  status: 'open' | 'acknowledged' | 'resolved'; version: number;
  openedAt: number; lastEvaluatedAt: number; acknowledgedBy: string | null; acknowledgedAt: number | null;
  acknowledgmentNote: string | null; resolvedAt: number | null; resolution: 'stock_recovered' | 'threshold_changed' | null;
};
export type InventoryAlerts = { thresholds: Threshold[]; alerts: StockAlert[]; nextCursor: string | null; evaluatedAt: number };
export type StockAlertEvent = Snapshot & {
  id: string; alertId: string; version: number; type: 'opened' | 'updated' | 'acknowledged' | 'resolved';
  commandId: string | null; actorId: string | null; at: number; note: string | null;
};
export type ShortageObservation = {
  id: string; orderId: string; ingredientId: string; phase: string; requiredMilli: number;
  availableMilli: number; shortfallMilli: number; commandId: string; at: number;
};
export type InventoryAlertHistory = { events: StockAlertEvent[]; shortages: ShortageObservation[] };
export type ThresholdEvent = {
  commandId: string; ingredientId: string; version: number; previousMilli: number | null; thresholdMilli: number | null;
  reason: string; actorId: string; at: number;
};
export type ThresholdHistory = { events: ThresholdEvent[]; nextBeforeVersion: number | null };

const thresholdValue = (value: unknown): value is number | null => value === null || isSafeInt(value, 0, maxThresholdMilli);
const note = (value: unknown): value is string => isNonblankText(value, maxAlertNote, true);

function snapshot(value: Record<string, unknown>): boolean {
  return isSafeInt(value.onHandMilli) && isSafeInt(value.reservedMilli, 0) && isSafeInt(value.availableMilli) &&
    BigInt(value.onHandMilli) - BigInt(value.reservedMilli) === BigInt(value.availableMilli) && thresholdValue(value.thresholdMilli);
}
export function isThreshold(value: unknown): value is Threshold {
  return exactKeys(value, ['ingredientId', 'thresholdMilli', 'version']) && isId(value.ingredientId) && thresholdValue(value.thresholdMilli) &&
    isSafeInt(value.version, 0) && (value.version !== 0 || value.thresholdMilli === null);
}
export function isThresholdHistory(value: unknown, ingredientId: string, beforeVersion?: number): value is ThresholdHistory {
  if (!exactKeys(value, ['events', 'nextBeforeVersion']) || !Array.isArray(value.events) || value.events.length > 50 ||
      (value.nextBeforeVersion !== null && !isSafeInt(value.nextBeforeVersion, 1))) return false;
  let previousVersion: number | null = beforeVersion ?? null;
  const commands = new Set<string>();
  for (const event of value.events) {
    if (!exactKeys(event, ['commandId', 'ingredientId', 'version', 'previousMilli', 'thresholdMilli', 'reason', 'actorId', 'at']) ||
        !isUuid(event.commandId) || commands.has(event.commandId) || event.ingredientId !== ingredientId ||
        !isSafeInt(event.version, 1) || (previousVersion !== null && event.version >= previousVersion) || !thresholdValue(event.previousMilli) ||
        !thresholdValue(event.thresholdMilli) || !note(event.reason) || !isId(event.actorId) || !isTimestamp(event.at)) return false;
    previousVersion = event.version;
    commands.add(event.commandId);
  }
  return value.nextBeforeVersion === null || (value.events.length === 50 && value.nextBeforeVersion === previousVersion);
}
export function inventoryAlertCommand(path: string, data: Record<string, unknown>) {
  const thresholdRoute = new RegExp(`^/api/v1/inventory/thresholds/(${idRouteSegment})$`).exec(path);
  if (thresholdRoute?.[1] && exactKeys(data, ['expectedVersion', 'thresholdMilli', 'reason']) &&
    isSafeInt(data.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1) && thresholdValue(data.thresholdMilli) && note(data.reason)) {
    return { action: 'inventory.threshold.set', ingredientId: thresholdRoute[1], expectedVersion: data.expectedVersion, thresholdMilli: data.thresholdMilli } as const;
  }
  const alertRoute = /^\/api\/v1\/inventory\/alerts\/([0-9a-f-]+)\/acknowledge$/i.exec(path);
  if (alertRoute?.[1] && isUuid(alertRoute[1]) && exactKeys(data, ['expectedVersion', 'note']) &&
    isSafeInt(data.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) && note(data.note)) {
    return { action: 'inventory.alert.acknowledge', id: alertRoute[1], expectedVersion: data.expectedVersion, note: data.note } as const;
  }
  return null;
}
export function isStockAlert(value: unknown, branchId: string): value is StockAlert {
  if (!exactKeys(value, ['id', 'branchId', 'ingredientId', 'kind', 'status', 'version', 'onHandMilli', 'reservedMilli', 'availableMilli',
    'thresholdMilli', 'openedAt', 'lastEvaluatedAt', 'acknowledgedBy', 'acknowledgedAt', 'acknowledgmentNote', 'resolvedAt', 'resolution']) ||
    !isUuid(value.id) || value.branchId !== branchId || !isId(value.ingredientId) || !isSafeInt(value.version, 1) || !snapshot(value) ||
    !isTimestamp(value.openedAt) || !isTimestamp(value.lastEvaluatedAt) || value.lastEvaluatedAt < value.openedAt ||
    (value.kind !== 'low_stock' && value.kind !== 'shortage') || (value.kind === 'shortage' && value.thresholdMilli !== null)) return false;
  const acknowledgment = isId(value.acknowledgedBy) && isTimestamp(value.acknowledgedAt) && value.acknowledgedAt >= value.openedAt && note(value.acknowledgmentNote);
  const unacknowledged = value.acknowledgedBy === null && value.acknowledgedAt === null && value.acknowledgmentNote === null;
  if (value.status === 'resolved') {
    return (acknowledgment || unacknowledged) && isTimestamp(value.resolvedAt) && value.resolvedAt >= value.openedAt &&
      (value.resolution === 'stock_recovered' || value.resolution === 'threshold_changed');
  }
  if (value.resolvedAt !== null || value.resolution !== null ||
    (value.status === 'open' ? !unacknowledged : value.status !== 'acknowledged' || !acknowledgment)) return false;
  return value.kind === 'low_stock' ? typeof value.thresholdMilli === 'number' && (value.onHandMilli as number) <= value.thresholdMilli : (value.availableMilli as number) < 0;
}
export function isInventoryAlerts(value: unknown, branchId: string, status: 'active' | 'resolved'): value is InventoryAlerts {
  if (!exactKeys(value, ['thresholds', 'alerts', 'nextCursor', 'evaluatedAt']) || !Array.isArray(value.thresholds) || !Array.isArray(value.alerts) ||
    value.alerts.length > 50 || (value.nextCursor !== null && !isUuid(value.nextCursor)) || !isTimestamp(value.evaluatedAt)) return false;
  const ingredients = new Set<string>();
  for (const threshold of value.thresholds) {
    if (!isThreshold(threshold) || ingredients.has(threshold.ingredientId)) return false;
    ingredients.add(threshold.ingredientId);
  }
  const ids = new Set<string>();
  for (const alert of value.alerts) {
    if (!isStockAlert(alert, branchId) || ids.has(alert.id) || (status === 'resolved' ? alert.status !== 'resolved' : alert.status === 'resolved')) return false;
    ids.add(alert.id);
  }
  return true;
}
export function isInventoryAlertHistory(value: unknown, alertId: string): value is InventoryAlertHistory {
  if (!exactKeys(value, ['events', 'shortages']) || !Array.isArray(value.events) || !Array.isArray(value.shortages)) return false;
  const ids = new Set<string>();
  const versions = new Set<number>();
  for (const event of value.events) {
    if (!exactKeys(event, ['id', 'alertId', 'version', 'type', 'commandId', 'actorId', 'at', 'note', 'onHandMilli', 'reservedMilli', 'availableMilli', 'thresholdMilli']) ||
      !isUuid(event.id) || ids.has(event.id) || event.alertId !== alertId || !isSafeInt(event.version, 1) || versions.has(event.version) ||
      !['opened', 'updated', 'acknowledged', 'resolved'].includes(String(event.type)) || !isTimestamp(event.at) || !snapshot(event) ||
      (event.commandId !== null && !isUuid(event.commandId)) || (event.actorId !== null && !isId(event.actorId)) ||
      (event.note !== null && !note(event.note))) return false;
    ids.add(event.id);
    versions.add(event.version);
  }
  const shortageIds = new Set<string>();
  for (const shortage of value.shortages) {
    if (!exactKeys(shortage, ['id', 'orderId', 'ingredientId', 'phase', 'requiredMilli', 'availableMilli', 'shortfallMilli', 'commandId', 'at']) ||
      !isUuid(shortage.id) || shortageIds.has(shortage.id) || !isId(shortage.orderId) || !isId(shortage.ingredientId) ||
      !isNonblankText(shortage.phase, 100, true) ||
      !isSafeInt(shortage.requiredMilli, 1) || !isSafeInt(shortage.availableMilli) || !isSafeInt(shortage.shortfallMilli, 1) ||
      BigInt(shortage.requiredMilli) - BigInt(shortage.availableMilli) !== BigInt(shortage.shortfallMilli) ||
      !isUuid(shortage.commandId) || !isTimestamp(shortage.at)) return false;
    shortageIds.add(shortage.id);
  }
  return true;
}
