import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { type ApiError, exact, invalidRequest } from './errors.js';

const microcentavosPerCentavo = 1_000_000n;
const maxSqliteInteger = (1n << 63n) - 1n;

function invalidValuation(): ApiError {
  return invalidRequest('The inventory valuation exceeds the supported range.');
}

export function carryingValue(db: DatabaseSync, branchId: string, ingredientId: string): bigint | null {
  const statement = db.prepare(`SELECT carrying_microcentavos FROM ingredient_valuation_balances
    WHERE branch_id=? AND ingredient_id=?`);
  statement.setReadBigInts(true);
  const value = statement.get(branchId, ingredientId)?.carrying_microcentavos;
  return typeof value === 'bigint' ? value : null;
}

export function setCarryingValue(db: DatabaseSync, branchId: string, ingredientId: string, value: bigint | null): void {
  if (value !== null && (value < 0n || value > maxSqliteInteger)) throw invalidValuation();
  db.prepare(`INSERT INTO ingredient_valuation_balances(branch_id,ingredient_id,carrying_microcentavos)
    VALUES(?,?,?) ON CONFLICT(branch_id,ingredient_id) DO UPDATE
      SET carrying_microcentavos=excluded.carrying_microcentavos`).run(branchId, ingredientId, value);
}

export function toMicrocentavos(centavos: number): bigint {
  return BigInt(centavos) * microcentavosPerCentavo;
}

function proportionalCost(value: bigint | null, onHandMilli: number, quantityMilli: number): bigint | null {
  if (value === null || onHandMilli <= 0 || quantityMilli > onHandMilli) return null;
  // A full depletion takes the residual value left by earlier floor rounding.
  return value * BigInt(quantityMilli) / BigInt(onHandMilli);
}

export function estimateRemovalCost(
  db: DatabaseSync, branchId: string, ingredientId: string, onHandMilli: number, quantityMilli: number,
): bigint | null {
  if (!Number.isSafeInteger(onHandMilli) || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) {
    throw invalidValuation();
  }
  return proportionalCost(carryingValue(db, branchId, ingredientId), onHandMilli, quantityMilli);
}

type StockValueInput = {
  movementId: string;
  branchId: string;
  ingredientId: string;
  quantityBeforeMilli: number;
  deltaMilli: number;
  receiptCostCentavos?: number | undefined;
};

/** Post the valuation within the transaction that creates the stock movement. */
export function postStockValue(db: DatabaseSync, input: StockValueInput): void {
  const { movementId, branchId, ingredientId, quantityBeforeMilli, deltaMilli, receiptCostCentavos } = input;
  const quantityAfterMilli = quantityBeforeMilli + deltaMilli;
  if (!Number.isSafeInteger(quantityBeforeMilli) || !Number.isSafeInteger(deltaMilli) ||
      !Number.isSafeInteger(quantityAfterMilli) || deltaMilli === 0 ||
      (receiptCostCentavos !== undefined &&
        (!Number.isSafeInteger(receiptCostCentavos) || receiptCostCentavos < 0 || deltaMilli < 0))) {
    throw invalidValuation();
  }

  const priorValue = carryingValue(db, branchId, ingredientId);
  let movementValue: bigint | null;
  let balance: bigint | null = null;
  if (deltaMilli > 0) {
    movementValue = receiptCostCentavos === undefined ? null : toMicrocentavos(receiptCostCentavos);
    if (movementValue !== null) {
      if (quantityBeforeMilli === 0) balance = movementValue;
      else if (quantityBeforeMilli > 0 && priorValue !== null) balance = priorValue + movementValue;
    }
  } else {
    movementValue = proportionalCost(priorValue, quantityBeforeMilli, -deltaMilli);
    if (movementValue !== null && priorValue !== null) balance = priorValue - movementValue;
  }
  if (quantityAfterMilli === 0) balance = 0n;

  for (const value of [movementValue, balance]) {
    if (value !== null && (value < 0n || value > maxSqliteInteger)) throw invalidValuation();
  }
  db.prepare('INSERT INTO stock_movement_valuations(movement_id,value_microcentavos) VALUES(?,?)')
    .run(movementId, movementValue);
  setCarryingValue(db, branchId, ingredientId, balance);
}

