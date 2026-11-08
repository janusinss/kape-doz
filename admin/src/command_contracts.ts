import { availabilityCommand, recipeUpdateCommand } from './product_availability';
import { inventoryAlertCommand } from './inventory_alert_contract';
import { stockCountCommand } from './stock_count_contract';
import { exactKeys, idRouteSegment, isNonblankText } from './primitives';

export const REFUND_LEG_ACTIONS = {
  confirm_external: { label: 'Record verified external refund', nextStatus: 'completed' },
  mark_unknown: { label: 'Mark outcome unknown', nextStatus: 'unknown' },
  mark_failed: { label: 'Record failure', nextStatus: 'failed' },
  retry: { label: 'Retry failed refund', nextStatus: 'pending' },
  void: { label: 'Void unpaid refund', nextStatus: 'voided' },
} as const;

export type RefundLegAction = keyof typeof REFUND_LEG_ACTIONS;
export type RefundLegMethod = 'cash' | 'gcash' | 'card';
export type RefundLegStatus = 'pending' | 'unknown' | 'failed' | 'completed' | 'voided';

export function isRefundLegAction(value: unknown): value is RefundLegAction {
  return typeof value === 'string' && Object.hasOwn(REFUND_LEG_ACTIONS, value);
}

export function allowedRefundLegActions(leg: { method: RefundLegMethod; status: RefundLegStatus }): RefundLegAction[] {
  if (leg.method === 'cash') return leg.status === 'pending' ? ['void'] : [];
  if (leg.status === 'pending') return ['confirm_external', 'mark_unknown', 'mark_failed'];
  if (leg.status === 'unknown') return ['confirm_external', 'mark_failed'];
  if (leg.status === 'failed') return ['retry', 'void'];
  return [];
}

const DIRECT_COMMAND_ACTIONS: Readonly<Record<string, string>> = {
  '/api/v1/ingredients': 'ingredient.create',
  '/api/v1/inventory/receipts': 'inventory.receive',
  '/api/v1/products': 'product.create',
  '/api/v1/admin/expenses': 'expense.record',
  '/api/v1/admin/expense-coverage': 'expense.coverage.confirm',
  '/api/v1/customers': 'customer.create',
  '/api/v1/customers/policy': 'customer.policy.update',
  '/api/v1/loyalty/cloud-mode': 'loyalty.cloud-mode',
  '/api/v1/loyalty/sync': 'loyalty.sync',
  '/api/v1/accounts': 'account.create',
  '/api/v1/devices': 'device.enroll',
  '/api/v1/settings/config': 'branch.config.update',
  '/api/v1/printers': 'printer.configure',
  '/api/v1/printers/mode': 'printer.mode.set',
  '/api/v1/csv/import': 'csv.import',
  '/api/v1/sync/mode': 'sync.mode.set',
  '/api/v1/sync/push': 'sync.push',
  '/api/v1/sync/ingest': 'sync.ingest',
  '/api/v1/admin/restore': 'backup.restore',
};

const PATTERN_COMMAND_ACTIONS: readonly { pattern: RegExp; action: string }[] = [
  { pattern: new RegExp(`^/api/v1/shifts/${idRouteSegment}/review$`), action: 'shift.review' },
  { pattern: new RegExp(`^/api/v1/approvals/${idRouteSegment}/decision$`), action: 'approval.decide' },
  { pattern: new RegExp(`^/api/v1/refunds/${idRouteSegment}/decision$`), action: 'refund.decide' },
  { pattern: new RegExp(`^/api/v1/devices/${idRouteSegment}/revoke$`), action: 'device.revoke' },
  { pattern: new RegExp(`^/api/v1/devices/${idRouteSegment}/pair$`), action: 'device.pair.create' },
  { pattern: new RegExp(`^/api/v1/customers/${idRouteSegment}$`), action: 'customer.update' },
  { pattern: new RegExp(`^/api/v1/loyalty/redemptions/${idRouteSegment}/decision$`), action: 'loyalty.redeem.decide' },
  { pattern: new RegExp(`^/api/v1/loyalty/redemptions/${idRouteSegment}/validate-cloud$`), action: 'loyalty.redeem.validate-cloud' },
  { pattern: new RegExp(`^/api/v1/loyalty/redemptions/${idRouteSegment}/reconcile-cloud$`), action: 'loyalty.redeem.reconcile-cloud' },
  { pattern: new RegExp(`^/api/v1/loyalty/refund-cases/${idRouteSegment}/decision$`), action: 'loyalty.refund-case.decide' },
  { pattern: new RegExp(`^/api/v1/loyalty/refund-cases/${idRouteSegment}/resolve-exception$`), action: 'loyalty.refund-case.resolve-exception' },
  { pattern: new RegExp(`^/api/v1/accounts/${idRouteSegment}$`), action: 'account.update' },
  { pattern: new RegExp(`^/api/v1/print-jobs/${idRouteSegment}/retry$`), action: 'print-job.retry' },
  { pattern: new RegExp(`^/api/v1/sync/conflicts/${idRouteSegment}/resolve$`), action: 'sync.conflict.resolve' },
];

const AMENDMENT_DECISION_PATTERN = new RegExp(`^/api/v1/amendments/${idRouteSegment}/decision$`);
const REFUND_LEG_PATTERN = new RegExp(`^/api/v1/refunds/${idRouteSegment}/legs/${idRouteSegment}$`);

export function resolveCommandAction(command: { path: string; data: Record<string, unknown> }, strictAmendmentPayload = false): string | null {
  const direct = DIRECT_COMMAND_ACTIONS[command.path];
  if (direct) return direct;
  const count = stockCountCommand(command.path, command.data);
  if (count) return count.action;
  const alert = inventoryAlertCommand(command.path, command.data);
  if (alert) return alert.action;
  if (availabilityCommand(command.path, command.data)) return 'product.availability.set';
  if (recipeUpdateCommand(command.path, command.data)) return 'product.recipe.update';
  for (const route of PATTERN_COMMAND_ACTIONS) {
    if (route.pattern.test(command.path)) return route.action;
  }
  if (AMENDMENT_DECISION_PATTERN.test(command.path)) {
    if (!strictAmendmentPayload) return 'order.amendment.decide';
    return exactKeys(command.data, ['decision', 'reason']) &&
      (command.data.decision === 'approve' || command.data.decision === 'deny') &&
      isNonblankText(command.data.reason, 300, true)
      ? 'order.amendment.decide'
      : null;
  }
  if (REFUND_LEG_PATTERN.test(command.path) && isRefundLegAction(command.data.action)) {
    return `refund.leg.${command.data.action}`;
  }
  return null;
}

export function validCommandPath(path: string, data: Record<string, unknown>): boolean {
  return resolveCommandAction({ path, data }, true) !== null;
}
