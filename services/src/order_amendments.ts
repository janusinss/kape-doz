import { randomUUID } from 'node:crypto';
import type { HubDatabase } from './database.js';
import type { Actor } from './identity.js';
import { conflict, exact, forbidden, invalidRequest, notFound, productUnavailable } from './errors.js';
import { activeOrderRecipeDemand, deriveRequestStatus, estimateRemovalCost } from './inventory_valuation.js';
import { MAX_MONEY_CENTAVOS, MAX_VERSION } from './validation.js';
import type { AmendmentAcknowledgeInput, AmendmentDecisionInput, AmendmentRequestInput, WasteInput } from './business_validation.js';

type Row = Record<string, unknown>;
type Line = { lineNo: number; productId: string; name: string; quantity: number; note: string; unitPriceCentavos: number };
type IngredientAmount = { ingredientId: string; quantityMilli: number };
type DispositionIngredient = IngredientAmount & { name: string; unit: string };
type Product = { id: string; name: string; priceCentavos: number; version: number; available: boolean; recipe: IngredientAmount[] };
type LineSelection = { sizeId?: string | undefined; substitutionId?: string | undefined; addons?: { addonId: string; quantity: number }[] | undefined };
type Ports = {
  product(actor: Actor, id: string, dineIn?: boolean, selection?: LineSelection): Product;
  ingredient(actor: Actor, id: string): { onHandMilli: number; reservedMilli: number };
  waste(actor: Actor, input: WasteInput): { id: string };
};
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const nullableLine = (value: unknown) => value === null ? null : parse<Line>(value);

/** All writes run inside the hub's existing command/receipt transaction. */
export class OrderAmendments {
  constructor(private db: HubDatabase['connection'], private now: () => number, private ports: Ports) {}

  private readonly select = `SELECT a.*, o.order_no, o.version AS current_order_version
    FROM order_amendments a JOIN orders o ON o.id=a.order_id AND o.branch_id=a.branch_id`;

  private effectiveStatus(row: Row) {
    return row.status === 'awaiting_approval' && deriveRequestStatus(null, null, row.order_version, row.current_order_version) === 'stale'
      ? 'stale'
      : String(row.status);
  }

