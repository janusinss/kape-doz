import { parseHubOrigin } from './origin';
import { availabilityCommand, isProduct, recipeUpdateCommand, type ProductOptions } from './product_availability';
import { isStockCount, matchesStockCountCommand, stockCountCommand, stockCountsPath, type StockCount } from './stock_count_contract';
import { inventoryAlertCommand, inventoryAlertsPath, inventoryThresholdsPath, isInventoryAlertHistory, isInventoryAlerts, isStockAlert, isThreshold, isThresholdHistory, type InventoryAlertHistory, type InventoryAlerts, type ThresholdHistory } from './inventory_alert_contract';
import { isRefundLegAction, REFUND_LEG_ACTIONS, resolveCommandAction } from './command_contracts';
import { exactKeys, isAdminRole, isId, isNonblankText, isNonnegativeInt, isPositiveInt, isSafeInt, isTimestamp, isUnit, isUuid, validDatePeriod, validIsoDate, type Unit } from './primitives';

export type Session = { token: string; expiresAt: number; authorityId: string; hubOrigin: string; actor: { id: string; displayName: string; branchId: string; role: 'owner' | 'manager' } };
export type Shift = {
  id: string; drawerId: string; status: 'awaiting_review' | 'recount_required' | 'closed'; version: number;
  openingCashCentavos: number; countedCashCentavos: number; expectedCashCentavos: number;
  varianceCentavos: number; openedAt: number; submittedAt: number; note: string;
};
type ApprovalTerms = {
  id: string; orderId: string; orderNo: number; orderVersion: number;
  amountCentavos: number; subtotalCentavos: number; requesterId: string; requesterName: string;
  reason: string; requestedAt: number; status: 'pending' | 'approved' | 'denied' | 'stale';
  decisionReason: string | null; decidedAt: number | null;
};
export type Approval = ApprovalTerms & ({ action: 'discount' } | {
  action: 'cancel'; requestedKitchenState: 'not_released' | 'queued' | 'preparing' | 'ready';
  requestedPaymentState: 'unpaid' | 'pending_verification' | 'partially_paid' | 'paid';
  collectedCentavos: number; pendingCentavos: number; cancellationStatus: null | 'awaiting_disposition' | 'resolved';
});
export type AmendmentLine = {
  lineNo: number; productId: string; name: string; quantity: number; note: string; unitPriceCentavos: number;
};
export type Amendment = {
  id: string; orderId: string; orderNo: number; orderVersion: number;
  operation: 'add' | 'quantity' | 'remove' | 'replace' | 'note';
  status: 'awaiting_approval' | 'denied' | 'stale' | 'awaiting_station' | 'resolved';
  before: AmendmentLine | null; after: AmendmentLine | null; reason: string; decisionReason: string | null;
  requestedAt: number; appliedAt: number | null; resolvedAt: number | null; needsDisposition: boolean;
  recipe: { ingredientId: string; name: string; unit: Unit; quantityMilli: number }[];
  dispositionNote: string | null; totalBeforeCentavos: number; totalAfterCentavos: number;
};
export type RefundTender = {
  paymentId: string; method: 'cash' | 'gcash' | 'card'; amountCentavos: number;
  reference: string | null; refundableCentavos: number;
};
export type RefundLeg = {
  id: string; paymentId: string; method: RefundTender['method']; amountCentavos: number; version: number;
  status: 'pending' | 'unknown' | 'failed' | 'completed' | 'voided'; reference: string | null;
  note: string | null; completedAt: number | null;
};
export type Refund = {
  id: string; orderId: string; orderNo: number; orderVersion: number; requesterId: string; requesterName: string;
  requestedAt: number; amountCentavos: number; reason: string; status: 'pending' | 'stale' | 'denied' | 'approved';
  decidedAt: number | null; decisionReason: string | null;
  lines: { lineNo: number; name: string; quantity: number; unitPriceCentavos: number }[];
  tenders: RefundTender[]; legs: RefundLeg[];
};
export type Ingredient = { id: string; name: string; unit: Unit; onHandMilli: number; reservedMilli: number };
export type Product = {
  id: string; name: string; priceCentavos: number; version: number;
  available?: boolean; availabilityVersion?: number;
  recipe: { ingredientId: string; quantityMilli: number }[];
  options?: ProductOptions;
};
export type Device = { id: string; branchId: string; version: number; revoked: boolean };
export type DevicePairingBundle = {
  deviceId: string;
  branchId: string;
  accountId?: string | null;
  role?: 'cashier' | 'barista' | null;
  authorityId: string;
  hubOrigin: string | null;
  pairingCode: string;
  expiresAt: number;
  qrPayload: string;
};
export type AccountRecord = {
  id: string; branchId: string; displayName: string;
  role: 'owner' | 'manager' | 'cashier' | 'barista';
  disabled: boolean; version: number;
};
export type BranchConfigResponse = {
  config: {
    branchId: string; version: number;
    receiptHeader: string; receiptFooter: string; taxDisplayNote: string;
    stationVisibleCards: number; offlineAccessExpiryMinutes: number;
    updatedAt: number; updatedBy: string | null;
  };
  history: {
    version: number; receiptHeader: string; receiptFooter: string;
    taxDisplayNote: string; stationVisibleCards: number;
    offlineAccessExpiryMinutes: number; updatedAt: number;
    updatedBy: string | null; commandId: string | null;
  }[];
};
export type PrinterAdapterRecord = {
  type: 'receipt' | 'label';
  mode: 'unconfigured' | 'confirmed' | 'pending' | 'failed' | 'unknown';
  failureReason: string | null;
  updatedAt: number;
  updatedBy: string | null;
};
export type PrintJobRecord = {
  id: string; originalJobId: string; orderId: string; orderNo: number;
  type: 'receipt' | 'label'; status: string; attempts: number;
  simulated: boolean; physicalPaperClaimed: boolean;
  lastError: string | null; updatedAt: number;
};
export type CsvPreviewReport = {
  kind: 'catalog' | 'customers'; duplicatePolicy: 'skip' | 'update';
  fileHash: string;
  summary: {
    totalRows: number; addedCount: number; updatedCount: number;
    skippedCount: number; errorCount: number;
  };
  additions: Record<string, unknown>[]; updates: Record<string, unknown>[];
  skipped: Record<string, unknown>[];
  errors: { rowNumber: number; identifier: string; message: string }[];
  valid: boolean;
};
export type CsvImportRun = {
  id: string; kind: 'catalog' | 'customers'; duplicatePolicy: 'skip' | 'update';
  fileHash: string; addedCount: number; updatedCount: number;
  skippedCount: number; errorCount: number;
  actorId: string; importedAt: number;
};
export type CloudSyncStatus = {
  branchId: string;
  mode: 'online' | 'offline';
  lastSyncedAt: number | null;
  lastSyncedOutboxSequence: number;
  pendingOutboxCount: number;
  acknowledgedOutboxCount: number;
  openConflictCount: number;
  conflicts: {
    id: string; envelopeId: string; entityType: string; entityId: string;
    incomingVersion: number; localVersion: number; reason: string;
    payload: Record<string, unknown>; status: 'open' | 'resolved';
    resolutionNote: string | null; detectedAt: number;
    resolvedAt: number | null; resolvedBy: string | null;
  }[];
};
export type CustomerPolicy = {
  version: number; inactivityDays: number; vipRule: 'unconfigured' | 'lifetime_spend' | 'purchase_count';
  vipThreshold: number | null; vipConfigured: boolean; pointsExpiryDays: number | null;
  updatedBy: string | null; updatedAt: number | null;
};
export type LoyaltyCloudState = {
  loyaltyCloudMode: 'online' | 'offline' | 'timeout';
  lastSyncedAt: number | null; updatedAt: number;
  pendingEntriesCount: number; pendingPointsTotal: number;
};
export type CustomerRecord = {
  id: string; displayName: string; phone: string; notes: string; version: number;
  availablePoints: number; pendingPoints: number; createdAt: number;
  qualifyingPurchaseCount: number; lifetimeNetSpendCentavos: number;
  lastPurchaseDate: string | null; activityStatus: 'active' | 'inactive' | 'no_purchases';
  isVip: boolean;
};
export type CustomerCounters = {
  totalCount: number; activeCount: number; inactiveCount: number; noPurchasesCount: number;
  vipConfigured: boolean; vipCount: number | null;
};
export type CustomerProfile = {
  customer: CustomerRecord;
  ledger: {
    id: string; orderId: string | null; redemptionId: string | null; refundCaseId: string | null;
    kind: string; pointsDelta: number; status: string; eligibleSpendCentavos: number | null;
    createdAt: number; acknowledgedAt: number | null;
  }[];
  orders: {
    orderId: string; orderNo: number; totalCentavos: number; discountCentavos: number;
    redeemedPoints: number; loyaltyRedemptionCentavos: number; earnedPoints: number;
    refundedCentavos: number; acceptedAt: number; settledAt: number | null;
    businessDate: string | null; cancelled: boolean;
  }[];
};
export type LoyaltyRedemption = {
  id: string; orderId: string; orderNo: number; orderVersion: number;
  customerId: string; customerName: string; requestedPoints: number;
  discountCentavos: number; subtotalCentavos: number; reason: string;
  requesterId: string; requesterName: string; requestedAt: number;
  status: string; cloudStatus: string; cloudReference: string | null;
  cloudValidatedAt: number | null; decision: string | null;
  decisionReason: string | null; decidedAt: number | null; version: number;
};
export type LoyaltyRefundCase = {
  id: string; refundId: string; orderId: string; orderNo: number;
  customerId: string; customerName: string;
  customerAvailablePoints: number; customerPendingPoints: number;
  refundAmountCentavos: number; orderSettledCentavos: number;
  originalEarnedPoints: number; originalRedeemedPoints: number;
  priorReversedEarnedPoints: number; priorRestoredRedeemedPoints: number;
  remainingReversibleEarnedPoints: number; remainingRestorableRedeemedPoints: number;
  status: 'pending' | 'insufficient_balance_review' | 'resolved';
  reversedEarnedPoints: number | null; restoredRedeemedPoints: number | null;
  requestedReversalPoints: number | null; reason: string | null;
  resolutionNote: string | null; decidedBy: string | null;
  decidedAt: number | null; version: number; createdAt: number;
};
export type ExpensePeriod = { from: string; through: string };
export type Expense = { id: string; category: string; description: string; amountCentavos: number; allocatedCentavos: number; startsOn: string; endsOn: string; recordedAt: number };
export type DailySale = { businessDate: string; settledOrderCount: number; settledSalesCentavos: number };
export type SalesReport = ExpensePeriod & {
  settledOrderCount: number;
  grossSalesCentavos: number;
  discountCentavos: number;
  settledSalesCentavos: number;
  refundCentavos: number;
  returnedUnsettledCentavos: number;
  netSalesCentavos: number;
  refundsWithUnknownAttribution: number;
  unknownRefundLegs: number;
  dailySales: DailySale[];
  unattributedLegacySettlements: number;
  finalIngredientCostCentavos: number;
  estimatedIngredientCostCentavos: number;
  ordersWithUnknownIngredientCost: number;
  enteredExpensesCentavos: number;
  wasteCostCentavos: number;
  wasteEntriesWithUnknownCost: number;
  stockLossCostCentavos: number;
  stockLossEntriesWithUnknownCost: number;
  cancellationCostCentavos: number;
  cancellationsWithUnresolvedCost: number;
  cancelledOrdersAwaitingDisposition: number;
  cancelledPaymentsAwaitingRefundCentavos: number;
  cancelledPendingPaymentCentavos: number;
  expenseCoverageConfirmed: boolean;
  estimatedGrossProfitCentavos: number | null;
  estimatedGrossMarginBps: number | null;
  estimatedOperatingProfitCentavos: number | null;
};
export type Mutation = { id: string; path: string; data: Record<string, unknown>; label: string; actorId: string; branchId: string };
export type CommandStatus = { commandId: string; status: 'unrecorded' } |
  { commandId: string; status: 'accepted'; action: string; acceptedAt: number } |
  { commandId: string; status: 'rejected'; action: string; rejectedAt: number; error: { code: string; message: string } };

