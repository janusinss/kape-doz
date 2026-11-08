import { exactKeys, idRouteSegment, isId, isNonblankText, isSafeInt, isUnit, isUuid, type Unit } from './primitives';

export const stockCountsPath = '/api/v1/inventory/counts';
export const maxCountMilli = 1_000_000_000_000;
export const maxCountCostCentavos = 100_000_000_000;
export const maxCountText = 160;

export type StockCount = {
  id: string;
  ingredientId: string;
  unit: Unit;
  status: 'open' | 'submitted' | 'approved' | 'discarded';
  version: number;
  snapshotMilli: number;
  snapshotStockVersion: number;
  liveOnHandMilli: number;
  liveStockVersion: number;
  observedMilli: number | null;
  varianceMilli: number | null;
  reason: string | null;
  costStatus: 'not_required' | 'pending' | 'confirmed';
  totalCostCentavos: number | null;
  costReference: string | null;
  canRevalue: boolean;
  balanceCostCentavos: number | null;
  balanceCostReference: string | null;
};

const isText = (value: unknown): value is string => isNonblankText(value, maxCountText, true);
const isCost = (value: unknown): value is number => isSafeInt(value, 0, maxCountCostCentavos);

export function stockCountCommand(path: string, data: Record<string, unknown>) {
  if (path === stockCountsPath && exactKeys(data, ['ingredientId']) && isId(data.ingredientId)) {
    return { action: 'inventory.count.start', ingredientId: data.ingredientId } as const;
  }
  const route = new RegExp(`^/api/v1/inventory/counts/(${idRouteSegment})/(observe|decide|confirm-cost|revalue)$`).exec(path);
  if (!route?.[1] || !isUuid(route[1]) || !isSafeInt(data.expectedVersion, 1, 1_000_000_000)) return null;
  const { expectedVersion } = data;
  const id = route[1];
  if (route[2] === 'observe' && exactKeys(data, ['expectedVersion', 'unit', 'observedMilli']) &&
      isUnit(data.unit) && isSafeInt(data.observedMilli, 0, maxCountMilli)) {
    return { action: 'inventory.count.observe', id, expectedVersion, unit: data.unit, observedMilli: data.observedMilli } as const;
  }
  if (route[2] === 'decide' && exactKeys(data, ['expectedVersion', 'decision', 'reason']) &&
      (data.decision === 'approve' || data.decision === 'discard') && isText(data.reason)) {
    return { action: 'inventory.count.decide', id, expectedVersion, decision: data.decision, reason: data.reason } as const;
  }
  if (!isCost(data.totalCostCentavos) || !isText(data.reference)) return null;
  const { totalCostCentavos, reference } = data;
  if (route[2] === 'confirm-cost' && exactKeys(data, ['expectedVersion', 'totalCostCentavos', 'reference'])) {
    return { action: 'inventory.count.confirm_cost', id, expectedVersion, totalCostCentavos, reference } as const;
  }
  if (route[2] === 'revalue' && exactKeys(data, ['expectedVersion', 'expectedStockVersion', 'totalCostCentavos', 'reference']) &&
      isSafeInt(data.expectedStockVersion, 1)) {
    return { action: 'inventory.count.revalue', id, expectedVersion, expectedStockVersion: data.expectedStockVersion, totalCostCentavos, reference } as const;
  }
  return null;
}

export function isStockCount(value: unknown): value is StockCount {
  if (!exactKeys(value, [
    'id', 'ingredientId', 'unit', 'status', 'version', 'snapshotMilli', 'snapshotStockVersion', 'liveOnHandMilli', 'liveStockVersion',
    'observedMilli', 'varianceMilli', 'reason', 'costStatus', 'totalCostCentavos', 'costReference', 'canRevalue',
    'balanceCostCentavos', 'balanceCostReference',
  ])) return false;
  const { id, ingredientId, unit, status, version, snapshotMilli, snapshotStockVersion, liveOnHandMilli, liveStockVersion,
    observedMilli, varianceMilli, reason, costStatus, totalCostCentavos, costReference, canRevalue, balanceCostCentavos, balanceCostReference } = value;
  if (!isId(id) || !isUuid(id) || !isId(ingredientId) || !isUnit(unit) || !isSafeInt(version, 1) || !isSafeInt(snapshotMilli) ||
      !isSafeInt(snapshotStockVersion, 0) || !isSafeInt(liveOnHandMilli) || !isSafeInt(liveStockVersion, snapshotStockVersion) ||
      typeof canRevalue !== 'boolean') return false;
  const measured = isSafeInt(observedMilli, 0, maxCountMilli) && isSafeInt(varianceMilli) &&
    BigInt(observedMilli) - BigInt(snapshotMilli) === BigInt(varianceMilli);
  const unmeasured = observedMilli === null && varianceMilli === null;
  switch (status) {
    case 'open': if (!unmeasured || reason !== null) return false; break;
    case 'submitted': if (!measured || reason !== null) return false; break;
    case 'approved': if (!measured || !isText(reason)) return false; break;
    case 'discarded': if ((!measured && !unmeasured) || !isText(reason)) return false; break;
    default: return false;
  }
  const gain = status === 'approved' && typeof varianceMilli === 'number' && varianceMilli > 0;
  if (gain ? costStatus !== 'pending' && costStatus !== 'confirmed' : costStatus !== 'not_required') return false;
  if (costStatus === 'confirmed' ? !isCost(totalCostCentavos) || !isText(costReference) : totalCostCentavos !== null || costReference !== null) return false;
  const hasBalanceCost = balanceCostCentavos !== null || balanceCostReference !== null;
  if (hasBalanceCost && (costStatus !== 'confirmed' || !isCost(balanceCostCentavos) || !isText(balanceCostReference))) return false;
  return !canRevalue || (costStatus === 'confirmed' && liveOnHandMilli > 0 && !hasBalanceCost);
}

export function matchesStockCountCommand(count: StockCount, command: NonNullable<ReturnType<typeof stockCountCommand>>): boolean {
  if (command.action === 'inventory.count.start') return count.ingredientId === command.ingredientId && count.version === 1 && count.status === 'open';
  if (count.id !== command.id || count.version !== command.expectedVersion + 1) return false;
  switch (command.action) {
    case 'inventory.count.observe': return count.status === 'submitted' && count.unit === command.unit && count.observedMilli === command.observedMilli;
    case 'inventory.count.decide': return count.status === (command.decision === 'approve' ? 'approved' : 'discarded') && count.reason === command.reason;
    case 'inventory.count.confirm_cost': return count.costStatus === 'confirmed' && count.totalCostCentavos === command.totalCostCentavos && count.costReference === command.reference;
    case 'inventory.count.revalue': return count.liveStockVersion === command.expectedStockVersion &&
      count.balanceCostCentavos === command.totalCostCentavos && count.balanceCostReference === command.reference;
  }
}
