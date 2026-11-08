import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Actor } from './identity.js';
import { conflict, exact, notFound } from './errors.js';
import { physicalStock } from './inventory_counts.js';
import { activeIngredientReservationMilli, activeOrderRecipeDemand } from './inventory_valuation.js';
import type { StockThresholdInput, StockAlertAcknowledgeInput, StockAlertListInput } from './business_validation.js';

type Row = Record<string, unknown>;
export type StockShortage = {
  ingredientId: string; name: string; unit: string; requiredMilli: number; availableMilli: number; shortfallMilli: number;
};
const stockExact = (value: number) => exact(value, 'The stock quantity exceeds the supported range.');

/** Alert transitions share the transaction and command identity of their inventory change. */
export class InventoryAlerts {
  constructor(private db: DatabaseSync, private now: () => number) {}

  private snapshot(branchId: string, ingredientId: string) {
    const { onHandMilli } = physicalStock(this.db, branchId, ingredientId);
    const reservedMilli = activeIngredientReservationMilli(this.db, branchId, ingredientId, 'The stock quantity exceeds the supported range.');
    return { onHandMilli, reservedMilli, availableMilli: stockExact(onHandMilli - reservedMilli) };
  }

  private projection(row: Row) {
    return { id: String(row.id), branchId: String(row.branch_id), ingredientId: String(row.ingredient_id),
      kind: String(row.kind), status: String(row.status), version: Number(row.version),
      onHandMilli: Number(row.on_hand_milli), reservedMilli: Number(row.reserved_milli), availableMilli: Number(row.available_milli),
      thresholdMilli: row.threshold_milli === null ? null : Number(row.threshold_milli),
      openedAt: Number(row.opened_at), lastEvaluatedAt: Number(row.last_evaluated_at),
      acknowledgedBy: row.acknowledged_by, acknowledgedAt: row.acknowledged_at, acknowledgmentNote: row.acknowledgment_note,
      resolvedAt: row.resolved_at, resolution: row.resolution };
  }