const invalidCommandStatus = () => new HubError('The hub did not confirm the saved command. Check its saved state before retrying.', undefined, true);

export function commandAction(command: Mutation): string {
  const action = resolveCommandAction(command);
  if (!action) throw invalidCommandStatus();
  return action;
}

export function validateCommandStatus(value: unknown, command: Mutation): CommandStatus {
  if (!isUuid(command.id) || !value || typeof value !== 'object' || Array.isArray(value)) throw invalidCommandStatus();
  const status = value as Record<string, unknown>;
  if (status.commandId !== command.id) throw invalidCommandStatus();
  if (status.status === 'unrecorded' && exactKeys(status, ['commandId', 'status'])) return status as CommandStatus;
  const action = commandAction(command);
  if (status.action !== action) throw invalidCommandStatus();
  if (status.status === 'accepted' && exactKeys(status, ['commandId', 'status', 'action', 'acceptedAt']) &&
    isNonnegativeInt(status.acceptedAt)) return status as CommandStatus;
  if (status.status === 'rejected' && exactKeys(status, ['commandId', 'status', 'action', 'rejectedAt', 'error']) &&
    isNonnegativeInt(status.rejectedAt) && exactKeys(status.error, ['code', 'message']) &&
    typeof status.error.code === 'string' && ['invalid_request', 'not_found', 'conflict', 'payload_too_large', 'product_unavailable'].includes(status.error.code) &&
    isNonblankText(status.error.message, 500)) return status as CommandStatus;
  throw invalidCommandStatus();
}