  private row(actor: Actor, id: string) {
    const row = this.db.prepare(this.select + ' WHERE a.branch_id=? AND a.id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    return row;
  }

  private projection(actor: Actor, row: Row) {
    const projectLine = (value: unknown) => {
      const line = nullableLine(value);
      if (!line) return null;
      const { unitPriceCentavos, ...safe } = line;
      return actor.role === 'barista' ? safe : { ...safe, unitPriceCentavos };
    };
    const recipe = parse<DispositionIngredient[]>(row.disposition_recipe_json);
    return { id: row.id, orderId: row.order_id, orderNo: row.order_no, orderVersion: row.order_version,
      operation: row.operation, status: this.effectiveStatus(row), before: projectLine(row.before_json), after: projectLine(row.after_json),
      reason: row.reason, decisionReason: actor.role === 'barista' ? null : row.decision_reason,
      requestedAt: row.requested_at, appliedAt: row.applied_at, resolvedAt: row.resolved_at,
      needsDisposition: recipe.length > 0, recipe, dispositionNote: row.disposition_note,
      ...(actor.role === 'barista' ? {} : { totalBeforeCentavos: row.total_before, totalAfterCentavos: row.total_after }) };
  }

  latest(actor: Actor, orderId: string) {
    const stationOnly = actor.role === 'barista' ? " AND a.status IN ('awaiting_station','resolved')" : '';
    const row = this.db.prepare(this.select + ' WHERE a.branch_id=? AND a.order_id=?' + stationOnly +
      " ORDER BY (a.status='awaiting_station') DESC,a.rowid DESC LIMIT 1").get(actor.branchId, orderId);
    return row ? this.projection(actor, row) : null;
  }

  history(actor: Actor, orderId: string) {
    const stationOnly = actor.role === 'barista' ? " AND a.status IN ('awaiting_station','resolved')" : '';
    return this.db.prepare(this.select + ' WHERE a.branch_id=? AND a.order_id=?' + stationOnly + ' ORDER BY a.rowid DESC LIMIT 100')
      .all(actor.branchId, orderId).map(row => this.projection(actor, row));
  }

  listReviews(actor: Actor) {
    return this.db.prepare(this.select + " WHERE a.branch_id=? AND a.requires_approval=1 ORDER BY (a.status='awaiting_approval' AND a.order_version=o.version) DESC,a.rowid DESC LIMIT 100")
      .all(actor.branchId).map(row => this.projection(actor, row));
  }

  awaitingStation(actor: Actor, orderId: string) {
    return this.db.prepare("SELECT id FROM order_amendments WHERE branch_id=? AND order_id=? AND status='awaiting_station'").get(actor.branchId, orderId) !== undefined;
  }

  awaitingPrice(actor: Actor, orderId: string) {
    return this.db.prepare(`SELECT id FROM order_amendments WHERE branch_id=? AND order_id=? AND status='awaiting_station'
      AND applied_at IS NULL AND total_before<>total_after`).get(actor.branchId, orderId) !== undefined;
  }

  supersede(actor: Actor, orderId: string) {
    this.db.prepare("UPDATE order_amendments SET status='stale' WHERE branch_id=? AND order_id=? AND status IN ('awaiting_approval','awaiting_station')").run(actor.branchId, orderId);
  }

  private assertEditable(actor: Actor, order: Row, operation: string) {
    if (order.released_at === null || order.ready_at !== null || order.cancelled_at !== null) throw conflict();
    if (operation === 'note') return;
    const hasTender = this.db.prepare("SELECT 1 FROM payments WHERE branch_id=? AND order_id=? AND status IN ('confirmed','pending')").get(actor.branchId, String(order.id));
    const settled = this.db.prepare('SELECT 1 FROM order_settlements WHERE branch_id=? AND order_id=?').get(actor.branchId, String(order.id));
    if (hasTender || settled || Number(order.discount_centavos) !== 0 || Number(order.loyalty_redemption_centavos ?? 0) !== 0) throw conflict();
  }

  request(actor: Actor, order: Row, input: AmendmentRequestInput) {
    const orderId = String(order.id);
    this.assertEditable(actor, order, input.operation);
    if (this.awaitingStation(actor, orderId) || this.db.prepare(`SELECT 1 FROM order_amendments WHERE branch_id=? AND order_id=?
      AND status='awaiting_approval' AND order_version=?`).get(actor.branchId, orderId, input.expectedVersion)) throw conflict();

    const before = 'lineNo' in input ? this.activeLine(actor, orderId, input.lineNo) : null;
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0').get(actor.branchId, orderId)!;
    if ((input.operation === 'remove' && count.count === 1) || (input.operation === 'add' && Number(count.count) >= 50)) throw conflict();

    let after: Line | null = null;
    let newProduct: Product | null = null;
    if (input.operation === 'add' || input.operation === 'replace') {
      newProduct = this.ports.product(actor, input.productId, Boolean(order.dine_in), input);
      if (!newProduct.available) throw productUnavailable('This menu item is unavailable.');
      const next = this.db.prepare('SELECT COALESCE(MAX(line_no),-1)+1 AS line_no FROM order_lines WHERE branch_id=? AND order_id=?').get(actor.branchId, orderId)!;
      const lineNo = Number(next.line_no);
      if (lineNo > MAX_VERSION) throw conflict();
      after = { lineNo, productId: newProduct.id, name: newProduct.name, quantity: input.quantity, note: input.note, unitPriceCentavos: newProduct.priceCentavos };
    } else if (input.operation === 'note') {
      if (before!.note === input.note) throw invalidRequest('Enter a different preparation note.');
      after = { ...before!, note: input.note };
    } else if (input.operation === 'quantity') {
      if (before!.quantity === input.quantity) throw invalidRequest('Enter a different quantity.');
      if (input.quantity > before!.quantity && !this.ports.product(actor, before!.productId).available) throw productUnavailable('This menu item is unavailable.');
      after = { ...before!, quantity: input.quantity };
    }

    const totalBefore = Number(order.total_centavos);
    const value = (line: Line | null) => BigInt(line?.quantity ?? 0) * BigInt(line?.unitPriceCentavos ?? 0);
    const totalAfter = BigInt(totalBefore) + value(after) - value(before);
    if (totalAfter < 1n || totalAfter > BigInt(MAX_MONEY_CENTAVOS)) throw invalidRequest('The changed total exceeds the supported range.');
    const decrease = input.operation === 'quantity' && after!.quantity < before!.quantity;
    const requiresApproval = input.operation === 'remove' || input.operation === 'replace' || decrease;
    const affectedQuantity = before && order.preparing_at !== null
      ? (input.operation === 'quantity' ? Math.max(0, before.quantity - after!.quantity) : before.quantity) : 0;
    const recipe = affectedQuantity ? this.dispositionRecipe(actor, orderId, before!.lineNo, affectedQuantity) : [];
    const id = randomUUID();
    this.db.prepare(`INSERT INTO order_amendments(id,branch_id,order_id,order_version,operation,status,requires_approval,reason,
      before_json,after_json,new_recipe_json,disposition_recipe_json,total_before,total_after,requester_id,requested_at,request_command_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, actor.branchId, orderId, input.expectedVersion, input.operation,
      requiresApproval ? 'awaiting_approval' : 'awaiting_station', requiresApproval ? 1 : 0, input.reason,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, newProduct ? JSON.stringify(newProduct) : null,
      JSON.stringify(recipe), totalBefore, Number(totalAfter), actor.id, this.now(), input.commandId);
    if (!requiresApproval) this.sendToStation(actor, order, this.row(actor, id));
    return this.projection(actor, this.row(actor, id));
  }

  decide(actor: Actor, id: string, input: AmendmentDecisionInput, getOrder: (id: string) => Row) {
    const row = this.row(actor, id);
    if (row.requester_id === actor.id) throw forbidden();
    if (this.effectiveStatus(row) !== 'awaiting_approval') throw conflict();
    const order = getOrder(String(row.order_id));
    this.db.prepare(`UPDATE order_amendments SET status=?,reviewer_id=?,decision_reason=?,decided_at=?,decision_command_id=? WHERE branch_id=? AND id=?`)
      .run(input.decision === 'deny' ? 'denied' : 'awaiting_station', actor.id, input.reason, this.now(), input.commandId, actor.branchId, id);
    if (input.decision === 'approve') {
      this.assertEditable(actor, order, String(row.operation));
      if (row.operation === 'replace') {
        const after = nullableLine(row.after_json);
        if (after && !this.ports.product(actor, after.productId).available) throw productUnavailable('This menu item is unavailable.');
      }
      this.sendToStation(actor, order, row);
    }
    return this.projection(actor, this.row(actor, id));
  }

  acknowledge(actor: Actor, order: Row, id: string, input: AmendmentAcknowledgeInput) {
    const row = this.row(actor, id);
    if (row.order_id !== order.id) throw notFound();
    if (this.effectiveStatus(row) !== 'awaiting_station') throw conflict();
    this.assertEditable(actor, order, row.applied_at === null ? String(row.operation) : 'note');
    const recipe = parse<DispositionIngredient[]>(row.disposition_recipe_json);
    const permitted = new Set(recipe.map(item => item.ingredientId));
    if (input.used.some(item => !permitted.has(item.ingredientId))) throw invalidRequest('Record ingredients from the affected preparation.');
    for (const item of input.used) {
      const waste = this.ports.waste(actor, { ...item, commandId: input.commandId, reason: 'Changed preparation', note: input.note });
      this.db.prepare('INSERT INTO amendment_waste(branch_id,amendment_id,waste_id) VALUES(?,?,?)').run(actor.branchId, id, waste.id);
    }
    if (row.applied_at === null) this.apply(actor, row);
    const time = this.now();
    this.db.prepare(`UPDATE order_amendments SET status='resolved',applied_at=COALESCE(applied_at,?),resolved_at=?,resolved_by=?,
      disposition_note=?,resolution_command_id=? WHERE branch_id=? AND id=?`)
      .run(time, time, actor.id, input.note || null, input.commandId, actor.branchId, id);
    this.bump(actor, order);
    return this.projection(actor, this.row(actor, id));
  }

  private activeLine(actor: Actor, orderId: string, lineNo: number): Line {
    const line = this.db.prepare('SELECT product_id,name,quantity,note,unit_price_centavos FROM order_lines WHERE branch_id=? AND order_id=? AND line_no=? AND retired=0')
      .get(actor.branchId, orderId, lineNo);
    if (!line) throw notFound();
    return { lineNo, productId: String(line.product_id), name: String(line.name), quantity: Number(line.quantity), note: String(line.note), unitPriceCentavos: Number(line.unit_price_centavos) };
  }

  private dispositionRecipe(actor: Actor, orderId: string, lineNo: number, units: number): DispositionIngredient[] {
    return this.db.prepare(`SELECT r.ingredient_id,r.quantity_milli,i.name,i.unit FROM order_line_recipe r
      JOIN ingredients i ON i.branch_id=r.branch_id AND i.id=r.ingredient_id
      WHERE r.branch_id=? AND r.order_id=? AND r.line_no=? ORDER BY i.id`).all(actor.branchId, orderId, lineNo)
      .map(row => ({ ingredientId: String(row.ingredient_id), quantityMilli: Number(row.quantity_milli) * units, name: String(row.name), unit: String(row.unit) }));
  }

  private sendToStation(actor: Actor, order: Row, row: Row) {
    if (order.preparing_at === null) {
      this.apply(actor, row);
      this.db.prepare('UPDATE order_amendments SET applied_at=? WHERE branch_id=? AND id=?').run(this.now(), actor.branchId, String(row.id));
    }
    this.bump(actor, order);
  }

  private bump(actor: Actor, order: Row) {
    const version = Number(order.version) + 1;
    if (version > MAX_VERSION) throw conflict();
    this.db.prepare('UPDATE orders SET version=? WHERE branch_id=? AND id=?').run(version, actor.branchId, String(order.id));
  }

  private apply(actor: Actor, row: Row) {
    const orderId = String(row.order_id);
    const before = nullableLine(row.before_json);
    const after = nullableLine(row.after_json);
    if (row.operation === 'remove' || row.operation === 'replace') {
      this.db.prepare('UPDATE order_lines SET retired=1 WHERE branch_id=? AND order_id=? AND line_no=?').run(actor.branchId, orderId, before!.lineNo);
    }
    if (row.operation === 'add' || row.operation === 'replace') {
      const product = parse<Product>(row.new_recipe_json);
      this.db.prepare(`INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note,recipe_version)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(actor.branchId, orderId, after!.lineNo, after!.productId, after!.name, after!.quantity, after!.unitPriceCentavos, after!.note, product.version);
      for (const item of product.recipe) {
        this.db.prepare('INSERT INTO order_line_recipe(branch_id,order_id,line_no,ingredient_id,quantity_milli) VALUES(?,?,?,?,?)')
          .run(actor.branchId, orderId, after!.lineNo, item.ingredientId, item.quantityMilli);
      }
    } else if (after) {
      this.db.prepare('UPDATE order_lines SET quantity=?,note=? WHERE branch_id=? AND order_id=? AND line_no=?')
        .run(after.quantity, after.note, actor.branchId, orderId, after.lineNo);
    }
    if (row.operation !== 'note') {
      this.reconcileReservations(actor, orderId);
      this.db.prepare('UPDATE orders SET total_centavos=? WHERE branch_id=? AND id=?').run(Number(row.total_after), actor.branchId, orderId);
    }
  }