  private alert(actor: Actor, id: string) {
    const row = this.db.prepare('SELECT * FROM inventory_alerts WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    return row;
  }

  private threshold(branchId: string, ingredientId: string) {
    const row = this.db.prepare('SELECT version,threshold_milli FROM ingredient_stock_thresholds WHERE branch_id=? AND ingredient_id=?')
      .get(branchId, ingredientId);
    return { ingredientId, version: Number(row?.version ?? 0), thresholdMilli: row?.threshold_milli == null ? null : Number(row.threshold_milli) };
  }

  setThreshold(actor: Actor, ingredientId: string, input: StockThresholdInput) {
    if (!this.db.prepare('SELECT 1 FROM ingredients WHERE branch_id=? AND id=?').get(actor.branchId, ingredientId)) throw notFound();
    const previous = this.threshold(actor.branchId, ingredientId);
    if (previous.version !== input.expectedVersion) throw conflict();
    this.db.prepare(`INSERT INTO ingredient_stock_thresholds(branch_id,ingredient_id,version,threshold_milli) VALUES(?,?,?,?)
      ON CONFLICT(branch_id,ingredient_id) DO UPDATE SET version=excluded.version,threshold_milli=excluded.threshold_milli`)
      .run(actor.branchId, ingredientId, stockExact(previous.version + 1), input.thresholdMilli);
    this.db.prepare(`INSERT INTO inventory_threshold_events(command_id,branch_id,ingredient_id,version,old_threshold_milli,
      new_threshold_milli,reason,actor_id,at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(input.commandId, actor.branchId, ingredientId, previous.version + 1, previous.thresholdMilli,
        input.thresholdMilli, input.reason, actor.id, this.now());
    return { threshold: this.threshold(actor.branchId, ingredientId) };
  }

  thresholdHistory(actor: Actor, ingredientId: string, beforeVersion?: number) {
    if (!this.db.prepare('SELECT 1 FROM ingredients WHERE branch_id=? AND id=?').get(actor.branchId, ingredientId)) throw notFound();
    const rows = this.db.prepare(`SELECT command_id,ingredient_id,version,old_threshold_milli,new_threshold_milli,reason,actor_id,at
      FROM inventory_threshold_events WHERE branch_id=? AND ingredient_id=? AND version<? ORDER BY version DESC LIMIT 51`)
      .all(actor.branchId, ingredientId, beforeVersion === undefined ? BigInt(Number.MAX_SAFE_INTEGER) + 1n : BigInt(beforeVersion));
    const page = rows.slice(0, 50);
    return { events: page.map(row => ({ commandId: row.command_id, ingredientId: row.ingredient_id, version: row.version,
      previousMilli: row.old_threshold_milli, thresholdMilli: row.new_threshold_milli, reason: row.reason, actorId: row.actor_id, at: row.at })),
      nextBeforeVersion: rows.length > 50 ? Number(page.at(-1)!.version) : null };
  }

  acknowledge(actor: Actor, id: string, input: StockAlertAcknowledgeInput) {
    const row = this.alert(actor, id);
    if (row.version !== input.expectedVersion || row.status !== 'open') throw conflict();
    const time = Math.max(this.now(), Number(row.last_evaluated_at));
    this.db.prepare(`UPDATE inventory_alerts SET status='acknowledged',version=version+1,last_evaluated_at=?,
      acknowledged_by=?,acknowledged_at=?,acknowledgment_note=? WHERE branch_id=? AND id=?`)
      .run(time, actor.id, time, input.note, actor.branchId, id);
    const updated = this.alert(actor, id);
    this.event(updated, 'acknowledged', input.commandId, actor.id, time, input.note);
    return { alert: this.projection(updated) };
  }

  list(actor: Actor, input: StockAlertListInput) {
    const where = input.status === 'active' ? "status<>'resolved'" : "status='resolved'";
    let cursor: Row | undefined;
    if (input.before) {
      cursor = this.db.prepare('SELECT opened_at,id FROM inventory_alerts WHERE branch_id=? AND id=?')
        .get(actor.branchId, input.before);
      if (!cursor) throw notFound();
    }
    const cursorSql = cursor ? ' AND (opened_at<? OR (opened_at=? AND id>?))' : '';
    const parameters = cursor ? [actor.branchId, Number(cursor.opened_at), Number(cursor.opened_at), String(cursor.id)] : [actor.branchId];
    const rows = this.db.prepare(`SELECT * FROM inventory_alerts WHERE branch_id=? AND ${where}${cursorSql}
      ORDER BY opened_at DESC,id ASC LIMIT 51`).all(...parameters);
    const page = rows.slice(0, 50);
    return { thresholds: this.db.prepare('SELECT id FROM ingredients WHERE branch_id=? ORDER BY id').all(actor.branchId)
      .map(row => this.threshold(actor.branchId, String(row.id))),
      alerts: page.map(row => this.projection(row)), nextCursor: rows.length > 50 ? String(page.at(-1)!.id) : null,
      evaluatedAt: this.now() };
  }

  history(actor: Actor, id: string) {
    this.alert(actor, id);
    const events = this.db.prepare('SELECT * FROM inventory_alert_events WHERE alert_id=? ORDER BY version').all(id).map(row => ({
      id: row.id, alertId: row.alert_id, version: row.version, type: row.type, commandId: row.command_id, actorId: row.actor_id,
      at: row.at, note: row.note, onHandMilli: row.on_hand_milli, reservedMilli: row.reserved_milli,
      availableMilli: row.available_milli, thresholdMilli: row.threshold_milli,
    }));
    const shortages = this.db.prepare('SELECT * FROM inventory_order_shortages WHERE branch_id=? AND alert_id=? ORDER BY at,id')
      .all(actor.branchId, id).map(row => ({ id: row.id, orderId: row.order_id, ingredientId: row.ingredient_id, phase: row.phase,
        requiredMilli: row.required_milli, availableMilli: row.available_milli, shortfallMilli: row.shortfall_milli,
        commandId: row.command_id, at: row.at }));
    return { events, shortages };
  }

  reconcile(actor: Actor, commandId: string, action: string) {
    const ingredients = this.db.prepare('SELECT id FROM ingredients WHERE branch_id=? ORDER BY id').all(actor.branchId);
    const currentTime = this.now();
    for (const item of ingredients) {
      const ingredientId = String(item.id);
      const stock = this.snapshot(actor.branchId, ingredientId);
      const threshold = this.threshold(actor.branchId, ingredientId).thresholdMilli;
      for (const kind of ['low_stock', 'shortage'] as const) {
        const limit = kind === 'low_stock' ? threshold : null;
        const applies = kind === 'low_stock' ? limit !== null && stock.onHandMilli <= limit : stock.availableMilli < 0;
        const existing = this.db.prepare(`SELECT * FROM inventory_alerts WHERE branch_id=? AND ingredient_id=? AND kind=? AND status<>'resolved'`)
          .get(actor.branchId, ingredientId, kind);
        let time = Math.max(currentTime, Number(existing?.last_evaluated_at ?? 0));
        if (!existing && !applies) continue;
        if (!existing) {
          const prior = this.db.prepare(`SELECT MAX(last_evaluated_at) AS latest FROM inventory_alerts
            WHERE branch_id=? AND ingredient_id=? AND kind=?`).get(actor.branchId, ingredientId, kind);
          if (prior?.latest !== null && prior?.latest !== undefined) time = Math.max(time, stockExact(Number(prior.latest) + 1));
          const id = randomUUID();
          this.db.prepare(`INSERT INTO inventory_alerts(id,branch_id,ingredient_id,kind,status,version,on_hand_milli,reserved_milli,
            available_milli,threshold_milli,opened_at,last_evaluated_at) VALUES(?,?,?,?,'open',1,?,?,?,?,?,?)`)
            .run(id, actor.branchId, ingredientId, kind, stock.onHandMilli, stock.reservedMilli, stock.availableMilli, limit, time, time);
          this.event(this.alert(actor, id), 'opened', commandId, actor.id, time, null);
          continue;
        }
        const changed = existing.on_hand_milli !== stock.onHandMilli || existing.reserved_milli !== stock.reservedMilli ||
          existing.threshold_milli !== limit || !applies;
        const version = stockExact(Number(existing.version) + (changed ? 1 : 0));
        const resolution = applies ? null : action === 'inventory.threshold.set' ? 'threshold_changed' : 'stock_recovered';
        this.db.prepare(`UPDATE inventory_alerts SET version=?,status=?,on_hand_milli=?,reserved_milli=?,available_milli=?,
          threshold_milli=?,last_evaluated_at=?,resolved_at=?,resolution=? WHERE branch_id=? AND id=?`)
          .run(version, applies ? String(existing.status) : 'resolved', stock.onHandMilli, stock.reservedMilli, stock.availableMilli,
            limit, time, applies ? null : time, resolution, actor.branchId, String(existing.id));
        if (changed) this.event(this.alert(actor, String(existing.id)), applies ? 'updated' : 'resolved', commandId, actor.id, time, null);
      }
    }
  }

  private event(alert: Row, type: string, commandId: string, actorId: string, time: number, note: string | null) {
    this.db.prepare(`INSERT INTO inventory_alert_events(id,alert_id,version,type,command_id,actor_id,at,note,
      on_hand_milli,reserved_milli,available_milli,threshold_milli) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), String(alert.id), Number(alert.version), type, commandId, actorId, time, note,
        Number(alert.on_hand_milli), Number(alert.reserved_milli), Number(alert.available_milli), alert.threshold_milli as number | null);
  }