const messages: Record<number, string> = {
  400: 'Check the entered details and try again.',
  401: 'Sign in again to continue.',
  403: 'Your account cannot perform this action.',
  404: 'This record is unavailable. Refresh and check its status.',
  409: 'The record changed or conflicts with existing data. Refresh before trying again.',
  413: 'The request is too large.',
  429: 'Too many requests. Wait before trying again.',
};

export class HubError extends Error {
  constructor(message: string, readonly status?: number, readonly unknown = false) { super(message); }
}

export function validateStockCounts(value: unknown): { counts: StockCount[] } {
  const invalid = () => new HubError('The hub returned invalid stock counts. Refresh to try again.');
  if (!exactKeys(value, ['counts']) || !Array.isArray(value.counts)) throw invalid();
  const counts: StockCount[] = [];
  const ids = new Set<string>();
  for (const count of value.counts) {
    if (!isStockCount(count) || ids.has(count.id)) throw invalid();
    ids.add(count.id);
    counts.push(count);
  }
  return { counts };
}

export function validateInventoryAlerts(value: unknown, branchId: string, status: 'active' | 'resolved'): InventoryAlerts {
  if (!isInventoryAlerts(value, branchId, status)) throw new HubError('The hub returned invalid stock alerts. Refresh to try again.');
  return value;
}

export function validateInventoryAlertHistory(value: unknown, alertId: string): InventoryAlertHistory {
  if (!isInventoryAlertHistory(value, alertId)) throw new HubError('The hub returned invalid stock alert history. Refresh to try again.');
  return value;
}
export function validateThresholdHistory(value: unknown, ingredientId: string, beforeVersion?: number): ThresholdHistory {
  if (!isThresholdHistory(value, ingredientId, beforeVersion)) throw new HubError('The hub returned invalid threshold history. Refresh to try again.');
  return value;
}

const configuredOrigin = import.meta.env?.VITE_HUB_ORIGIN;

const invalidSales = () => new HubError('The hub returned an invalid sales report. Refresh or contact the manager.');
const invalidApprovals = () => new HubError('The hub returned an invalid approval list. Refresh to try again.');
const invalidAmendments = () => new HubError('The hub returned invalid sent item changes. Refresh to try again.');
const invalidRefunds = () => new HubError('The hub returned invalid refund details. Refresh to try again.');

export function validateApprovals(value: unknown): { approvals: Approval[] } {
  const entries = (value as { approvals?: unknown } | null)?.approvals;
  if (!Array.isArray(entries)) throw invalidApprovals();
  const identifiers = new Set<string>();
  const approvals = entries.map((entry: unknown): Approval => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalidApprovals();
    const { id, orderId, orderNo, orderVersion, action, amountCentavos, subtotalCentavos, requesterId,
      requesterName, reason, requestedAt, status, decisionReason, decidedAt } = entry as Record<string, unknown>;
    if (!isId(id) || identifiers.has(id) || !isId(orderId) || !isId(requesterId) ||
      !isPositiveInt(orderNo) || !isPositiveInt(orderVersion) || (action !== 'discount' && action !== 'cancel') ||
      !isPositiveInt(amountCentavos) || !isPositiveInt(subtotalCentavos) || amountCentavos > subtotalCentavos ||
      !isNonblankText(requesterName, 100) || !isNonblankText(reason, 300) || !isTimestamp(requestedAt)) throw invalidApprovals();
    if (status !== 'pending' && status !== 'approved' && status !== 'denied' && status !== 'stale') throw invalidApprovals();
    if (decisionReason !== null && !isNonblankText(decisionReason, 300)) throw invalidApprovals();
    if (decidedAt !== null && !isTimestamp(decidedAt)) throw invalidApprovals();
    if ((status === 'pending' && (decidedAt !== null || decisionReason !== null)) ||
      ((status === 'approved' || status === 'denied') && decidedAt === null) ||
      (status === 'denied' && decisionReason === null)) throw invalidApprovals();
    identifiers.add(id);
    const terms: ApprovalTerms = { id, orderId, orderNo, orderVersion, amountCentavos, subtotalCentavos, requesterId,
      requesterName, reason, requestedAt, status, decisionReason, decidedAt };
    if (action === 'discount') {
      if (amountCentavos >= subtotalCentavos) throw invalidApprovals();
      return { ...terms, action };
    }
    const { requestedKitchenState, requestedPaymentState, collectedCentavos, pendingCentavos, cancellationStatus } = entry as Record<string, unknown>;
    if (requestedKitchenState !== 'not_released' && requestedKitchenState !== 'queued' && requestedKitchenState !== 'preparing' && requestedKitchenState !== 'ready') throw invalidApprovals();
    if (requestedPaymentState !== 'unpaid' && requestedPaymentState !== 'pending_verification' && requestedPaymentState !== 'partially_paid' && requestedPaymentState !== 'paid') throw invalidApprovals();
    if (!isNonnegativeInt(collectedCentavos) || collectedCentavos > amountCentavos || !isNonnegativeInt(pendingCentavos) ||
      (cancellationStatus !== null && cancellationStatus !== 'awaiting_disposition' && cancellationStatus !== 'resolved') ||
      (status === 'approved' && cancellationStatus === null)) throw invalidApprovals();
    return { ...terms, action, requestedKitchenState, requestedPaymentState, collectedCentavos, pendingCentavos, cancellationStatus };
  });
  return { approvals };
}

function amendmentLine(value: unknown): AmendmentLine | null {
  if (value === null) return null;
  if (!exactKeys(value, ['lineNo', 'productId', 'name', 'quantity', 'note', 'unitPriceCentavos']) ||
    !isNonnegativeInt(value.lineNo) || !isId(value.productId) ||
    !isNonblankText(value.name, 120) || !isPositiveInt(value.quantity, 99) ||
    typeof value.note !== 'string' || value.note.length > 300 || !isPositiveInt(value.unitPriceCentavos, 100_000_000_000)) throw invalidAmendments();
  return value as AmendmentLine;
}

function validAmendmentChange(operation: Amendment['operation'], before: AmendmentLine | null, after: AmendmentLine | null): boolean {
  if (operation === 'add') return before === null && after !== null;
  if (operation === 'remove') return before !== null && after === null;
  if (!before || !after) return false;
  if (operation === 'replace') return before.lineNo !== after.lineNo;
  if (before.lineNo !== after.lineNo || before.productId !== after.productId || before.name !== after.name ||
    before.unitPriceCentavos !== after.unitPriceCentavos) return false;
  return operation === 'quantity'
    ? before.quantity !== after.quantity && before.note === after.note
    : before.quantity === after.quantity && before.note !== after.note;
}