  private reconcileReservations(actor: Actor, orderId: string) {
    const db = this.db;
    const required = activeOrderRecipeDemand(db, actor.branchId, orderId, true);
    const previous = db.prepare('SELECT ingredient_id,quantity_milli FROM reservations WHERE branch_id=? AND order_id=? AND consumed=0 AND released=0').all(actor.branchId, orderId);
    const prior = new Map(previous.map(item => [String(item.ingredient_id), Number(item.quantity_milli)]));
    const next = new Set(required.map(item => item.ingredientId));
    for (const [id] of prior) {
      if (next.has(id)) continue;
      db.prepare('DELETE FROM order_recipe_valuation_estimates WHERE branch_id=? AND order_id=? AND ingredient_id=?').run(actor.branchId, orderId, id);
      db.prepare('DELETE FROM reservations WHERE branch_id=? AND order_id=? AND ingredient_id=? AND consumed=0 AND released=0').run(actor.branchId, orderId, id);
    }
    for (const row of required) {
      const id = row.ingredientId;
      const quantity = row.quantityMilli;
      const existing = prior.get(id) ?? 0;
      if (quantity === existing) continue;
      const ingredient = this.ports.ingredient(actor, id);
      const others = ingredient.reservedMilli - existing;
      exact(quantity + others, 'The revised reservation exceeds the supported range.');
      exact(ingredient.onHandMilli - others - quantity, 'The revised reservation exceeds the supported range.');
      const estimate = ingredient.onHandMilli - others < quantity
        ? null : estimateRemovalCost(db, actor.branchId, id, ingredient.onHandMilli, quantity);
      db.prepare(`INSERT INTO reservations(branch_id,order_id,ingredient_id,quantity_milli) VALUES(?,?,?,?)
        ON CONFLICT(branch_id,order_id,ingredient_id) DO UPDATE SET quantity_milli=excluded.quantity_milli`).run(actor.branchId, orderId, id, quantity);
      db.prepare(`INSERT INTO order_recipe_valuation_estimates(branch_id,order_id,ingredient_id,cost_microcentavos) VALUES(?,?,?,?)
        ON CONFLICT(branch_id,order_id,ingredient_id) DO UPDATE SET cost_microcentavos=excluded.cost_microcentavos`).run(actor.branchId, orderId, id, estimate);
    }
  }
}