  orderShortages(branchId: string, orderId: string): StockShortage[] {
    const order = this.db.prepare('SELECT released_at,ready_at,cancelled_at FROM orders WHERE branch_id=? AND id=?').get(branchId, orderId);
    if (!order || order.ready_at !== null || order.cancelled_at !== null) return [];
    const released = order.released_at !== null;
    const recipe = released
      ? this.db.prepare(`SELECT ingredient_id,quantity_milli AS required FROM reservations
          WHERE branch_id=? AND order_id=? AND consumed=0 AND released=0`).all(branchId, orderId)
          .map(row => ({ ingredientId: String(row.ingredient_id), quantityMilli: Number(row.required) }))
      : activeOrderRecipeDemand(this.db, branchId, orderId, false);
    const warnings: StockShortage[] = [];
    for (const row of recipe) {
      const ingredientId = row.ingredientId;
      const ingredient = this.db.prepare('SELECT name,unit FROM ingredients WHERE branch_id=? AND id=?').get(branchId, ingredientId)!;
      const stock = this.snapshot(branchId, ingredientId);
      const requiredMilli = stockExact(row.quantityMilli);
      const availableMilli = stockExact(stock.availableMilli + (released ? requiredMilli : 0));
      const shortfallMilli = stockExact(requiredMilli - availableMilli);
      if (shortfallMilli > 0) warnings.push({ ingredientId, name: String(ingredient.name), unit: String(ingredient.unit),
        requiredMilli, availableMilli, shortfallMilli });
    }
    return warnings;
  }

  recordShortages(actor: Actor, orderId: string, commandId: string, phase: string) {
    const order = this.db.prepare('SELECT released_at FROM orders WHERE branch_id=? AND id=?').get(actor.branchId, orderId);
    if (!order || order.released_at === null) return;
    for (const warning of this.orderShortages(actor.branchId, orderId)) {
      const alert = this.db.prepare(`SELECT id,last_evaluated_at FROM inventory_alerts WHERE branch_id=? AND ingredient_id=? AND kind='shortage' AND status<>'resolved'`)
        .get(actor.branchId, warning.ingredientId);
      if (!alert) throw new Error('An active shortage requires a reconciled alert.');
      this.db.prepare(`INSERT INTO inventory_order_shortages(id,branch_id,alert_id,order_id,ingredient_id,phase,
        required_milli,available_milli,shortfall_milli,command_id,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), actor.branchId, String(alert.id), orderId, warning.ingredientId, phase,
          warning.requiredMilli, warning.availableMilli, warning.shortfallMilli, commandId, Math.max(this.now(), Number(alert.last_evaluated_at)));
    }
  }
}