export function validateAmendments(value: unknown): { amendments: Amendment[] } {
  if (!exactKeys(value, ['amendments']) || !Array.isArray(value.amendments)) throw invalidAmendments();
  const ids = new Set<string>();
  const amendments = value.amendments.map((entry: unknown): Amendment => {
    if (!exactKeys(entry, ['id', 'orderId', 'orderNo', 'orderVersion', 'operation', 'status', 'before', 'after', 'reason', 'decisionReason',
      'requestedAt', 'appliedAt', 'resolvedAt', 'needsDisposition', 'recipe', 'dispositionNote', 'totalBeforeCentavos', 'totalAfterCentavos'])) throw invalidAmendments();
    const { id, orderId, orderNo, orderVersion, operation, status, reason, decisionReason,
      requestedAt, appliedAt, resolvedAt, needsDisposition, recipe, dispositionNote, totalBeforeCentavos, totalAfterCentavos } = entry;
    if (!isId(id) || ids.has(id) || !isId(orderId) ||
      !isPositiveInt(orderNo) || !isPositiveInt(orderVersion) ||
      (operation !== 'add' && operation !== 'quantity' && operation !== 'remove' && operation !== 'replace' && operation !== 'note') ||
      (status !== 'awaiting_approval' && status !== 'denied' && status !== 'stale' && status !== 'awaiting_station' && status !== 'resolved') ||
      !isNonblankText(reason, 300) || (decisionReason !== null && !isNonblankText(decisionReason, 300)) ||
      (dispositionNote !== null && !isNonblankText(dispositionNote, 300)) || !isTimestamp(requestedAt) ||
      typeof needsDisposition !== 'boolean' || !Array.isArray(recipe) || recipe.length > 50 || needsDisposition !== (recipe.length > 0) ||
      !isPositiveInt(totalBeforeCentavos, 100_000_000_000) || !isPositiveInt(totalAfterCentavos, 100_000_000_000)) throw invalidAmendments();
    if (appliedAt !== null && (!isTimestamp(appliedAt) || appliedAt < requestedAt)) throw invalidAmendments();
    if (resolvedAt !== null && (!isTimestamp(resolvedAt) || appliedAt === null || resolvedAt < appliedAt)) throw invalidAmendments();
    if ((status === 'resolved' && resolvedAt === null) || (status === 'awaiting_station' && resolvedAt !== null) ||
      (status === 'awaiting_approval' && decisionReason !== null) || (status === 'denied' && decisionReason === null) ||
      ((status === 'awaiting_approval' || status === 'denied') && (appliedAt !== null || resolvedAt !== null || dispositionNote !== null))) throw invalidAmendments();
    const before = amendmentLine(entry.before);
    const after = amendmentLine(entry.after);
    const valueOf = (line: AmendmentLine | null) => line ? line.quantity * line.unitPriceCentavos : 0;
    if (!validAmendmentChange(operation, before, after) || totalAfterCentavos - totalBeforeCentavos !== valueOf(after) - valueOf(before)) throw invalidAmendments();
    const ingredientIds = new Set<string>();
    for (const ingredient of recipe) {
      if (!exactKeys(ingredient, ['ingredientId', 'name', 'unit', 'quantityMilli']) ||
        !isId(ingredient.ingredientId) || ingredientIds.has(ingredient.ingredientId) || !isNonblankText(ingredient.name, 120) ||
        !isUnit(ingredient.unit) || !isPositiveInt(ingredient.quantityMilli)) throw invalidAmendments();
      ingredientIds.add(ingredient.ingredientId);
    }
    ids.add(id);
    return entry as Amendment;
  });
  return { amendments };
}

function refundObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidRefunds();
  return value as Record<string, unknown>;
}

function refundIdentifier(value: unknown): string {
  if (!isId(value)) throw invalidRefunds();
  return value;
}

function refundMethod(value: unknown): RefundTender['method'] {
  if (value !== 'cash' && value !== 'gcash' && value !== 'card') throw invalidRefunds();
  return value;
}

function nullableRefundText(value: unknown, limit: number): string | null {
  if (value !== null && !isNonblankText(value, limit)) throw invalidRefunds();
  return value;
}

export function validateRefunds(value: unknown): { refunds: Refund[] } {
  const entries = refundObject(value).refunds;
  if (!Array.isArray(entries)) throw invalidRefunds();
  const ids = new Set<string>();
  const refunds = entries.map((entry: unknown): Refund => {
    const row = refundObject(entry);
    const id = refundIdentifier(row.id), orderId = refundIdentifier(row.orderId), requesterId = refundIdentifier(row.requesterId);
    const { orderNo, orderVersion, requesterName, requestedAt, amountCentavos, reason, status, decidedAt } = row;
    const decisionReason = nullableRefundText(row.decisionReason, 300);
    if (ids.has(id) || !isPositiveInt(orderNo) || !isPositiveInt(orderVersion) || !isNonblankText(requesterName, 100) ||
      !isTimestamp(requestedAt) || !isPositiveInt(amountCentavos) || !isNonblankText(reason, 300) ||
      (decidedAt !== null && !isTimestamp(decidedAt)) || !Array.isArray(row.lines) || row.lines.length === 0 ||
      !Array.isArray(row.tenders) || row.tenders.length === 0 || !Array.isArray(row.legs)) throw invalidRefunds();
    if (status !== 'pending' && status !== 'stale' && status !== 'denied' && status !== 'approved') throw invalidRefunds();
    if (((status === 'pending' || status === 'stale') && (decidedAt !== null || decisionReason !== null)) ||
      ((status === 'approved' || status === 'denied') && decidedAt === null) || (status === 'denied' && decisionReason === null)) throw invalidRefunds();
    const lineNumbers = new Set<number>();
    const lines = row.lines.map((item: unknown) => {
      const { lineNo, name, quantity, unitPriceCentavos } = refundObject(item);
      if (!isNonnegativeInt(lineNo) || lineNumbers.has(lineNo) || !isNonblankText(name, 120) || !isPositiveInt(quantity) || !isPositiveInt(unitPriceCentavos)) throw invalidRefunds();
      lineNumbers.add(lineNo);
      return { lineNo, name, quantity, unitPriceCentavos };
    });
    const paymentIds = new Set<string>();
    const tenders = row.tenders.map((item: unknown): RefundTender => {
      const tender = refundObject(item), paymentId = refundIdentifier(tender.paymentId), method = refundMethod(tender.method);
      const { amountCentavos: paid, refundableCentavos } = tender;
      const reference = nullableRefundText(tender.reference, 120);
      if (paymentIds.has(paymentId) || !isPositiveInt(paid) || !isNonnegativeInt(refundableCentavos) || refundableCentavos > paid) throw invalidRefunds();
      paymentIds.add(paymentId);
      return { paymentId, method, amountCentavos: paid, refundableCentavos, reference };
    });
    const legIds = new Set<string>(), legPayments = new Set<string>();
    const legs = row.legs.map((item: unknown): RefundLeg => {
      const leg = refundObject(item), legId = refundIdentifier(leg.id), paymentId = refundIdentifier(leg.paymentId), method = refundMethod(leg.method);
      const { amountCentavos: allocated, version, status: legStatus, completedAt } = leg;
      const reference = nullableRefundText(leg.reference, 120), note = nullableRefundText(leg.note, 300);
      const original = tenders.find(tender => tender.paymentId === paymentId);
      if (legIds.has(legId) || legPayments.has(paymentId) || !original || method !== original.method ||
        !isPositiveInt(allocated) || allocated > original.amountCentavos || !isPositiveInt(version) ||
        (completedAt !== null && !isTimestamp(completedAt))) throw invalidRefunds();
      if (legStatus !== 'pending' && legStatus !== 'unknown' && legStatus !== 'failed' && legStatus !== 'completed' && legStatus !== 'voided') throw invalidRefunds();
      if ((legStatus === 'completed') !== (completedAt !== null) ||
        (legStatus === 'completed' && method !== 'cash' && reference === null) ||
        (reference !== null && (method === 'cash' || legStatus !== 'completed')) ||
        (method === 'cash' && (legStatus === 'unknown' || legStatus === 'failed')) ||
        (legStatus !== 'pending' && !(legStatus === 'completed' && method === 'cash') && note === null)) throw invalidRefunds();
      legIds.add(legId); legPayments.add(paymentId);
      return { id: legId, paymentId, method, amountCentavos: allocated, version, status: legStatus, reference, note, completedAt };
    });
    const allocated = legs.reduce((sum, leg) => sum + BigInt(leg.amountCentavos), 0n);
    if ((status === 'approved' && allocated !== BigInt(amountCentavos)) || (status !== 'approved' && legs.length > 0)) throw invalidRefunds();
    ids.add(id);
    return { id, orderId, orderNo, orderVersion, requesterId, requesterName, requestedAt, amountCentavos, reason,
      status, decidedAt, decisionReason, lines, tenders, legs };
  });
  return { refunds };
}

function reportObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidSales();
  return value as Record<string, unknown>;
}

function safeReportInteger(value: unknown, nonnegative = true): number {
  if (!isSafeInt(value, nonnegative ? 0 : Number.MIN_SAFE_INTEGER)) throw invalidSales();
  return value;
}

/** Reject malformed or mismatched reports before any financial figure renders. */
export function validateSalesReport(value: unknown, period: ExpensePeriod): SalesReport {
  const report = reportObject(value);
  if (!validDatePeriod(report.from, report.through, true) ||
    report.from !== period.from || report.through !== period.through) throw invalidSales();

  const settledOrderCount = safeReportInteger(report.settledOrderCount);
  const settledSales = safeReportInteger(report.settledSalesCentavos);
  const refunds = safeReportInteger(report.refundCentavos);
  safeReportInteger(report.returnedUnsettledCentavos);
  const netSales = safeReportInteger(report.netSalesCentavos, false);
  const unknownRefundAttribution = safeReportInteger(report.refundsWithUnknownAttribution);
  const unknownRefundLegs = safeReportInteger(report.unknownRefundLegs);
  if (BigInt(netSales) !== BigInt(settledSales) - BigInt(refunds)) throw invalidSales();
  const grossSales = safeReportInteger(report.grossSalesCentavos);
  const discounts = safeReportInteger(report.discountCentavos);
  if (grossSales - discounts !== settledSales || (settledOrderCount === 0 && grossSales !== 0)) throw invalidSales();
  const finalCost = safeReportInteger(report.finalIngredientCostCentavos);
  const estimatedCost = safeReportInteger(report.estimatedIngredientCostCentavos);
  const expenses = safeReportInteger(report.enteredExpensesCentavos);
  const wasteCost = safeReportInteger(report.wasteCostCentavos);
  const unknownWaste = safeReportInteger(report.wasteEntriesWithUnknownCost);
  const stockLossCost = safeReportInteger(report.stockLossCostCentavos);
  const unknownStockLoss = safeReportInteger(report.stockLossEntriesWithUnknownCost);
  const cancellationCost = safeReportInteger(report.cancellationCostCentavos);
  const unknownCancellationCost = safeReportInteger(report.cancellationsWithUnresolvedCost);
  const pendingDisposition = safeReportInteger(report.cancelledOrdersAwaitingDisposition);
  const cancelledCollected = safeReportInteger(report.cancelledPaymentsAwaitingRefundCentavos);
  const cancelledPending = safeReportInteger(report.cancelledPendingPaymentCentavos);
  const unknownCosts = safeReportInteger(report.ordersWithUnknownIngredientCost);
  const legacySettlements = safeReportInteger(report.unattributedLegacySettlements);
  if (unknownCosts > settledOrderCount || typeof report.expenseCoverageConfirmed !== 'boolean') throw invalidSales();

  for (const key of ['estimatedGrossProfitCentavos', 'estimatedGrossMarginBps', 'estimatedOperatingProfitCentavos']) {
    if (report[key] !== null) safeReportInteger(report[key], false);
  }
  if (!Array.isArray(report.dailySales)) throw invalidSales();
  let dailyCount = 0n;
  let dailySales = 0n;
  let previousDay = '';
  for (const entry of report.dailySales) {
    const day = reportObject(entry);
    if (!validIsoDate(day.businessDate, true) || day.businessDate < (report.from as string) || day.businessDate > (report.through as string) || day.businessDate <= previousDay) throw invalidSales();
    const count = safeReportInteger(day.settledOrderCount);
    const sales = safeReportInteger(day.settledSalesCentavos);
    if (count === 0 || sales === 0) throw invalidSales();
    dailyCount += BigInt(count);
    dailySales += BigInt(sales);
    previousDay = day.businessDate;
  }
  if (dailyCount !== BigInt(settledOrderCount) || dailySales !== BigInt(settledSales)) throw invalidSales();

  if (unknownCosts > 0 || legacySettlements > 0 || unknownRefundAttribution > 0 || unknownRefundLegs > 0 ||
    unknownCancellationCost > 0 || pendingDisposition > 0 || cancelledCollected > 0 || cancelledPending > 0) {
    if (report.estimatedGrossProfitCentavos !== null || report.estimatedGrossMarginBps !== null || report.estimatedOperatingProfitCentavos !== null) throw invalidSales();
  } else {
    const gross = BigInt(netSales) - BigInt(finalCost) - BigInt(estimatedCost);
    if (report.estimatedGrossProfitCentavos === null || BigInt(report.estimatedGrossProfitCentavos as number) !== gross) throw invalidSales();
    if (netSales <= 0) {
      if (report.estimatedGrossMarginBps !== null) throw invalidSales();
    } else if (report.estimatedGrossMarginBps === null || BigInt(report.estimatedGrossMarginBps as number) !== gross * 10_000n / BigInt(netSales)) throw invalidSales();
    if (report.expenseCoverageConfirmed && unknownWaste === 0 && unknownStockLoss === 0) {
      if (report.estimatedOperatingProfitCentavos === null || BigInt(report.estimatedOperatingProfitCentavos as number) !== gross - BigInt(expenses) - BigInt(wasteCost) - BigInt(cancellationCost) - BigInt(stockLossCost)) throw invalidSales();
    } else if (report.estimatedOperatingProfitCentavos !== null) throw invalidSales();
  }
  return report as unknown as SalesReport;
}

