import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Actor } from './identity.js';
import { conflict, exact, invalidRequest, notFound } from './errors.js';
import { carryingValue, recordStockMovement, setCarryingValue, toMicrocentavos } from './inventory_valuation.js';
import type {
  StockCountStartInput, StockCountObserveInput, StockCountDecisionInput, StockCountCostInput, StockCountRevalueInput,
} from './business_validation.js';

type Row = Record<string, unknown>;
type PhysicalStock = { onHandMilli: number; stockVersion: number };
type Gain = { id: string; sequence: number; basis: bigint | null; cost: bigint | null };

export function physicalStock(db: DatabaseSync, branchId: string, ingredientId: string): PhysicalStock {
  const latest = db.prepare(`SELECT sequence,quantity_after_milli FROM stock_movements
    WHERE branch_id=? AND ingredient_id=? ORDER BY sequence DESC LIMIT 1`).get(branchId, ingredientId);
  return { onHandMilli: Number(latest?.quantity_after_milli ?? 0), stockVersion: Number(latest?.sequence ?? 0) };
}

/** Mutations run inside the business command transaction. Stock movement sequences ignore reservations. */
export class InventoryCounts {
  constructor(private db: DatabaseSync, private now: () => number) {}

  private readonly select = `SELECT c.id,c.ingredient_id,c.unit,c.version,c.status,c.snapshot_milli,c.snapshot_stock_version,
    c.observed_milli,c.variance_milli,c.reason,confirmed.total_cost_centavos,confirmed.reference AS cost_reference,
    reviewed.total_cost_centavos AS balance_cost_centavos,reviewed.reference AS balance_cost_reference
    FROM inventory_counts c LEFT JOIN inventory_count_costs confirmed ON confirmed.count_id=c.id
    LEFT JOIN inventory_count_revaluations reviewed ON reviewed.count_id=c.id`;