export type RecordStockMovementInput = {
  branchId: string;
  ingredientId: string;
  quantityBeforeMilli: number;
  deltaMilli: number;
  quantityAfterMilli: number;
  kind: 'receipt' | 'consumption' | 'waste' | 'count_adjustment';
  referenceId: string;
  commandId: string;
  acceptedAt: number;
  receiptCostCentavos?: number | undefined;
};

const movementReferenceColumns: Record<RecordStockMovementInput['kind'], 'receipt_id' | 'order_id' | 'waste_id' | 'count_id'> = {
  receipt: 'receipt_id',
  consumption: 'order_id',
  waste: 'waste_id',
  count_adjustment: 'count_id',
};

export function recordStockMovement(db: DatabaseSync, input: RecordStockMovementInput): string {
  const movementId = randomUUID();
  const column = movementReferenceColumns[input.kind];
  db.prepare(`INSERT INTO stock_movements(id,branch_id,ingredient_id,quantity_milli,quantity_after_milli,
    kind,${column},command_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(movementId, input.branchId, input.ingredientId, input.deltaMilli, input.quantityAfterMilli,
      input.kind, input.referenceId, input.commandId, input.acceptedAt);
  postStockValue(db, {
    movementId,
    branchId: input.branchId,
    ingredientId: input.ingredientId,
    quantityBeforeMilli: input.quantityBeforeMilli,
    deltaMilli: input.deltaMilli,
    receiptCostCentavos: input.receiptCostCentavos,
  });
  return movementId;
}

export function activeIngredientReservationMilli(
  db: DatabaseSync,
  branchId: string,
  ingredientId: string,
  message = 'The resulting amount exceeds the supported range.',
): number {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity_milli),0) AS amount FROM reservations
    WHERE branch_id=? AND ingredient_id=? AND consumed=0 AND released=0`).get(branchId, ingredientId)!;
  return exact(Number(row.amount), message);
}

export function activeOrderRecipeDemand(
  db: DatabaseSync,
  branchId: string,
  orderId: string,
  released: boolean,
): { ingredientId: string; quantityMilli: number }[] {
  const rows = released
    ? db.prepare(`SELECT r.ingredient_id, SUM(r.quantity_milli*l.quantity) AS quantity
        FROM order_line_recipe r
        JOIN order_lines l ON l.branch_id=r.branch_id AND l.order_id=r.order_id AND l.line_no=r.line_no
        WHERE r.branch_id=? AND r.order_id=? AND l.retired=0 GROUP BY r.ingredient_id`).all(branchId, orderId)
    : db.prepare(`SELECT ingredient_id, SUM(quantity) AS quantity FROM (
        SELECT r.ingredient_id, r.quantity_milli*l.quantity AS quantity
        FROM order_line_recipe r
        JOIN order_lines l ON l.branch_id=r.branch_id AND l.order_id=r.order_id AND l.line_no=r.line_no
        WHERE r.branch_id=? AND r.order_id=? AND l.retired=0
        UNION ALL
        SELECT r.ingredient_id, r.quantity_milli*l.quantity AS quantity
        FROM order_lines l
        JOIN products p ON p.branch_id=l.branch_id AND p.id=l.product_id
        JOIN product_recipe r ON r.branch_id=p.branch_id AND r.product_id=p.id AND r.version=p.version
        WHERE l.branch_id=? AND l.order_id=? AND l.retired=0
          AND NOT EXISTS (SELECT 1 FROM order_line_recipe lr WHERE lr.branch_id=l.branch_id AND lr.order_id=l.order_id AND lr.line_no=l.line_no)
      ) GROUP BY ingredient_id`).all(branchId, orderId, branchId, orderId);
  return rows.map(row => ({ ingredientId: String(row.ingredient_id), quantityMilli: Number(row.quantity) }));
}

export function deriveRequestStatus(
  decision: unknown,
  supersededBy: unknown,
  requestOrderVersion: unknown,
  currentOrderVersion: unknown,
): 'approved' | 'denied' | 'stale' | 'pending' {
  if (decision === 'approve') return 'approved';
  if (decision === 'deny') return 'denied';
  if (supersededBy !== null || Number(requestOrderVersion) !== Number(currentOrderVersion)) return 'stale';
  return 'pending';
}