function configuredHubOrigin(): string {
  let portalOrigin: string;
  try { portalOrigin = parseHubOrigin(window.location.origin); }
  catch { throw new HubError('Open the portal on HTTPS or localhost.'); }
  let origin: string;
  try { origin = configuredOrigin ? parseHubOrigin(configuredOrigin) : portalOrigin; }
  catch { throw new HubError('The hub address is invalid. Check the portal configuration.'); }
  return origin;
}

function sessionOrigin(session: Session): string {
  try {
    const origin = parseHubOrigin(session.hubOrigin);
    if (origin !== session.hubOrigin || !isUuid(session.authorityId) ||
      !isId(session.actor.id) || !isId(session.actor.branchId) ||
      !isAdminRole(session.actor.role)) throw new Error();
    return origin;
  } catch { throw new HubError('Sign in again to confirm the connected hub.'); }
}

function requireCommandScope(session: Session, command: Mutation): void {
  const scoped = command as Mutation & { hubOrigin?: unknown; authorityId?: unknown; role?: unknown };
  if (scoped.hubOrigin !== undefined || scoped.authorityId !== undefined || scoped.role !== undefined) {
    if (scoped.hubOrigin !== session.hubOrigin || scoped.authorityId !== session.authorityId ||
      scoped.role !== session.actor.role || command.actorId !== session.actor.id || command.branchId !== session.actor.branchId) {
      throw new HubError('Sign in with the original account and hub to confirm the saved command.');
    }
  }
}

async function request<T>(path: string, authentication?: Session | string, data?: Record<string, unknown>, isMutation = false, originOverride?: string): Promise<T> {
  const bound = typeof authentication === 'object' ? authentication : undefined;
  const origin = bound ? sessionOrigin(bound) : originOverride ?? configuredHubOrigin();
  const token = typeof authentication === 'string' ? authentication : bound?.token;
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(bound ? { 'X-Kape-Doz-Authority': bound.authorityId } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new HubError('The hub response could not be confirmed. Check the connection.', undefined, isMutation); }
  if (!response.ok) throw new HubError(messages[response.status] ?? 'The hub could not complete the request.', response.status, isMutation && response.status >= 500);
  if (response.status === 204) return undefined as T;
  try {
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as T;
  } catch { throw new HubError('The hub returned an unreadable response.', undefined, isMutation); }
}

export async function login(accountId: string, password: string): Promise<Session> {
  const hubOrigin = configuredHubOrigin();
  const session = await request<Omit<Session, 'authorityId' | 'hubOrigin'>>('/api/v1/auth/admin', undefined, { accountId, password }, false, hubOrigin);
  if (typeof session.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session.token) ||
    !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now() ||
    !session.actor || !isAdminRole(session.actor.role) ||
    !isId(session.actor.id) || typeof session.actor.displayName !== 'string' ||
    !isId(session.actor.branchId)) {
    throw new HubError('The hub returned an invalid admin session.');
  }
  const authority = await request<unknown>('/api/v1/authority', session.token, undefined, false, hubOrigin);
  if (!exactKeys(authority, ['authorityId', 'branchId']) || !isUuid(authority.authorityId) ||
    authority.branchId !== session.actor.branchId) {
    throw new HubError('The hub identity could not be confirmed. Sign in again or contact the manager.');
  }
  return { ...session, authorityId: authority.authorityId, hubOrigin };
}