  private row(actor: Actor, id: string) {
    const row = this.db.prepare(this.select + ' WHERE c.branch_id=? AND c.id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    return row;
  }

  private getVersion(actor: Actor, id: string, expected: number) {
    const row = this.row(actor, id);
    if (row.version !== expected) throw conflict();
    return row;
  }

  private unresolvedGains(branchId: string, ingredientId: string, stock: PhysicalStock): Gain[] {
    if (stock.onHandMilli <= 0 || carryingValue(this.db, branchId, ingredientId) !== null) return [];
    const lastZero = this.db.prepare(`SELECT sequence FROM stock_movements
      WHERE branch_id=? AND ingredient_id=? AND quantity_after_milli=0 ORDER BY sequence DESC LIMIT 1`).get(branchId, ingredientId);
    const lastReview = this.db.prepare(`SELECT stock_version FROM inventory_count_revaluations
      WHERE branch_id=? AND ingredient_id=? ORDER BY stock_version DESC LIMIT 1`).get(branchId, ingredientId);
    const boundary = Math.max(Number(lastZero?.sequence ?? 0), Number(lastReview?.stock_version ?? 0));
    const statement = this.db.prepare(`SELECT c.id,m.sequence,c.basis_before_microcentavos,cost.total_cost_centavos
      FROM stock_movements m JOIN inventory_counts c ON c.id=m.count_id
      LEFT JOIN inventory_count_costs cost ON cost.count_id=c.id
      WHERE m.branch_id=? AND m.ingredient_id=? AND m.sequence>? AND m.kind='count_adjustment' AND m.quantity_milli>0
      ORDER BY m.sequence`);
    statement.setReadBigInts(true);
    return statement.all(branchId, ingredientId, boundary).map(row => ({
      id: String(row.id), sequence: Number(row.sequence),
      basis: row.basis_before_microcentavos as bigint | null, cost: row.total_cost_centavos as bigint | null,
    }));
  }

  private live(branchId: string, ingredientId: string) {
    const stock = physicalStock(this.db, branchId, ingredientId);
    const gains = this.unresolvedGains(branchId, ingredientId, stock);
    return { ...stock, reviewCountId: gains.every(gain => gain.cost !== null) ? gains.at(-1)?.id : undefined };
  }

  private projection(row: Row, stock: ReturnType<InventoryCounts['live']>) {
    const positive = row.status === 'approved' && Number(row.variance_milli) > 0;
    return {
      id: row.id, ingredientId: row.ingredient_id, unit: row.unit, status: row.status, version: row.version,
      snapshotMilli: row.snapshot_milli, snapshotStockVersion: row.snapshot_stock_version,
      observedMilli: row.observed_milli, varianceMilli: row.variance_milli, reason: row.reason,
      costStatus: positive ? row.total_cost_centavos === null ? 'pending' : 'confirmed' : 'not_required',
      totalCostCentavos: row.total_cost_centavos, costReference: row.cost_reference,
      liveOnHandMilli: stock.onHandMilli, liveStockVersion: stock.stockVersion, canRevalue: stock.reviewCountId === row.id,
      balanceCostCentavos: row.balance_cost_centavos, balanceCostReference: row.balance_cost_reference,
    };
  }

  private result(actor: Actor, id: string) {
    const row = this.row(actor, id);
    return { count: this.projection(row, this.live(actor.branchId, String(row.ingredient_id))) };
  }

  list(actor: Actor) {
    const live = new Map<string, ReturnType<InventoryCounts['live']>>();
    const rows = this.db.prepare(this.select + ` WHERE c.branch_id=?
      ORDER BY (c.status IN ('open','submitted')) DESC,(c.status='approved' AND c.variance_milli>0 AND confirmed.count_id IS NULL) DESC,
        c.created_at DESC,c.rowid DESC`).all(actor.branchId);
    return { counts: rows.map(row => {
      const id = String(row.ingredient_id);
      let stock = live.get(id);
      if (!stock) {
        stock = this.live(actor.branchId, id);
        live.set(id, stock);
      }
      return this.projection(row, stock);
    }) };
  }

  start(actor: Actor, input: StockCountStartInput) {
    const { branchId, id: actorId } = actor;
    const { ingredientId } = input;
    const ingredient = this.db.prepare('SELECT unit FROM ingredients WHERE branch_id=? AND id=?').get(branchId, ingredientId);
    if (!ingredient) throw notFound();
    if (this.db.prepare(`SELECT 1 FROM inventory_counts WHERE branch_id=? AND ingredient_id=?
      AND status IN ('open','submitted')`).get(branchId, ingredientId)) throw conflict();
    const stock = physicalStock(this.db, branchId, ingredientId);
    const id = randomUUID();
    this.db.prepare(`INSERT INTO inventory_counts(id,branch_id,ingredient_id,unit,snapshot_milli,snapshot_stock_version,
      version,status,created_by,created_at) VALUES(?,?,?,?,?,?,1,'open',?,?)`)
      .run(id, branchId, ingredientId, String(ingredient.unit), stock.onHandMilli, stock.stockVersion, actorId, this.now());
    return this.result(actor, id);
  }

  observe(actor: Actor, id: string, input: StockCountObserveInput) {
    const row = this.getVersion(actor, id, input.expectedVersion);
    if (row.status !== 'open') throw conflict();
    if (row.unit !== input.unit) throw invalidRequest('Use the ingredient unit shown on the count.');
    const stock = physicalStock(this.db, actor.branchId, String(row.ingredient_id));
    if (stock.stockVersion !== row.snapshot_stock_version) {
      throw conflict('Stock moved during the count. Discard it and start a fresh count.');
    }
    const variance = exact(input.observedMilli - stock.onHandMilli, 'The stock variance exceeds the supported range.');
    this.db.prepare(`UPDATE inventory_counts SET status='submitted',version=version+1,observed_milli=?,variance_milli=?,
      observed_by=?,observed_at=? WHERE branch_id=? AND id=?`)
      .run(input.observedMilli, variance, actor.id, this.now(), actor.branchId, id);
    return this.result(actor, id);
  }

  decide(actor: Actor, id: string, input: StockCountDecisionInput) {
    const row = this.getVersion(actor, id, input.expectedVersion);
    if (row.status !== 'submitted' && (row.status !== 'open' || input.decision !== 'discard')) throw conflict();
    const branchId = actor.branchId;
    const ingredientId = String(row.ingredient_id);
    const stock = physicalStock(this.db, branchId, ingredientId);
    const approved = input.decision === 'approve';
    const variance = approved ? Number(row.variance_milli) : 0;
    const after = exact(stock.onHandMilli + variance, 'The resulting stock quantity exceeds the supported range.');
    const basis = variance > 0 && stock.onHandMilli >= 0
      ? stock.onHandMilli === 0 ? 0n : carryingValue(this.db, branchId, ingredientId) : null;
    const time = this.now();
    this.db.prepare(`UPDATE inventory_counts SET status=?,version=version+1,reason=?,decided_by=?,decided_at=?,
      basis_before_microcentavos=? WHERE branch_id=? AND id=?`)
      .run(approved ? 'approved' : 'discarded', input.reason, actor.id, time, basis, branchId, id);
    if (variance !== 0) {
      recordStockMovement(this.db, {
        branchId,
        ingredientId,
        quantityBeforeMilli: stock.onHandMilli,
        deltaMilli: variance,
        quantityAfterMilli: after,
        kind: 'count_adjustment',
        referenceId: id,
        commandId: input.commandId,
        acceptedAt: time,
      });
    }
    return this.result(actor, id);
  }

  confirmCost(actor: Actor, id: string, input: StockCountCostInput) {
    const row = this.getVersion(actor, id, input.expectedVersion);
    if (row.status !== 'approved' || Number(row.variance_milli) <= 0 || row.total_cost_centavos !== null) throw conflict();
    this.db.prepare(`INSERT INTO inventory_count_costs(count_id,total_cost_centavos,reference,actor_id,accepted_at,command_id)
      VALUES(?,?,?,?,?,?)`).run(id, input.totalCostCentavos, input.reference, actor.id, this.now(), input.commandId);
    this.bump(actor, id);
    this.restoreKnownBasis(actor.branchId, String(row.ingredient_id), id);
    return this.result(actor, id);
  }

  private restoreKnownBasis(branchId: string, ingredientId: string, id: string) {
    const stock = physicalStock(this.db, branchId, ingredientId);
    const gains = this.unresolvedGains(branchId, ingredientId, stock);
    if (!gains.some(gain => gain.id === id) || gains.some(gain => gain.cost === null)) return;
    const anchor = [...gains].reverse().find(gain => gain.basis !== null);
    if (!anchor || anchor.basis === null) return;
    // An outbound movement while value was unknown makes the remaining basis unknowable.
    const statement = this.db.prepare(`SELECT m.kind,m.quantity_milli,v.value_microcentavos
      FROM stock_movements m LEFT JOIN stock_movement_valuations v ON v.movement_id=m.id
      WHERE m.branch_id=? AND m.ingredient_id=? AND m.sequence>=?`);
    statement.setReadBigInts(true);
    let value = anchor.basis;
    for (const move of statement.iterate(branchId, ingredientId, anchor.sequence)) {
      if (Number(move.quantity_milli) < 0) return;
      if (move.kind === 'receipt') {
        if (typeof move.value_microcentavos !== 'bigint') return;
        value += move.value_microcentavos;
      }
    }
    for (const gain of gains) {
      if (gain.sequence >= anchor.sequence && gain.cost !== null) value += toMicrocentavos(Number(gain.cost));
    }
    setCarryingValue(this.db, branchId, ingredientId, value);
  }

  revalue(actor: Actor, id: string, input: StockCountRevalueInput) {
    const row = this.getVersion(actor, id, input.expectedVersion);
    const ingredientId = String(row.ingredient_id);
    const stock = this.live(actor.branchId, ingredientId);
    if (stock.reviewCountId !== id || stock.stockVersion !== input.expectedStockVersion) throw conflict();
    this.db.prepare(`INSERT INTO inventory_count_revaluations(count_id,branch_id,ingredient_id,stock_version,
      on_hand_milli,total_cost_centavos,reference,actor_id,accepted_at,command_id) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, actor.branchId, ingredientId, stock.stockVersion, stock.onHandMilli, input.totalCostCentavos,
        input.reference, actor.id, this.now(), input.commandId);
    setCarryingValue(this.db, actor.branchId, ingredientId, toMicrocentavos(input.totalCostCentavos));
    this.bump(actor, id);
    return this.result(actor, id);
  }

  private bump(actor: Actor, id: string) {
    this.db.prepare('UPDATE inventory_counts SET version=version+1 WHERE branch_id=? AND id=?').run(actor.branchId, id);
  }
}