export const api = {
  logout: (session: Session) => request<void>('/api/v1/auth/logout', session, {}),
  commandStatus: async (session: Session, command: Mutation) => {
    if (!isUuid(command.id)) throw invalidCommandStatus();
    commandAction(command);
    requireCommandScope(session, command);
    return validateCommandStatus(await request<unknown>('/api/v1/commands/' + encodeURIComponent(command.id), session), command);
  },
  shifts: (session: Session) => request<{ shifts: Shift[]; truncated: boolean }>('/api/v1/admin/shifts', session),
  approvals: async (session: Session) => validateApprovals(await request<unknown>('/api/v1/approvals', session)),
  amendments: async (session: Session) => validateAmendments(await request<unknown>('/api/v1/amendments', session)),
  refunds: async (session: Session) => validateRefunds(await request<unknown>('/api/v1/refunds', session)),
  ingredients: (session: Session) => request<{ ingredients: Ingredient[] }>('/api/v1/ingredients', session),
  stockCounts: async (session: Session) => validateStockCounts(await request<unknown>(stockCountsPath, session)),
  inventoryAlerts: async (session: Session, status: 'active' | 'resolved' = 'active', before?: string) => {
    if (before !== undefined && !isUuid(before)) throw new HubError('The stock alert page is invalid. Refresh to try again.');
    const query = new URLSearchParams({ status, ...(before ? { before } : {}) });
    return validateInventoryAlerts(await request<unknown>(`${inventoryAlertsPath}?${query}`, session), session.actor.branchId, status);
  },
  inventoryAlertHistory: async (session: Session, alertId: string) => {
    if (!isUuid(alertId)) throw new HubError('The stock alert is invalid. Refresh to try again.');
    return validateInventoryAlertHistory(await request<unknown>(`${inventoryAlertsPath}/${alertId}/history`, session), alertId);
  },
  inventoryThresholdHistory: async (session: Session, ingredientId: string, beforeVersion?: number) => {
    if (!isId(ingredientId) || (beforeVersion !== undefined && !isPositiveInt(beforeVersion))) {
      throw new HubError('The threshold history page is invalid. Refresh to try again.');
    }
    const query = beforeVersion === undefined ? '' : `?${new URLSearchParams({ beforeVersion: String(beforeVersion) })}`;
    return validateThresholdHistory(await request<unknown>(`${inventoryThresholdsPath}/${ingredientId}/history${query}`, session), ingredientId, beforeVersion);
  },
  products: (session: Session) => request<{ products: Product[] }>('/api/v1/products', session),
  devices: (session: Session) => request<{ devices: Device[] }>('/api/v1/devices', session),
  deviceEnroll: (session: Session, deviceId: string, secret: string) =>
    request<{ commandId: string; device: Device }>(
      '/api/v1/devices',
      session,
      { commandId: globalThis.crypto.randomUUID(), deviceId, secret },
      true,
    ),
  devicePairCode: (session: Session, deviceId: string, hubOrigin?: string, ttlMinutes = 15, role?: 'cashier' | 'barista', accountId?: string) =>
    request<{ commandId: string; pairing: DevicePairingBundle }>(
      `/api/v1/devices/${encodeURIComponent(deviceId)}/pair`,
      session,
      {
        commandId: globalThis.crypto.randomUUID(),
        ...(hubOrigin ? { hubOrigin } : {}),
        ...(role ? { role } : {}),
        ...(accountId ? { accountId } : {}),
        ttlMinutes,
      },
      true,
    ),
  accounts: (session: Session) => request<{ accounts: AccountRecord[] }>('/api/v1/accounts', session),
  accountCreate: (session: Session, input: { accountId: string; displayName: string; role: AccountRecord['role']; secret: string }) =>
    request<{ commandId: string; account: AccountRecord }>(
      '/api/v1/accounts',
      session,
      { commandId: globalThis.crypto.randomUUID(), ...input },
      true,
    ),
  branchConfig: (session: Session) => request<BranchConfigResponse>('/api/v1/settings/config', session),
  printers: (session: Session) => request<{ adapters: PrinterAdapterRecord[] }>('/api/v1/printers', session),
  printJobs: (session: Session) => request<{ jobs: PrintJobRecord[] }>('/api/v1/print-jobs', session),
  csvPreview: (session: Session, input: { kind: 'catalog' | 'customers'; csvText: string; duplicatePolicy: 'skip' | 'update' }) =>
    request<{ preview: CsvPreviewReport }>('/api/v1/csv/preview', session, input),
  csvImports: (session: Session) => request<{ imports: CsvImportRun[] }>('/api/v1/csv/imports', session),
  csvExport: (session: Session, kind: 'catalog' | 'customers' | 'financial') =>
    request<{ kind: string; csvText: string }>(`/api/v1/csv/export?kind=${encodeURIComponent(kind)}`, session),
  syncStatus: (session: Session) => request<{ syncStatus: CloudSyncStatus }>('/api/v1/sync/status', session),
  backupExport: (session: Session) => request<{ backup: Record<string, unknown> }>('/api/v1/admin/backup', session),
  backupRestore: (session: Session, backup: Record<string, unknown>) =>
    request<{ commandId: string; restored: Record<string, unknown> }>(
      '/api/v1/admin/restore',
      session,
      { commandId: globalThis.crypto.randomUUID(), backup },
      true,
    ),
  customers: (session: Session, query?: { q?: string; segment?: string }) => {
    const params = new URLSearchParams();
    if (query?.q) params.set('q', query.q);
    if (query?.segment && query.segment !== 'all') params.set('segment', query.segment);
    const qs = params.toString();
    return request<{ customers: CustomerRecord[]; counters: CustomerCounters; policy: CustomerPolicy; cloudState: LoyaltyCloudState }>(
      `/api/v1/customers${qs ? `?${qs}` : ''}`, session,
    );
  },
  customerProfile: (session: Session, id: string) => request<CustomerProfile>(`/api/v1/customers/${encodeURIComponent(id)}`, session),
  loyaltyRedemptions: (session: Session) => request<{ redemptions: LoyaltyRedemption[] }>('/api/v1/loyalty/redemptions', session),
  loyaltyRefundCases: (session: Session) => request<{ cases: LoyaltyRefundCase[] }>('/api/v1/loyalty/refund-cases', session),
  expenses: (session: Session, period: ExpensePeriod) => request<ExpensePeriod & { expenses: Expense[]; allocatedCentavos: number; truncated: boolean }>(
    `/api/v1/admin/expenses?${new URLSearchParams(period)}`, session,
  ),
  sales: async (session: Session, period: ExpensePeriod) => validateSalesReport(
    await request<unknown>(`/api/v1/admin/sales?${new URLSearchParams(period)}`, session), period,
  ),
  mutate: async (session: Session, command: Mutation) => {
    requireCommandScope(session, command);
    const countCommand = stockCountCommand(command.path, command.data);
    if (command.path.startsWith(stockCountsPath) && !countCommand) throw new HubError('The saved stock count action is invalid.');
    const alertCommand = inventoryAlertCommand(command.path, command.data);
    if ((command.path.startsWith(inventoryAlertsPath) || command.path.startsWith(inventoryThresholdsPath)) && !alertCommand) throw new HubError('The saved inventory alert action is invalid.');
    const availability = availabilityCommand(command.path, command.data);
    const recipeUpdate = recipeUpdateCommand(command.path, command.data);
    const result = await request<{ commandId?: string; approval?: unknown; refund?: unknown; amendment?: unknown; count?: unknown; threshold?: unknown; alert?: unknown; product?: unknown }>(command.path, session, { commandId: command.id, ...command.data }, true);
    if (result?.commandId !== command.id) throw new HubError('The hub did not confirm this command.', undefined, true);
    if (availability && (!exactKeys(result, ['commandId', 'product']) || !isProduct(result.product, true) ||
      result.product.id !== availability.id || result.product.availabilityVersion !== availability.expectedVersion + 1 ||
      result.product.available !== availability.available)) {
      throw new HubError('The hub did not confirm this availability change. Check its saved state before retrying.', undefined, true);
    }
    if (recipeUpdate && (!exactKeys(result, ['commandId', 'product']) || !isProduct(result.product) ||
      result.product.id !== recipeUpdate.id || result.product.version !== recipeUpdate.expectedVersion + 1)) {
      throw new HubError('The hub did not confirm this recipe update. Check its saved state before retrying.', undefined, true);
    }
    if (countCommand && (!exactKeys(result, ['commandId', 'count']) || !isStockCount(result.count) ||
      !matchesStockCountCommand(result.count, countCommand))) {
      throw new HubError('The hub did not confirm this stock count action. Check its saved state before retrying.', undefined, true);
    }
    if (alertCommand?.action === 'inventory.threshold.set' && (!exactKeys(result, ['commandId', 'threshold']) || !isThreshold(result.threshold) ||
      result.threshold.ingredientId !== alertCommand.ingredientId || result.threshold.version !== alertCommand.expectedVersion + 1 ||
      result.threshold.thresholdMilli !== alertCommand.thresholdMilli)) {
      throw new HubError('The hub did not confirm this threshold change. Check its saved state before retrying.', undefined, true);
    }
    if (alertCommand?.action === 'inventory.alert.acknowledge' && (!exactKeys(result, ['commandId', 'alert']) || !isStockAlert(result.alert, session.actor.branchId) ||
      result.alert.id !== alertCommand.id || result.alert.version !== alertCommand.expectedVersion + 1 || result.alert.status !== 'acknowledged' ||
      result.alert.acknowledgedBy !== session.actor.id || result.alert.acknowledgmentNote !== alertCommand.note)) {
      throw new HubError('The hub did not confirm this stock alert acknowledgment. Check its saved state before retrying.', undefined, true);
    }
    const approvalDecision = /^\/api\/v1\/approvals\/([A-Za-z0-9_-]+)\/decision$/.exec(command.path);
    if (approvalDecision) {
      let approval: Approval | undefined;
      try { approval = validateApprovals({ approvals: [result.approval] }).approvals[0]; }
      catch { throw new HubError('The hub did not confirm this approval decision.', undefined, true); }
      const expectedStatus = command.data.decision === 'approve' ? 'approved' : command.data.decision === 'deny' ? 'denied' : null;
      if (approval?.id !== approvalDecision[1] || approval?.status !== expectedStatus) {
        throw new HubError('The hub did not confirm this approval decision.', undefined, true);
      }
    }
    const amendmentDecision = /^\/api\/v1\/amendments\/([A-Za-z0-9_-]+)\/decision$/.exec(command.path);
    if (amendmentDecision) {
      try {
        if (!exactKeys(result, ['commandId', 'amendment'])) throw invalidAmendments();
        const amendment = validateAmendments({ amendments: [result.amendment] }).amendments[0];
        const expected = command.data.decision === 'approve' ? 'awaiting_station' : command.data.decision === 'deny' ? 'denied' : null;
        if (!expected || !amendment || amendment.id !== amendmentDecision[1] || amendment.status !== expected || amendment.decisionReason !== command.data.reason) throw invalidAmendments();
      } catch { throw new HubError('The hub did not confirm this sent item decision.', undefined, true); }
    }
    const refundRoute = /^\/api\/v1\/refunds\/([A-Za-z0-9_-]+)\/(decision|legs\/([A-Za-z0-9_-]+))$/.exec(command.path);
    if (refundRoute) {
      try {
        const refund = validateRefunds({ refunds: [result.refund] }).refunds[0];
        if (!refund || refund.id !== refundRoute[1]) throw invalidRefunds();
        if (refundRoute[2] === 'decision') {
          const expected = command.data.decision === 'approve' ? 'approved' : command.data.decision === 'deny' ? 'denied' : null;
          if (refund.status !== expected) throw invalidRefunds();
          if (expected === 'approved') {
            const allocations = command.data.allocations;
            if (!Array.isArray(allocations) || allocations.length !== refund.legs.length ||
              !allocations.every((item: unknown) => {
                const allocation = refundObject(item);
                return refund.legs.some(leg => leg.paymentId === allocation.paymentId && leg.amountCentavos === allocation.amountCentavos);
              })) throw invalidRefunds();
          }
        } else {
          const leg = refund.legs.find(item => item.id === refundRoute[3]);
          const action = command.data.action;
          const expected = isRefundLegAction(action) ? REFUND_LEG_ACTIONS[action].nextStatus : undefined;
          if (!leg || !expected || leg.status !== expected || leg.version !== Number(command.data.expectedVersion) + 1 ||
            leg.note !== command.data.note || (action === 'confirm_external' && leg.reference !== command.data.reference)) throw invalidRefunds();
        }
      } catch { throw new HubError('The hub did not confirm this refund action.', undefined, true); }
    }
  },
};

/** Refresh the authoritative records affected by the saved command before unlock. */
export async function refreshCommand(session: Session, command: Mutation): Promise<void> {
  const action = commandAction(command);
  const invalid = () => new HubError('Current records could not be refreshed. Keep the saved command and retry.');
  const list = (value: unknown, key: string): Record<string, unknown>[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const entries = (value as Record<string, unknown>)[key];
    if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw invalid();
    return entries as Record<string, unknown>[];
  };
  const countAction = action.startsWith('inventory.count.');
  const alertAction = action === 'inventory.threshold.set' || action === 'inventory.alert.acknowledge';
  if (action === 'ingredient.create' || action === 'inventory.receive' || countAction || alertAction) {
    const [inventory] = await Promise.all([api.ingredients(session), countAction ? api.stockCounts(session) : null,
      alertAction ? api.inventoryAlerts(session) : null]);
    const rows = list(inventory, 'ingredients');
    if (rows.some(row => !isId(row.id) || !isNonblankText(row.name, 120) || !isUnit(row.unit) ||
      !isSafeInt(row.onHandMilli) || !isNonnegativeInt(row.reservedMilli))) throw invalid();
  } else if (action === 'product.create' || action === 'product.availability.set' || action === 'product.recipe.update') {
    const rows = list(await api.products(session), 'products');
    if (rows.some(row => !isProduct(row))) throw invalid();
  } else if (action === 'shift.review') {
    const rows = list(await api.shifts(session), 'shifts');
    if (rows.some(row => !isId(row.id) || !isId(row.drawerId) || !isPositiveInt(row.version) ||
      !['awaiting_review', 'recount_required', 'closed'].includes(String(row.status)) ||
      !isNonnegativeInt(row.expectedCashCentavos) || !isNonnegativeInt(row.countedCashCentavos) || !isSafeInt(row.varianceCentavos))) throw invalid();
  } else if (action === 'approval.decide') {
    await api.approvals(session);
  } else if (action === 'order.amendment.decide') {
    await api.amendments(session);
  } else if (action.startsWith('refund.')) {
    await api.refunds(session);
  } else if (action === 'device.revoke' || action === 'device.enroll' || action === 'device.pair.create') {
    const rows = list(await api.devices(session), 'devices');
    if (rows.some(row => !isId(row.id) || row.branchId !== session.actor.branchId || !isPositiveInt(row.version) || typeof row.revoked !== 'boolean')) throw invalid();
  } else if (action.startsWith('account.')) {
    await api.accounts(session);
  } else if (action === 'branch.config.update') {
    await api.branchConfig(session);
  } else if (action.startsWith('printer.') || action.startsWith('print-job.')) {
    await Promise.all([api.printers(session), api.printJobs(session)]);
  } else if (action === 'csv.import') {
    await Promise.all([api.csvImports(session), api.products(session), api.customers(session)]);
  } else if (action.startsWith('sync.')) {
    await api.syncStatus(session);
  } else if (action === 'backup.restore') {
    await Promise.all([api.products(session), api.ingredients(session), api.branchConfig(session)]);
  } else if (action.startsWith('customer.') || action.startsWith('loyalty.')) {
    await Promise.all([api.customers(session), api.loyaltyRedemptions(session), api.loyaltyRefundCases(session)]);
  } else {
    const from = action === 'expense.record' ? command.data.startsOn : command.data.from;
    const through = action === 'expense.record' ? command.data.endsOn : command.data.through;
    if (typeof from !== 'string' || typeof through !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)) throw invalid();
    if (action === 'expense.coverage.confirm') await api.sales(session, { from, through });
    else {
      const rows = list(await api.expenses(session, { from, through }), 'expenses');
      if (rows.some(row => !isId(row.id) || !isNonnegativeInt(row.amountCentavos) || !isNonnegativeInt(row.allocatedCentavos))) throw invalid();
    }
  }
}
