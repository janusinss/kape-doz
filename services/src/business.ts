import { randomUUID } from 'node:crypto';
import { HubDatabase } from './database.js';
import { digest, isStaffRole, type Actor, type Session } from './identity.js';
import { conflict, exact as safeExact, forbidden, invalidRequest, notFound, productUnavailable } from './errors.js';
import { ADMIN_ROLES, MAX_MONEY_CENTAVOS, MAX_VERSION, type Role } from './validation.js';
import { activeIngredientReservationMilli, deriveRequestStatus, estimateRemovalCost, recordStockMovement } from './inventory_valuation.js';
import { manilaBusinessDate, salesReport } from './sales_report.js';
import { executeCommand } from './command_outcomes.js';
import { OrderAmendments } from './order_amendments.js';
import { InventoryCounts, physicalStock } from './inventory_counts.js';
import { InventoryAlerts } from './inventory_alerts.js';
import { CustomersAndLoyalty } from './customers_loyalty.js';
import { SetupCsvAndRecovery } from './setup_csv_recovery.js';
import type {
  IngredientInput, StockReceiptInput, ProductInput, ProductRecipeUpdateInput, DrawerInput, ShiftOpenInput,
  ShiftCountInput, ShiftReviewInput, OrderInput, OrderCustomerInput, PaymentInput, PaymentRejectInput, VersionInput, WasteInput,
  ExpenseInput, ExpensePeriodInput, ExpenseCoverageInput,
  ApprovalRequestInput, ApprovalDecisionInput, CancellationDispositionInput,
  RefundRequestInput, RefundDecisionInput, RefundLegInput,
  AmendmentRequestInput, AmendmentDecisionInput, AmendmentAcknowledgeInput,
  StockCountStartInput, StockCountObserveInput, StockCountDecisionInput, StockCountCostInput, StockCountRevalueInput,
  StockThresholdInput, StockAlertAcknowledgeInput, StockAlertListInput,
  ProductAvailabilityInput, ReplaceUnavailableInput,
  CustomerCreateInput, CustomerUpdateInput, CustomerListInput, CustomerPolicyInput,
  LoyaltyCloudModeInput, LoyaltySyncInput, LoyaltyRedeemRequestInput, LoyaltyRedeemDecisionInput,
  LoyaltyRedeemCloudValidateInput, LoyaltyRedeemCloudReconcileInput,
  LoyaltyRefundCaseDecisionInput, LoyaltyRefundCaseExceptionInput,
  AccountCreateInput, AccountUpdateInput, DeviceCreateInput, DevicePairingClaimInput, DevicePairingCreateInput, BranchConfigInput,
  PrinterAdapterModeInput, PrintJobRetryInput, WasteCorrectionInput,
  CsvPreviewInput, CsvImportInput, CsvExportQueryInput,
  SyncModeInput, SyncPushInput, SyncIngestInput, SyncConflictResolveInput, BackupRestoreInput,
} from './business_validation.js';

type Row = Record<string, unknown>;
type RecipeLine = { ingredientId: string; quantityMilli: number };
export type ProductOptions = {
  sizes: { id: string; name: string; priceDeltaCentavos: number; recipe: RecipeLine[] }[];
  substitutions: { id: string; name: string; replaceIngredientId: string; withIngredientId: string; quantityMilli?: number | undefined; priceDeltaCentavos: number }[];
  addons: { id: string; name: string; priceDeltaCentavos: number; recipe: RecipeLine[] }[];
  dineInPackaging: RecipeLine[];
  takeoutPackaging: RecipeLine[];
};
type LineSelection = { sizeId?: string | undefined; substitutionId?: string | undefined; addons?: { addonId: string; quantity: number }[] | undefined };
const emptyOptions: ProductOptions = { sizes: [], substitutions: [], addons: [], dineInPackaging: [], takeoutPackaging: [] };
function hasProductOptions(options: ProductOptions): boolean {
  return options.sizes.length > 0 || options.substitutions.length > 0 || options.addons.length > 0 ||
    options.dineInPackaging.length > 0 || options.takeoutPackaging.length > 0;
}
function parseProductOptions(raw: unknown): ProductOptions {
  if (typeof raw !== 'string' || !raw || raw === '{}') return emptyOptions;
  const parsed = JSON.parse(raw) as Partial<ProductOptions>;
  return {
    sizes: parsed.sizes ?? [],
    substitutions: parsed.substitutions ?? [],
    addons: parsed.addons ?? [],
    dineInPackaging: parsed.dineInPackaging ?? [],
    takeoutPackaging: parsed.takeoutPackaging ?? [],
  };
}
const exact = (value: number) => safeExact(value, 'The resulting amount exceeds the supported range.');
function monetary(value: number): number {
  exact(value);
  if (value < 0 || value > MAX_MONEY_CENTAVOS) throw invalidRequest('The resulting amount exceeds the supported range.');
  return value;
}
// Calendar dates already identify Manila business days. UTC midnight here is
// only an integer-day coordinate, independent of the host's timezone.
const calendarDay = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;

/** Branch-authoritative service operations. Calls are synchronous inside one SQLite transaction. */
export class BusinessService {
  private db;
  private amendments: OrderAmendments;
  private counts: InventoryCounts;
  private alerts: InventoryAlerts;
  private loyalty: CustomersAndLoyalty;
  private setup: SetupCsvAndRecovery;
  constructor(private store: HubDatabase, private now: () => number) {
    this.db = store.connection;
    this.counts = new InventoryCounts(this.db, now);
    this.alerts = new InventoryAlerts(this.db, now);
    this.loyalty = new CustomersAndLoyalty(this.db, now);
    this.setup = new SetupCsvAndRecovery(this.db, now, store.authorityId);
    this.amendments = new OrderAmendments(this.db, now, {
      product: (actor, id, dineIn, selection) => {
        if (dineIn === undefined && selection === undefined) return this.product(actor, id);
        const resolved = this.resolveOrderLine(actor, id, dineIn ?? false, selection);
        return { ...resolved.product, name: resolved.displayName, priceCentavos: resolved.unitPriceCentavos, recipe: resolved.recipe };
      },
      ingredient: (actor, id) => this.ingredient(actor, id),
      waste: (actor, input) => this.postWaste(actor, input),
    });
  }

  private permit(actor: Actor, roles: readonly Role[]) {
    if (!roles.includes(actor.role)) throw forbidden();
  }
  private mutation<T extends Record<string, unknown>>(actor: Actor & { deviceId?: string | null }, input: { commandId: string }, action: string, target: string, perform: () => T): T & { commandId: string } {
    const deviceId = actor.deviceId ?? null;
    if (isStaffRole(actor.role)) {
      if (!deviceId || !this.db.prepare('SELECT id FROM devices WHERE id=? AND branch_id=? AND revoked=0').get(deviceId, actor.branchId)) throw forbidden();
    }
    const fingerprint = digest(JSON.stringify({ action, target, deviceId, input }));
    return executeCommand(this.store, this.now, { actor, deviceId, commandId: input.commandId, action, target, fingerprint }, () => {
      const result = perform();
      this.alerts.reconcile(actor, input.commandId, action);
      const order = result.order;
      if (order && typeof order === 'object' && 'id' in order && typeof order.id === 'string') {
        this.alerts.recordShortages(actor, order.id, input.commandId, action);
      } else {
        const amendment = result.amendment;
        if (amendment && typeof amendment === 'object' && 'orderId' in amendment && typeof amendment.orderId === 'string') {
          this.alerts.recordShortages(actor, amendment.orderId, input.commandId, action);
        }
      }
      return result;
    });
  }

  private ingredient(actor: Actor, id: string) {
    const row = this.db.prepare('SELECT id,name,unit FROM ingredients WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    const { onHandMilli } = physicalStock(this.db, actor.branchId, id);
    const reservedMilli = activeIngredientReservationMilli(this.db, actor.branchId, id);
    return { id: String(row.id), name: String(row.name), unit: String(row.unit), onHandMilli, reservedMilli };
  }
  createIngredient(actor: Actor, input: IngredientInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'ingredient.create', input.ingredientId, () => {
      if (this.db.prepare('SELECT id FROM ingredients WHERE branch_id=? AND id=?').get(actor.branchId, input.ingredientId)) throw conflict();
      this.db.prepare('INSERT INTO ingredients(branch_id,id,name,unit) VALUES(?,?,?,?)').run(actor.branchId, input.ingredientId, input.name, input.unit);
      return { ingredient: this.ingredient(actor, input.ingredientId) };
    });
  }
  listIngredients(actor: Actor) {
    return { ingredients: this.db.prepare('SELECT id FROM ingredients WHERE branch_id=? ORDER BY id').all(actor.branchId).map(row => this.ingredient(actor, String(row.id))) };
  }
  receiveStock(actor: Actor, input: StockReceiptInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.receive', input.ingredientId, () => {
      const ingredient = this.ingredient(actor, input.ingredientId);
      const packCount = input.packCount ?? 1;
      const packSizeMilli = input.packSizeMilli ?? input.quantityMilli!;
      const quantityMilli = exact(packCount * packSizeMilli);
      const supplier = input.supplier ?? '';
      const quantityAfter = exact(ingredient.onHandMilli + quantityMilli);
      const id = randomUUID();
      const acceptedAt = this.now();
      this.db.prepare('INSERT INTO stock_receipts(id,branch_id,ingredient_id,quantity_milli,total_cost_centavos,reference,actor_id,accepted_at,command_id,supplier,pack_count,pack_size_milli) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, actor.branchId, input.ingredientId, quantityMilli, input.totalCostCentavos, input.reference, actor.id, acceptedAt, input.commandId, supplier, packCount, packSizeMilli);
      recordStockMovement(this.db, {
        branchId: actor.branchId,
        ingredientId: input.ingredientId,
        quantityBeforeMilli: ingredient.onHandMilli,
        deltaMilli: quantityMilli,
        quantityAfterMilli: quantityAfter,
        kind: 'receipt',
        referenceId: id,
        commandId: input.commandId,
        acceptedAt,
        receiptCostCentavos: input.totalCostCentavos,
      });
      return {
        ingredient: this.ingredient(actor, input.ingredientId),
        ...(input.supplier !== undefined || input.packCount !== undefined || input.packSizeMilli !== undefined ? {
          receipt: {
            id,
            ingredientId: input.ingredientId,
            supplier,
            packCount,
            packSizeMilli,
            quantityMilli,
            totalCostCentavos: input.totalCostCentavos,
            reference: input.reference,
          },
        } : {}),
      };
    });
  }
  listStockCounts(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return this.counts.list(actor);
  }
  startStockCount(actor: Actor, input: StockCountStartInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.count.start', input.ingredientId, () => this.counts.start(actor, input));
  }
  observeStockCount(actor: Actor, id: string, input: StockCountObserveInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.count.observe', id, () => this.counts.observe(actor, id, input));
  }
  decideStockCount(actor: Actor, id: string, input: StockCountDecisionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.count.decide', id, () => this.counts.decide(actor, id, input));
  }
  confirmStockCountCost(actor: Actor, id: string, input: StockCountCostInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.count.confirm_cost', id, () => this.counts.confirmCost(actor, id, input));
  }
  revalueStockCount(actor: Actor, id: string, input: StockCountRevalueInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.count.revalue', id, () => this.counts.revalue(actor, id, input));
  }
  listStockAlerts(actor: Actor, input: StockAlertListInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.alerts.list(actor, input);
  }
  stockAlertHistory(actor: Actor, id: string) {
    this.permit(actor, ADMIN_ROLES);
    return this.alerts.history(actor, id);
  }
  stockThresholdHistory(actor: Actor, id: string, beforeVersion?: number) {
    this.permit(actor, ADMIN_ROLES);
    return this.alerts.thresholdHistory(actor, id, beforeVersion);
  }
  setStockThreshold(actor: Actor, ingredientId: string, input: StockThresholdInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.threshold.set', ingredientId, () => this.alerts.setThreshold(actor, ingredientId, input));
  }
  acknowledgeStockAlert(actor: Actor, id: string, input: StockAlertAcknowledgeInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'inventory.alert.acknowledge', id, () => this.alerts.acknowledge(actor, id, input));
  }
  private product(actor: Actor, id: string) {
    const row = this.db.prepare(`SELECT p.id,p.name,p.price_centavos,p.version,p.available,p.availability_version,v.options_json
      FROM products p LEFT JOIN product_versions v ON v.branch_id=p.branch_id AND v.product_id=p.id AND v.version=p.version
      WHERE p.branch_id=? AND p.id=?`).get(actor.branchId, id);
    if (!row) throw notFound();
    const recipe = this.db.prepare('SELECT ingredient_id,quantity_milli FROM product_recipe WHERE branch_id=? AND product_id=? AND version=? ORDER BY ingredient_id').all(actor.branchId, id, Number(row.version))
      .map(item => ({ ingredientId: String(item.ingredient_id), quantityMilli: Number(item.quantity_milli) }));
    const options = parseProductOptions(row.options_json);
    return {
      id: String(row.id), name: String(row.name), priceCentavos: Number(row.price_centavos),
      version: Number(row.version), available: row.available === 1, availabilityVersion: Number(row.availability_version),
      recipe, ...(hasProductOptions(options) ? { options } : {}),
    };
  }
  private validateProductSpec(actor: Actor, priceCentavos: number, recipe: RecipeLine[], input: Partial<ProductOptions>): ProductOptions {
    for (const item of recipe) this.ingredient(actor, item.ingredientId);
    const options: ProductOptions = {
      sizes: input.sizes ?? [],
      substitutions: input.substitutions ?? [],
      addons: input.addons ?? [],
      dineInPackaging: input.dineInPackaging ?? [],
      takeoutPackaging: input.takeoutPackaging ?? [],
    };
    const baseIngredients = new Set(recipe.map(r => r.ingredientId));
    for (const size of options.sizes) {
      if (monetary(exact(priceCentavos + size.priceDeltaCentavos)) <= 0) throw invalidRequest('Size price must remain positive.');
      for (const line of size.recipe) this.ingredient(actor, line.ingredientId);
    }
    for (const sub of options.substitutions) {
      if (!baseIngredients.has(sub.replaceIngredientId)) throw invalidRequest('Substitution must replace an ingredient in the base recipe.');
      this.ingredient(actor, sub.replaceIngredientId);
      this.ingredient(actor, sub.withIngredientId);
      if (monetary(exact(priceCentavos + sub.priceDeltaCentavos)) <= 0) throw invalidRequest('Substitution price must remain positive.');
      for (const size of options.sizes) {
        if (monetary(exact(priceCentavos + size.priceDeltaCentavos + sub.priceDeltaCentavos)) <= 0) {
          throw invalidRequest('Combined size and substitution price must remain positive.');
        }
      }
    }
    for (const addon of options.addons) {
      for (const line of addon.recipe) this.ingredient(actor, line.ingredientId);
    }
    for (const line of [...options.dineInPackaging, ...options.takeoutPackaging]) {
      this.ingredient(actor, line.ingredientId);
    }
    return options;
  }
  private resolveOrderLine(actor: Actor, productId: string, dineIn: boolean, selection?: LineSelection) {
    const product = this.product(actor, productId);
    const options = product.options ?? emptyOptions;
    const bom = new Map<string, number>();
    for (const item of product.recipe) bom.set(item.ingredientId, item.quantityMilli);
    let unitPriceCentavos = product.priceCentavos;
    const modifiers: string[] = [];
    if (selection?.sizeId !== undefined) {
      const size = options.sizes.find(s => s.id === selection.sizeId);
      if (!size) throw invalidRequest('Selected size is not configured for this product.');
      modifiers.push(size.name);
      unitPriceCentavos = monetary(exact(unitPriceCentavos + size.priceDeltaCentavos));
      if (unitPriceCentavos <= 0) throw invalidRequest('The resulting amount exceeds the supported range.');
      for (const line of size.recipe) bom.set(line.ingredientId, line.quantityMilli);
    }
    if (selection?.substitutionId !== undefined) {
      const sub = options.substitutions.find(s => s.id === selection.substitutionId);
      if (!sub) throw invalidRequest('Selected substitution is not configured for this product.');
      const replacedQty = bom.get(sub.replaceIngredientId);
      if (replacedQty === undefined) throw invalidRequest('Substitution target ingredient is not in the resolved recipe.');
      modifiers.push(sub.name);
      bom.delete(sub.replaceIngredientId);
      const addedQty = sub.quantityMilli ?? replacedQty;
      bom.set(sub.withIngredientId, exact((bom.get(sub.withIngredientId) ?? 0) + addedQty));
      unitPriceCentavos = monetary(exact(unitPriceCentavos + sub.priceDeltaCentavos));
      if (unitPriceCentavos <= 0) throw invalidRequest('The resulting amount exceeds the supported range.');
    }
    if (selection?.addons !== undefined) {
      for (const selected of selection.addons) {
        const addon = options.addons.find(a => a.id === selected.addonId);
        if (!addon) throw invalidRequest('Selected add-on is not configured for this product.');
        modifiers.push(`${selected.quantity}× ${addon.name}`);
        unitPriceCentavos = monetary(exact(unitPriceCentavos + exact(addon.priceDeltaCentavos * selected.quantity)));
        for (const line of addon.recipe) {
          bom.set(line.ingredientId, exact((bom.get(line.ingredientId) ?? 0) + exact(line.quantityMilli * selected.quantity)));
        }
      }
    }
    const packaging = dineIn ? options.dineInPackaging : options.takeoutPackaging;
    for (const line of packaging) {
      bom.set(line.ingredientId, exact((bom.get(line.ingredientId) ?? 0) + line.quantityMilli));
    }
    const recipe = [...bom.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ingredientId, quantityMilli]) => ({ ingredientId, quantityMilli }));
    const displayName = modifiers.length > 0 ? `${product.name} (${modifiers.join(', ')})` : product.name;
    return { product, displayName, unitPriceCentavos, recipe };
  }
  setProductAvailability(actor: Actor, id: string, input: ProductAvailabilityInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'product.availability.set', id, () => {
      const before = this.product(actor, id);
      if (before.availabilityVersion !== input.expectedVersion || before.available === input.available || before.availabilityVersion >= MAX_VERSION) throw conflict();
      this.db.prepare('UPDATE products SET available=?,availability_version=? WHERE branch_id=? AND id=?')
        .run(input.available ? 1 : 0, before.availabilityVersion + 1, actor.branchId, id);
      this.db.prepare(`INSERT INTO product_availability_events(command_id,branch_id,product_id,version,old_available,new_available,reason,actor_id,at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(input.commandId, actor.branchId, id, before.availabilityVersion + 1,
          before.available ? 1 : 0, input.available ? 1 : 0, input.reason, actor.id, this.now());
      return { product: this.product(actor, id) };
    });
  }
  private unavailableLines(actor: Actor, id: string) {
    return this.db.prepare(`SELECT l.line_no,l.product_id,l.name FROM order_lines l JOIN products p
      ON p.branch_id=l.branch_id AND p.id=l.product_id WHERE l.branch_id=? AND l.order_id=? AND l.retired=0 AND p.available=0 ORDER BY l.line_no`)
      .all(actor.branchId, id).map(row => ({ lineNo: Number(row.line_no), productId: String(row.product_id), name: String(row.name) }));
  }
  private assertAvailableOrder(actor: Actor, id: string) {
    if (this.unavailableLines(actor, id).length) throw productUnavailable('Replace unavailable items before continuing.');
  }
  private assertAvailableProduct(product: { available: boolean }) {
    if (!product.available) throw productUnavailable('This menu item is unavailable.');
  }
  createProduct(actor: Actor, input: ProductInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'product.create', input.productId, () => {
      if (this.db.prepare('SELECT id FROM products WHERE branch_id=? AND id=?').get(actor.branchId, input.productId)) throw conflict();
      const options = this.validateProductSpec(actor, input.priceCentavos, input.recipe, input);
      const optionsJson = hasProductOptions(options) ? JSON.stringify(options) : '{}';
      this.db.prepare('INSERT INTO products(branch_id,id,name,price_centavos,version) VALUES(?,?,?,?,1)').run(actor.branchId, input.productId, input.name, input.priceCentavos);
      this.db.prepare('INSERT INTO product_versions(branch_id,product_id,version,price_centavos,options_json) VALUES(?,?,1,?,?)').run(actor.branchId, input.productId, input.priceCentavos, optionsJson);
      for (const item of input.recipe) this.db.prepare('INSERT INTO product_recipe(branch_id,product_id,version,ingredient_id,quantity_milli) VALUES(?,?,1,?,?)').run(actor.branchId, input.productId, item.ingredientId, item.quantityMilli);
      return { product: this.product(actor, input.productId) };
    });
  }
  updateProductRecipe(actor: Actor, id: string, input: ProductRecipeUpdateInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'product.recipe.update', id, () => {
      const current = this.product(actor, id);
      if (current.version !== input.expectedVersion || current.version >= MAX_VERSION) throw conflict();
      const options = this.validateProductSpec(actor, input.priceCentavos, input.recipe, input);
      const optionsJson = hasProductOptions(options) ? JSON.stringify(options) : '{}';
      const nextVersion = exact(current.version + 1);
      const nextName = input.name ?? current.name;
      this.db.prepare('UPDATE products SET name=?,price_centavos=?,version=? WHERE branch_id=? AND id=?').run(nextName, input.priceCentavos, nextVersion, actor.branchId, id);
      this.db.prepare('INSERT INTO product_versions(branch_id,product_id,version,price_centavos,options_json) VALUES(?,?,?,?,?)').run(actor.branchId, id, nextVersion, input.priceCentavos, optionsJson);
      for (const item of input.recipe) {
        this.db.prepare('INSERT INTO product_recipe(branch_id,product_id,version,ingredient_id,quantity_milli) VALUES(?,?,?,?,?)').run(actor.branchId, id, nextVersion, item.ingredientId, item.quantityMilli);
      }
      return { product: this.product(actor, id) };
    });
  }
  listProducts(actor: Actor) {
    return { products: this.db.prepare('SELECT id FROM products WHERE branch_id=? ORDER BY id').all(actor.branchId).map(row => this.product(actor, String(row.id))) };
  }

  createDrawer(actor: Actor, input: DrawerInput) {
    this.permit(actor, ['owner']);
    return this.mutation(actor, input, 'drawer.create', input.drawerId, () => {
      if (this.db.prepare('SELECT id FROM drawers WHERE branch_id=? AND id=?').get(actor.branchId, input.drawerId)) throw conflict();
      for (const id of input.deviceIds) {
        const device = this.db.prepare('SELECT id FROM devices WHERE id=? AND branch_id=? AND revoked=0').get(id, actor.branchId);
        if (!device) throw notFound();
        if (this.db.prepare('SELECT device_id FROM drawer_devices WHERE device_id=?').get(id)) throw conflict();
      }
      this.db.prepare('INSERT INTO drawers(branch_id,id,name) VALUES(?,?,?)').run(actor.branchId, input.drawerId, input.name);
      for (const id of input.deviceIds) this.db.prepare('INSERT INTO drawer_devices(device_id,branch_id,drawer_id) VALUES(?,?,?)').run(id, actor.branchId, input.drawerId);
      return { drawer: { id: input.drawerId, name: input.name, deviceIds: input.deviceIds } };
    });
  }
  private drawerFor(session: Session) {
    this.permit(session.actor, ['cashier']);
    if (!session.deviceId) throw forbidden();
    const row = this.db.prepare('SELECT drawer_id FROM drawer_devices WHERE device_id=? AND branch_id=?').get(session.deviceId, session.actor.branchId);
    if (!row) throw conflict();
    return String(row.drawer_id);
  }
  private shift(actor: Actor, id: string): Row {
    const row = this.db.prepare('SELECT id,drawer_id,status,version,opening_cash_centavos,counted_cash_centavos,current_count_id FROM shifts WHERE id=? AND branch_id=?').get(id, actor.branchId);
    if (!row) throw notFound();
    return row;
  }
  private shiftProjection(row: Row) {
    return { id: String(row.id), drawerId: String(row.drawer_id), status: String(row.status), version: Number(row.version), openingCashCentavos: Number(row.opening_cash_centavos), countedCashCentavos: row.counted_cash_centavos === null ? null : Number(row.counted_cash_centavos) };
  }
  private expectedCash(actor: Actor, row: Row) {
    const cashQuery = this.db.prepare('SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM cash_movements WHERE branch_id=? AND shift_id=?');
    const refundQuery = this.db.prepare('SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM refund_cash_movements WHERE branch_id=? AND shift_id=?');
    cashQuery.setReadBigInts(true);
    refundQuery.setReadBigInts(true);
    const cash = cashQuery.get(actor.branchId,String(row.id))!.amount as bigint;
    const refunds = refundQuery.get(actor.branchId,String(row.id))!.amount as bigint;
    return monetary(Number(BigInt(Number(row.opening_cash_centavos)) + cash - refunds));
  }
  currentShift(session: Session) {
    this.permit(session.actor, ['cashier']);
    if (!session.deviceId) throw forbidden();
    const assignment = this.db.prepare('SELECT drawer_id FROM drawer_devices WHERE device_id=? AND branch_id=?').get(session.deviceId, session.actor.branchId);
    if (!assignment) return { shift: null };
    const row = this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND drawer_id=? AND status<>'closed'").get(session.actor.branchId, String(assignment.drawer_id));
    return { shift: row ? this.shiftProjection(this.shift(session.actor, String(row.id))) : null };
  }
  listAdminShifts(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    const limit = 100;
    // Read the count, status, version and cash figures from one SQLite snapshot.
    const rows = this.db.prepare(`
      WITH recent_shifts AS (
        SELECT s.id, s.branch_id, s.drawer_id, s.status, s.version, s.opening_cash_centavos,
          s.opened_at, s.current_count_id, c.counted_cash_centavos, c.submitted_at, c.note
        FROM shifts s
        LEFT JOIN shift_counts c ON c.id=s.current_count_id AND c.shift_id=s.id AND c.branch_id=s.branch_id
        WHERE s.branch_id=? AND s.status IN ('awaiting_review','recount_required','closed')
        ORDER BY c.submitted_at DESC, s.id ASC
        LIMIT ?
      )
      SELECT s.*, r.variance_centavos AS approved_variance_centavos,
        CASE WHEN s.status='closed' THEN r.expected_cash_centavos ELSE s.opening_cash_centavos + (
          SELECT COALESCE(SUM(m.amount_centavos),0) FROM cash_movements m
          WHERE m.branch_id=s.branch_id AND m.shift_id=s.id
        ) - (
          SELECT COALESCE(SUM(m.amount_centavos),0) FROM refund_cash_movements m
          WHERE m.branch_id=s.branch_id AND m.shift_id=s.id
        ) END AS expected_cash_centavos
      FROM recent_shifts s
      LEFT JOIN shift_reviews r ON s.status='closed' AND r.branch_id=s.branch_id AND r.shift_id=s.id
        AND r.count_id=s.current_count_id AND r.decision='approve'
      ORDER BY s.submitted_at DESC, s.id ASC
    `).all(actor.branchId, limit + 1);

    return {
      shifts: rows.slice(0, limit).map(row => {
        const closed = row.status === 'closed';
        if (row.submitted_at === null || row.expected_cash_centavos === null ||
            (closed && row.approved_variance_centavos === null)) {
          throw new Error('Shift review snapshot is incomplete.');
        }
        const expectedCashCentavos = monetary(Number(row.expected_cash_centavos));
        const variance = closed ? Number(row.approved_variance_centavos) : Number(row.counted_cash_centavos) - expectedCashCentavos;
        return {
          ...this.shiftProjection(row), expectedCashCentavos, varianceCentavos: exact(variance),
          openedAt: exact(Number(row.opened_at)), submittedAt: exact(Number(row.submitted_at)), note: String(row.note),
        };
      }),
      truncated: rows.length > limit,
    };
  }
  recordExpense(actor: Actor, input: ExpenseInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'expense.record', input.commandId, () => {
      const { category, description, amountCentavos, startsOn, endsOn } = input;
      const id = randomUUID();
      const recordedAt = this.now();
      this.db.prepare(`INSERT INTO operating_expenses(
        id,branch_id,category,description,amount_centavos,starts_on,ends_on,actor_id,recorded_at,command_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        id, actor.branchId, category, description, amountCentavos, startsOn, endsOn, actor.id, recordedAt, input.commandId,
      );
      this.db.prepare(`UPDATE expense_coverage_confirmations SET invalidated_by=?
        WHERE branch_id=? AND invalidated_by IS NULL AND starts_on<=? AND ends_on>=?`)
        .run(input.commandId, actor.branchId, endsOn, startsOn);
      return { expense: { id, category, description, amountCentavos, startsOn, endsOn, recordedAt } };
    });
  }
  listExpenses(actor: Actor, { from, through }: ExpensePeriodInput) {
    this.permit(actor, ADMIN_ROLES);
    const firstDay = calendarDay(from);
    const endDay = calendarDay(through) + 1;
    const limit = 100;
    const expenses: {
      id: string; category: string; description: string; amountCentavos: number;
      startsOn: string; endsOn: string; recordedAt: number; allocatedCentavos: number;
    }[] = [];
    let total = 0n;
    let truncated = false;
    const records = this.db.prepare(`SELECT id,category,description,amount_centavos,starts_on,ends_on,recorded_at
      FROM operating_expenses WHERE branch_id=? AND starts_on<=? AND ends_on>=?
      ORDER BY recorded_at DESC,id ASC`).iterate(actor.branchId, through, from);
    for (const row of records) {
      const startsOn = String(row.starts_on);
      const endsOn = String(row.ends_on);
      const start = calendarDay(startsOn);
      const end = calendarDay(endsOn) + 1;
      const days = BigInt(end - start);
      const overlapStart = BigInt(Math.max(start, firstDay) - start);
      const overlapEnd = BigInt(Math.min(end, endDay) - start);
      const amount = BigInt(Number(row.amount_centavos));
      const allocated = amount * overlapEnd / days - amount * overlapStart / days;
      total += allocated;
      if (expenses.length < limit) {
        expenses.push({
          id: String(row.id), category: String(row.category), description: String(row.description),
          amountCentavos: Number(amount), startsOn, endsOn, recordedAt: exact(Number(row.recorded_at)),
          allocatedCentavos: Number(allocated),
        });
      } else {
        truncated = true;
      }
    }
    return { from, through, allocatedCentavos: exact(Number(total)), expenses, truncated };
  }
  confirmExpenseCoverage(actor: Actor, input: ExpenseCoverageInput) {
    this.permit(actor, ADMIN_ROLES);
    const { from, through, commandId } = input;
    return this.mutation(actor, input, 'expense.coverage.confirm', from + '/' + through, () => {
      const confirmedAt = this.now();
      if (through > manilaBusinessDate(confirmedAt)) throw invalidRequest('Expense coverage cannot include future dates.');
      this.db.prepare(`INSERT INTO expense_coverage_confirmations(
        command_id,branch_id,actor_id,starts_on,ends_on,confirmed_at
      ) VALUES(?,?,?,?,?,?)`).run(commandId, actor.branchId, actor.id, from, through, confirmedAt);
      return { coverage: { from, through, confirmedAt } };
    });
  }
  listSales(actor: Actor, period: ExpensePeriodInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.store.transaction(() => salesReport(this.db, actor.branchId, period, this.listExpenses(actor, period).allocatedCentavos));
  }
  openShift(session: Session, input: ShiftOpenInput) {
    this.permit(session.actor, ['cashier']);
    return this.mutation(session.actor, input, 'shift.open', session.deviceId ?? '', () => {
      const drawer = this.drawerFor(session);
      if (this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND drawer_id=? AND status<>'closed'").get(session.actor.branchId, drawer)) throw conflict();
      const id = randomUUID();
      this.db.prepare("INSERT INTO shifts(id,branch_id,drawer_id,status,version,opening_cash_centavos,opened_by,opened_at) VALUES(?,?,?,'open',1,?,?,?)")
        .run(id, session.actor.branchId, drawer, input.openingCashCentavos, session.actor.id, this.now());
      return { shift: this.shiftProjection(this.shift(session.actor, id)) };
    });
  }
  submitCount(session: Session, id: string, input: ShiftCountInput) {
    this.permit(session.actor, ['cashier']);
    return this.mutation(session.actor, input, 'shift.submit-count', id, () => {
      const row = this.shift(session.actor, id);
      if (this.drawerFor(session) !== row.drawer_id) throw forbidden();
      this.version(row, input.expectedVersion);
      if (!['open', 'recount_required'].includes(String(row.status))) throw conflict();
      const countId = randomUUID();
      const version = exact(input.expectedVersion + 1);
      this.db.prepare('INSERT INTO shift_counts(id,branch_id,shift_id,counted_cash_centavos,note,actor_id,submitted_at,version,command_id) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(countId, session.actor.branchId, id, input.countedCashCentavos, input.note, session.actor.id, this.now(), version, input.commandId);
      this.db.prepare("UPDATE shifts SET status='awaiting_review',version=?,counted_cash_centavos=?,current_count_id=? WHERE id=? AND branch_id=?")
        .run(version, input.countedCashCentavos, countId, id, session.actor.branchId);
      return { shift: this.shiftProjection(this.shift(session.actor, id)) };
    });
  }
  reviewShift(actor: Actor, id: string, input: ShiftReviewInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'shift.review', id, () => {
      const row = this.shift(actor, id);
      this.version(row, input.expectedVersion);
      if (row.status !== 'awaiting_review' || !row.current_count_id) throw conflict();
      const expectedCashCentavos = this.expectedCash(actor, row);
      const varianceCentavos = exact(Number(row.counted_cash_centavos) - expectedCashCentavos);
      this.db.prepare('INSERT INTO shift_reviews(id,branch_id,shift_id,count_id,actor_id,decision,reviewed_at,expected_cash_centavos,variance_centavos,command_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), actor.branchId, id, String(row.current_count_id), actor.id, input.decision, this.now(), expectedCashCentavos, varianceCentavos, input.commandId);
      this.db.prepare('UPDATE shifts SET status=?,version=? WHERE id=? AND branch_id=?')
        .run(input.decision === 'approve' ? 'closed' : 'recount_required', exact(input.expectedVersion + 1), id, actor.branchId);
      return { shift: this.shiftProjection(this.shift(actor, id)), expectedCashCentavos, varianceCentavos };
    });
  }

  private version(row: Row, expected: number) { if (Number(row.version) !== expected) throw conflict(); }
  private order(actor: Actor, id: string): Row {
    const row = this.db.prepare(`SELECT id,order_no,version,dine_in,table_ref,release_policy,accepted_at,
      released_at,ready_at,preparing_at,cancelled_at,total_centavos,discount_centavos,
      customer_id,redeemed_points,loyalty_redemption_centavos FROM orders WHERE id=? AND branch_id=?`).get(id, actor.branchId);
    if (!row || (actor.role === 'barista' && row.released_at === null)) throw notFound();
    return row;
  }
  private paid(actor: Actor, id: string) {
    return exact(Number(this.db.prepare("SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM payments WHERE branch_id=? AND order_id=? AND status='confirmed'").get(actor.branchId, id)!.amount));
  }
  private pendingAmount(actor: Actor, id: string) {
    return exact(Number(this.db.prepare("SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM payments WHERE branch_id=? AND order_id=? AND status='pending'").get(actor.branchId, id)!.amount));
  }
  private paymentState(order: Row, confirmed: number, pending: number) {
    if (confirmed >= Number(order.total_centavos)) return 'paid';
    if (pending > 0) return 'pending_verification';
    return confirmed > 0 ? 'partially_paid' : 'unpaid';
  }
  private kitchenState(order: Row) {
    if (order.cancelled_at !== null) return 'cancelled';
    if (order.ready_at !== null) return 'ready';
    if (order.preparing_at !== null) return 'preparing';
    return order.released_at !== null ? 'queued' : 'not_released';
  }
  private paymentProjection(row: Row) {
    return { id: String(row.id), method: String(row.method), amountCentavos: Number(row.amount_centavos), status: String(row.status), reference: row.reference === null ? null : String(row.reference), cashReceivedCentavos: row.cash_received_centavos === null ? null : Number(row.cash_received_centavos), changeCentavos: row.change_centavos === null ? null : Number(row.change_centavos) };
  }
  private orderProjection(actor: Actor, id: string) {
    const row = this.order(actor, id);
    const paidCentavos = this.paid(actor, id);
    const pendingCentavos = this.pendingAmount(actor, id);
    const lines = this.db.prepare('SELECT line_no,product_id,name,quantity,unit_price_centavos,note FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0 ORDER BY line_no').all(actor.branchId, id)
      .map(line => ({ lineNo: Number(line.line_no), productId: String(line.product_id), name: String(line.name), quantity: Number(line.quantity), note: String(line.note), ...(actor.role !== 'barista' ? { unitPriceCentavos: Number(line.unit_price_centavos) } : {}) }));
    const released = row.released_at !== null;
    const ready = row.ready_at !== null;
    const cancelled = row.cancelled_at !== null;
    const customerId = row.customer_id === null || row.customer_id === undefined ? null : String(row.customer_id);
    const customerRow = customerId && actor.role !== 'barista'
      ? this.db.prepare('SELECT display_name FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, customerId)
      : undefined;
    const settlementRow = actor.role !== 'barista'
      ? this.db.prepare('SELECT earned_points FROM order_settlements WHERE branch_id=? AND order_id=?').get(actor.branchId, id)
      : undefined;
    const serviceState = this.setup.getOrderServiceState(actor.branchId, id);
    return { id, orderNo: Number(row.order_no), version: Number(row.version), acceptedAt: Number(row.accepted_at), releasedAt: row.released_at === null ? null : Number(row.released_at), dineIn: !!row.dine_in, table: String(row.table_ref), lines, released, ready, cancelled,
      preparing: row.preparing_at !== null && !ready && !cancelled,
      preparingAt: row.preparing_at === null ? null : Number(row.preparing_at),
      ...(serviceState.configVersion > 1 ? { configVersion: serviceState.configVersion } : {}),
      ...(serviceState.handoverAt !== null ? { handoverAt: serviceState.handoverAt } : {}),
      ...(serviceState.recalledCount > 0 ? { recalledCount: serviceState.recalledCount } : {}),
      amendment: this.amendments.latest(actor, id),
      cancellation: cancelled ? this.cancellationProjection(actor, id, paidCentavos, pendingCentavos) : null,
      paymentState: this.paymentState(row, paidCentavos, pendingCentavos),
      hasPendingPayments: pendingCentavos > 0, kitchenState: this.kitchenState(row),
      shortages: this.alerts.orderShortages(actor.branchId, id),
      unavailableLines: !released && !cancelled ? this.unavailableLines(actor, id) : [],
      ...(actor.role !== 'barista' ? { totalCentavos: Number(row.total_centavos), paidCentavos,
        refundedCentavos: exact(Number(this.db.prepare("SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM refund_legs WHERE branch_id=? AND order_id=? AND status='completed'").get(actor.branchId,id)!.amount)),
        subtotalCentavos: Number(row.total_centavos) + Number(row.discount_centavos) + Number(row.loyalty_redemption_centavos ?? 0),
        discountCentavos: Number(row.discount_centavos),
        customerId,
        customerName: customerRow ? String(customerRow.display_name) : null,
        redeemedPoints: Number(row.redeemed_points ?? 0),
        loyaltyRedemptionCentavos: Number(row.loyalty_redemption_centavos ?? 0),
        earnedPoints: settlementRow ? Number(settlementRow.earned_points ?? 0) : 0,
        loyaltyRedemptions: this.loyalty.orderRedemptions(actor, id),
        payments: this.db.prepare('SELECT id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos FROM payments WHERE branch_id=? AND order_id=? ORDER BY accepted_at,id').all(actor.branchId, id).map(item => this.paymentProjection(item)) } : {}) };
  }
  createOrder(actor: Actor, input: OrderInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.create', '', () => {
      if (input.customerId) this.loyalty.assertCustomerExists(actor.branchId, input.customerId);
      const items = input.items.map(item => ({ ...item, ...this.resolveOrderLine(actor, item.productId, input.dineIn, item) }));
      for (const item of items) this.assertAvailableProduct(item.product);
      let total = 0;
      for (const item of items) total = monetary(exact(total + exact(item.quantity * item.unitPriceCentavos)));
      const id = randomUUID();
      const orderNo = exact(Number(this.db.prepare('SELECT COALESCE(MAX(order_no),0) AS sequence FROM orders WHERE branch_id=?').get(actor.branchId)!.sequence) + 1);
      this.db.prepare('INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos,customer_id) VALUES(?,?,?,1,?,?,?,?,?,?)')
        .run(id, actor.branchId, orderNo, input.dineIn ? 1 : 0, input.table, input.dineIn ? 'explicit_send' : 'after_payment', this.now(), total, input.customerId ?? null);
      this.setup.recordOrderConfigSnapshot(actor.branchId, id);
      items.forEach((item, index) => {
        this.db.prepare('INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note,recipe_version) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(actor.branchId, id, index, item.productId, item.displayName, item.quantity, item.unitPriceCentavos, item.note, item.product.version);
        for (const ingredient of item.recipe) {
          this.db.prepare('INSERT INTO order_line_recipe(branch_id,order_id,line_no,ingredient_id,quantity_milli) VALUES(?,?,?,?,?)')
            .run(actor.branchId, id, index, ingredient.ingredientId, ingredient.quantityMilli);
        }
      });
      return { order: this.orderProjection(actor, id) };
    });
  }
  setOrderCustomer(actor: Actor, id: string, input: OrderCustomerInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.customer.set', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.cancelled_at !== null || this.paid(actor, id) > 0 || this.pendingAmount(actor, id) > 0 || Number(order.redeemed_points ?? 0) > 0) {
        throw conflict();
      }
      if (input.customerId !== null) this.loyalty.assertCustomerExists(actor.branchId, input.customerId);
      this.db.prepare(`UPDATE loyalty_redemptions SET superseded_by=?
        WHERE branch_id=? AND order_id=? AND superseded_by IS NULL AND cloud_status IN ('pending_approval','awaiting_cloud')`)
        .run(`customer-change-${input.commandId}`, actor.branchId, id);
      this.db.prepare('UPDATE orders SET customer_id=?,version=? WHERE branch_id=? AND id=?')
        .run(input.customerId, exact(input.expectedVersion + 1), actor.branchId, id);
      return { order: this.orderProjection(actor, id) };
    });
  }
  replaceUnavailable(actor: Actor, id: string, input: ReplaceUnavailableInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.replace-unavailable', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.released_at !== null || order.cancelled_at !== null) throw conflict();
      const original = this.db.prepare(`SELECT l.* FROM order_lines l JOIN products p ON p.branch_id=l.branch_id AND p.id=l.product_id
        WHERE l.branch_id=? AND l.order_id=? AND l.line_no=? AND l.retired=0 AND p.available=0`).get(actor.branchId, id, input.lineNo);
      if (!original) throw conflict();
      const resolved = this.resolveOrderLine(actor, input.productId, Boolean(order.dine_in));
      const replacement = resolved.product;
      this.assertAvailableProduct(replacement);
      const oldPrice = Number(original.unit_price_centavos);
      if (oldPrice !== resolved.unitPriceCentavos && (this.paid(actor, id) > 0 || this.pendingAmount(actor, id) > 0 || Number(order.discount_centavos) !== 0 || Number(order.loyalty_redemption_centavos ?? 0) !== 0)) throw conflict();
      const total = monetary(exact(Number(order.total_centavos) + exact((resolved.unitPriceCentavos - oldPrice) * Number(original.quantity))));
      if (total <= 0) throw conflict();
      const next = exact(Number(this.db.prepare('SELECT COALESCE(MAX(line_no),-1)+1 AS value FROM order_lines WHERE branch_id=? AND order_id=?').get(actor.branchId, id)!.value));
      if (next > MAX_VERSION) throw conflict();
      this.db.prepare('UPDATE order_lines SET retired=1 WHERE branch_id=? AND order_id=? AND line_no=?').run(actor.branchId, id, input.lineNo);
      this.db.prepare(`INSERT INTO order_lines(branch_id,order_id,line_no,product_id,name,quantity,unit_price_centavos,note,recipe_version)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(actor.branchId, id, next, replacement.id, replacement.name, Number(original.quantity), resolved.unitPriceCentavos, String(original.note), replacement.version);
      for (const ingredient of resolved.recipe) {
        this.db.prepare('INSERT INTO order_line_recipe(branch_id,order_id,line_no,ingredient_id,quantity_milli) VALUES(?,?,?,?,?)')
          .run(actor.branchId, id, next, ingredient.ingredientId, ingredient.quantityMilli);
      }
      this.db.prepare(`INSERT INTO unreleased_order_replacements(command_id,branch_id,order_id,old_line_no,new_line_no,reason,actor_id,at)
        VALUES(?,?,?,?,?,?,?,?)`).run(input.commandId, actor.branchId, id, input.lineNo, next, input.reason, actor.id, this.now());
      this.db.prepare('UPDATE orders SET total_centavos=?,version=? WHERE branch_id=? AND id=?')
        .run(total, exact(input.expectedVersion + 1), actor.branchId, id);
      if (this.db.prepare('SELECT 1 FROM order_settlements WHERE branch_id=? AND order_id=?').get(actor.branchId, id) && !this.unavailableLines(actor, id).length) {
        this.release(actor, id, input.commandId);
      }
      return { order: this.orderProjection(actor, id) };
    });
  }
  listOrders(actor: Actor, filter?: 'active' | 'ready' | 'all') {
    const status = filter ?? (actor.role === 'barista' ? 'active' : 'all');
    const rows = this.db.prepare(`SELECT o.id FROM orders o
      LEFT JOIN order_cancellations c ON c.branch_id=o.branch_id AND c.order_id=o.id
      WHERE o.branch_id=? AND (?=0 OR o.released_at IS NOT NULL)
      AND (?='all' OR (?='active' AND ((o.cancelled_at IS NULL AND o.ready_at IS NULL) OR c.status='awaiting_disposition'))
        OR (?='ready' AND ((o.cancelled_at IS NULL AND o.ready_at IS NOT NULL) OR c.status='resolved')))
      ORDER BY CASE WHEN c.status='awaiting_disposition' THEN 0 ELSE 1 END,o.accepted_at,o.order_no`)
      .all(actor.branchId, actor.role === 'barista' ? 1 : 0, status, status, status);
    return { orders: rows.map(row => this.orderProjection(actor, String(row.id))) };
  }
  getOrder(actor: Actor, id: string) { return { order: this.orderProjection(actor, id) }; }

  orderAmendmentHistory(actor: Actor, id: string) {
    this.order(actor, id);
    return { amendments: this.amendments.history(actor, id) };
  }

  listAmendmentReviews(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return { amendments: this.amendments.listReviews(actor) };
  }

  requestAmendment(actor: Actor, id: string, input: AmendmentRequestInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.amendment.request', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      return { amendment: this.amendments.request(actor, order, input) };
    });
  }

  decideAmendment(actor: Actor, id: string, input: AmendmentDecisionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'order.amendment.decide', id, () => ({
      amendment: this.amendments.decide(actor, id, input, orderId => this.order(actor, orderId)),
    }));
  }

  acknowledgeAmendment(actor: Actor, orderId: string, id: string, input: AmendmentAcknowledgeInput) {
    this.permit(actor, ['barista']);
    return this.mutation(actor, input, 'order.amendment.acknowledge', `${orderId}/${id}`, () => {
      const order = this.order(actor, orderId);
      this.version(order, input.expectedVersion);
      return { amendment: this.amendments.acknowledge(actor, order, id, input) };
    });
  }

  private approvalRows(actor: Actor, id: string | null): Row[] {
    return this.db.prepare(`
      SELECT a.*, o.order_no, o.version AS current_order_version, account.display_name AS requester_name, c.status AS cancellation_status
      FROM order_approvals a
      JOIN orders o ON o.branch_id=a.branch_id AND o.id=a.order_id
      JOIN accounts account ON account.id=a.requester_id AND account.branch_id=a.branch_id
      LEFT JOIN order_cancellations c ON c.approval_id=a.id AND c.branch_id=a.branch_id
      WHERE a.branch_id=? AND (? IS NULL OR a.id=?) AND (?=0 OR a.requester_id=?)
      ORDER BY a.rowid DESC
    `).all(actor.branchId, id, id, actor.role === 'cashier' ? 1 : 0, actor.id).map(row => ({
      ...row,
      status: deriveRequestStatus(row.decision, row.superseded_by, row.order_version, row.current_order_version),
    }));
  }

  private approvalProjection(row: Row) {
    return {
      id: String(row.id), orderId: String(row.order_id), orderNo: Number(row.order_no),
      orderVersion: Number(row.order_version), action: String(row.action),
      amountCentavos: Number(row.amount_centavos), subtotalCentavos: Number(row.subtotal_centavos),
      requesterId: String(row.requester_id), requesterName: String(row.requester_name),
      reason: String(row.reason), requestedAt: Number(row.requested_at), status: String(row.status),
      decisionReason: row.decision_reason === null ? null : String(row.decision_reason),
      decidedAt: row.decided_at === null ? null : Number(row.decided_at),
      ...(row.action === 'cancel' ? {
        requestedKitchenState: String(row.requested_kitchen_state), requestedPaymentState: String(row.requested_payment_state),
        collectedCentavos: Number(row.collected_centavos), pendingCentavos: Number(row.pending_centavos),
        cancellationStatus: row.cancellation_status,
      } : {}),
    };
  }

  listApprovals(actor: Actor) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return { approvals: this.approvalRows(actor, null).map(row => this.approvalProjection(row)) };
  }

  private discountableTotal(actor: Actor, order: Row, amount: number) {
    const total = Number(order.total_centavos);
    if (order.cancelled_at !== null || order.discount_centavos !== 0 || amount >= total || this.amendments.awaitingPrice(actor, String(order.id)) ||
        this.paid(actor, String(order.id)) !== 0 || this.pendingAmount(actor, String(order.id)) !== 0) throw conflict();
    return total;
  }

  requestApproval(session: Session, orderId: string, input: ApprovalRequestInput) {
    const actor = session.actor;
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'approval.request', orderId, () => {
      const order = this.order(actor, orderId);
      this.version(order, input.expectedVersion);
      if (order.cancelled_at !== null) throw conflict();
      const cancellation = input.action === 'cancel';
      const amount = input.action === 'discount' ? input.amountCentavos : Number(order.total_centavos);
      const subtotal = cancellation
        ? Number(order.total_centavos) + Number(order.discount_centavos) + Number(order.loyalty_redemption_centavos ?? 0)
        : this.discountableTotal(actor, order, amount);
      const confirmed = cancellation ? this.paid(actor, orderId) : null;
      const pending = cancellation ? this.pendingAmount(actor, orderId) : null;
      const id = randomUUID();
      this.db.prepare(`
        UPDATE order_approvals SET superseded_by=?
        WHERE branch_id=? AND order_id=? AND action=? AND decision IS NULL AND superseded_by IS NULL
      `).run(id, actor.branchId, orderId, input.action);
      this.db.prepare(`
        INSERT INTO order_approvals(id,branch_id,order_id,order_version,action,amount_centavos,
          subtotal_centavos,reason,requester_id,requester_device_id,requested_at,request_command_id,
          requested_kitchen_state,requested_payment_state,collected_centavos,pending_centavos)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, actor.branchId, orderId, input.expectedVersion, input.action, amount,
        subtotal, input.reason, actor.id, session.deviceId!, this.now(), input.commandId,
        cancellation ? this.kitchenState(order) : null,
        cancellation ? this.paymentState(order, confirmed!, pending!) : null, confirmed, pending);
      return { approval: this.approvalProjection(this.approvalRows(actor, id)[0]!) };
    });
  }

  decideApproval(actor: Actor, id: string, input: ApprovalDecisionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'approval.decide', id, () => {
      const request = this.approvalRows(actor, id)[0];
      if (!request) throw notFound();
      if (request.requester_id === actor.id) throw forbidden();
      if (request.status !== 'pending') throw conflict();
      if (input.decision === 'approve') {
        const order = this.order(actor, String(request.order_id));
        if (request.action === 'cancel') {
          this.cancelOrder(actor, order, id, input.commandId);
        } else {
          const discount = Number(request.amount_centavos);
          const subtotal = this.discountableTotal(actor, order, discount);
          if (subtotal !== Number(request.subtotal_centavos)) throw conflict();
          this.db.prepare('UPDATE orders SET total_centavos=?,discount_centavos=?,version=? WHERE branch_id=? AND id=?')
            .run(subtotal - discount, discount, exact(Number(request.order_version) + 1), actor.branchId, String(request.order_id));
        }
      }
      this.db.prepare(`
        UPDATE order_approvals SET decision=?,decision_reason=?,decided_at=?,reviewer_id=?,decision_command_id=?
        WHERE branch_id=? AND id=?
      `).run(input.decision, input.reason ?? null, this.now(), actor.id, input.commandId, actor.branchId, id);
      return { approval: this.approvalProjection(this.approvalRows(actor, id)[0]!) };
    });
  }

  private refundRow(actor: Actor, id: string) {
    const row = this.db.prepare(`SELECT r.*,o.order_no,o.version AS current_order_version,
      a.display_name AS requester_name FROM refund_requests r
      JOIN orders o ON o.branch_id=r.branch_id AND o.id=r.order_id
      JOIN accounts a ON a.id=r.requester_id AND a.branch_id=r.branch_id
      WHERE r.id=? AND r.branch_id=?`).get(id,actor.branchId);
    if (!row || (actor.role === 'cashier' && row.requester_id !== actor.id && row.decision !== 'approve')) throw notFound();
    return row;
  }

  private refundableTenders(actor: Actor, orderId: string) {
    return this.db.prepare(`SELECT p.id,p.method,p.amount_centavos,p.reference,
      p.amount_centavos-COALESCE((SELECT SUM(l.amount_centavos) FROM refund_legs l
        WHERE l.branch_id=p.branch_id AND l.payment_id=p.id AND l.status<>'voided'),0) AS refundable
      FROM payments p WHERE p.branch_id=? AND p.order_id=? AND p.status='confirmed'
      ORDER BY p.accepted_at,p.rowid`).all(actor.branchId,orderId).map(row => ({
        paymentId:String(row.id),method:String(row.method),amountCentavos:Number(row.amount_centavos),
        reference:row.reference===null?null:String(row.reference),refundableCentavos:exact(Number(row.refundable)),
      }));
  }

  private refundProjection(actor: Actor, id: string) {
    const row = this.refundRow(actor,id);
    const status = deriveRequestStatus(row.decision, row.superseded_by, row.order_version, row.current_order_version);
    const lines = this.db.prepare(`SELECT line_no,name,quantity,unit_price_centavos
      FROM refund_lines WHERE refund_id=? AND branch_id=? ORDER BY line_no`).all(id,actor.branchId).map(line => ({
        lineNo:Number(line.line_no),name:String(line.name),quantity:Number(line.quantity),unitPriceCentavos:Number(line.unit_price_centavos),
      }));
    const legs = this.db.prepare(`SELECT l.*,p.method FROM refund_legs l
      JOIN payments p ON p.id=l.payment_id AND p.branch_id=l.branch_id AND p.order_id=l.order_id
      WHERE l.refund_id=? AND l.branch_id=? ORDER BY l.rowid`).all(id,actor.branchId).map(leg => ({
        id:String(leg.id),paymentId:String(leg.payment_id),method:String(leg.method),amountCentavos:Number(leg.amount_centavos),
        version:Number(leg.version),status:String(leg.status),reference:leg.reference===null?null:String(leg.reference),
        note:leg.note===null?null:String(leg.note),completedAt:leg.completed_at===null?null:Number(leg.completed_at),
      }));
    return {
      id,orderId:String(row.order_id),orderNo:Number(row.order_no),orderVersion:Number(row.order_version),
      requesterId:String(row.requester_id),requesterName:String(row.requester_name),requestedAt:Number(row.requested_at),
      amountCentavos:Number(row.amount_centavos),reason:String(row.reason),status,
      decidedAt:row.decided_at===null?null:Number(row.decided_at),decisionReason:row.decision_reason===null?null:String(row.decision_reason),
      lines,tenders:this.refundableTenders(actor,String(row.order_id)),legs,
    };
  }

  listRefunds(actor: Actor) {
    this.permit(actor,['cashier',...ADMIN_ROLES]);
    const rows = this.db.prepare(`SELECT id FROM refund_requests WHERE branch_id=?
      AND (?=0 OR requester_id=? OR decision='approve') ORDER BY rowid DESC`)
      .all(actor.branchId,actor.role==='cashier'?1:0,actor.id);
    return {refunds:rows.map(row=>this.refundProjection(actor,String(row.id)))};
  }

  requestRefund(session: Session, orderId: string, input: RefundRequestInput) {
    const actor = session.actor;
    this.permit(actor,['cashier']);
    return this.mutation(actor,input,'refund.request',orderId,()=>{
      const order = this.order(actor,orderId);
      this.version(order,input.expectedVersion);
      const settled = this.db.prepare('SELECT 1 FROM order_settlements WHERE branch_id=? AND order_id=?').get(actor.branchId,orderId);
      if (!settled && order.cancelled_at===null && this.paid(actor,orderId)<Number(order.total_centavos)) throw conflict();
      const tenders = this.refundableTenders(actor,orderId);
      const capacity = tenders.reduce((sum,item)=>exact(sum+item.refundableCentavos),0);
      if (input.amountCentavos>capacity) throw conflict();
      const available = this.db.prepare('SELECT line_no,name,quantity,unit_price_centavos FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0')
        .all(actor.branchId,orderId);
      const lines = input.lineNumbers.map(number=>available.find(line=>line.line_no===number));
      if (lines.some(line=>!line)) throw invalidRequest('Select saved order items for the refund request.');
      const id = randomUUID();
      this.db.prepare(`UPDATE refund_requests SET superseded_by=? WHERE branch_id=? AND order_id=?
        AND decision IS NULL AND superseded_by IS NULL`).run(id,actor.branchId,orderId);
      this.db.prepare(`INSERT INTO refund_requests(id,branch_id,order_id,order_version,amount_centavos,reason,
        requester_id,requester_device_id,requested_at,request_command_id) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(id,actor.branchId,orderId,input.expectedVersion,input.amountCentavos,input.reason,actor.id,session.deviceId!,this.now(),input.commandId);
      for (const line of lines) {
        this.db.prepare(`INSERT INTO refund_lines(branch_id,order_id,refund_id,line_no,name,quantity,unit_price_centavos)
          VALUES(?,?,?,?,?,?,?)`).run(actor.branchId,orderId,id,Number(line!.line_no),String(line!.name),Number(line!.quantity),Number(line!.unit_price_centavos));
      }
      return {refund:this.refundProjection(actor,id)};
    });
  }

  private tenderRevenue(actor: Actor, paymentId: string): boolean | null {
    if (this.db.prepare('SELECT 1 FROM settlement_payment_links WHERE payment_id=? AND branch_id=?').get(paymentId,actor.branchId)) return true;
    const payment = this.db.prepare(`SELECT p.*,c.rowid AS creation_sequence,s.command_id AS settlement_command,
      sc.rowid AS settlement_sequence,c.response_json AS creation_response
      FROM payments p JOIN command_receipts c ON c.id=p.command_id
      LEFT JOIN order_settlements s ON s.branch_id=p.branch_id AND s.order_id=p.order_id
      LEFT JOIN command_receipts sc ON sc.id=s.command_id
      WHERE p.id=? AND p.branch_id=?`).get(paymentId,actor.branchId)!;
    if (payment.settlement_command===null) {
      const historical = this.db.prepare(`SELECT 1 FROM order_cancellations c
        JOIN order_approvals a ON a.id=c.approval_id JOIN orders o ON o.branch_id=c.branch_id AND o.id=c.order_id
        WHERE c.branch_id=? AND c.order_id=? AND a.collected_centavos>=o.total_centavos`)
        .get(actor.branchId,String(payment.order_id));
      const order = this.order(actor,String(payment.order_id));
      return historical || (order.cancelled_at===null && this.paid(actor,String(order.id))>=Number(order.total_centavos)) ? null : false;
    }
    let confirmedAtCreation = payment.method==='cash';
    if (!confirmedAtCreation) {
      try {
        const receipt = JSON.parse(String(payment.creation_response)) as {payment?:{status?:string}} | null;
        confirmedAtCreation = receipt?.payment?.status==='confirmed';
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return null;
      }
    }
    if (confirmedAtCreation) {
      return Number(payment.creation_sequence)<=Number(payment.settlement_sequence);
    }
    const verified = this.db.prepare(`SELECT rowid AS sequence FROM command_receipts
      WHERE branch_id=? AND action='order.payment.verify'
      AND CASE WHEN json_valid(response_json) THEN json_extract(response_json,'$.payment.id') ELSE NULL END=?
      ORDER BY rowid LIMIT 1`).get(actor.branchId,paymentId);
    return verified ? Number(verified.sequence)<=Number(payment.settlement_sequence) : null;
  }

  decideRefund(actor: Actor, id: string, input: RefundDecisionInput) {
    this.permit(actor,ADMIN_ROLES);
    return this.mutation(actor,input,'refund.decide',id,()=>{
      const request = this.refundRow(actor,id);
      if (request.requester_id===actor.id) throw forbidden();
      if (this.refundProjection(actor,id).status!=='pending') throw conflict();
      let loyaltyRefundCase: ReturnType<CustomersAndLoyalty['onRefundApproved']> = null;
      if (input.decision==='approve') {
        const amount = input.allocations.reduce((sum,item)=>exact(sum+item.amountCentavos),0);
        if (amount!==Number(request.amount_centavos)) throw conflict();
        const tenders = this.refundableTenders(actor,String(request.order_id));
        for (const allocation of input.allocations) {
          const tender = tenders.find(item=>item.paymentId===allocation.paymentId);
          if (!tender || allocation.amountCentavos>tender.refundableCentavos) throw conflict();
          const revenue = this.tenderRevenue(actor,allocation.paymentId);
          this.db.prepare(`INSERT INTO refund_legs(id,branch_id,order_id,refund_id,payment_id,amount_centavos,revenue_centavos)
            VALUES(?,?,?,?,?,?,?)`).run(randomUUID(),actor.branchId,String(request.order_id),id,allocation.paymentId,
              allocation.amountCentavos,revenue===null?null:revenue?allocation.amountCentavos:0);
        }
        this.bumpOrder(actor,String(request.order_id),Number(request.order_version));
        loyaltyRefundCase = this.loyalty.onRefundApproved(actor, id, String(request.order_id), amount);
      }
      this.db.prepare(`UPDATE refund_requests SET decision=?,decision_reason=?,reviewer_id=?,decided_at=?,decision_command_id=?
        WHERE id=? AND branch_id=?`).run(input.decision,input.reason??null,actor.id,this.now(),input.commandId,id,actor.branchId);
      return {
        refund: this.refundProjection(actor, id),
        ...(loyaltyRefundCase ? { loyaltyRefundCase } : {}),
      };
    });
  }

  updateRefundLeg(session: Session, refundId: string, legId: string, input: RefundLegInput) {
    const actor = session.actor;
    this.permit(actor,input.action==='record_cash'?['cashier']:ADMIN_ROLES);
    return this.mutation(actor,input,'refund.leg.'+input.action,refundId+'/'+legId,()=>{
      const request = this.refundRow(actor,refundId);
      if (request.decision!=='approve') throw conflict();
      const leg = this.db.prepare(`SELECT l.*,p.method FROM refund_legs l
        JOIN payments p ON p.id=l.payment_id AND p.branch_id=l.branch_id AND p.order_id=l.order_id
        WHERE l.id=? AND l.refund_id=? AND l.branch_id=?`).get(legId,refundId,actor.branchId);
      if (!leg) throw notFound();
      this.version(leg,input.expectedVersion);
      let status: string;
      let reference: string|null = null;
      const note = 'note' in input?input.note:null;
      if (input.action==='record_cash') {
        if (leg.method!=='cash' || leg.status!=='pending') throw conflict();
        const drawerId = this.drawerFor(session);
        const active = this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND drawer_id=? AND status='open'").get(actor.branchId,drawerId);
        if (!active) throw conflict();
        const shift = this.shift(actor,String(active.id));
        if (Number(leg.amount_centavos)>this.expectedCash(actor,shift)) throw conflict();
        this.db.prepare(`INSERT INTO refund_cash_movements(id,branch_id,shift_id,leg_id,actor_id,device_id,amount_centavos,command_id)
          VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),actor.branchId,String(shift.id),legId,actor.id,session.deviceId!,Number(leg.amount_centavos),input.commandId);
        this.db.prepare('UPDATE shifts SET version=? WHERE branch_id=? AND id=?').run(exact(Number(shift.version)+1),actor.branchId,String(shift.id));
        status='completed';
      } else if (input.action==='void') {
        if (!(leg.method==='cash' && leg.status==='pending') && !(leg.method!=='cash' && leg.status==='failed')) throw conflict();
        status='voided';
      } else {
        if (leg.method==='cash') throw conflict();
        if (input.action==='retry') {
          if (leg.status!=='failed') throw conflict();
          status='pending';
        } else if (input.action==='mark_unknown') {
          if (leg.status!=='pending') throw conflict();
          status='unknown';
        } else {
          if (leg.status!=='pending' && leg.status!=='unknown') throw conflict();
          status=input.action==='confirm_external'?'completed':'failed';
          if (input.action==='confirm_external') {
            reference=input.reference;
            if (this.db.prepare('SELECT 1 FROM external_refund_references WHERE branch_id=? AND method=? AND reference=?')
              .get(actor.branchId,String(leg.method),reference)) throw conflict();
            this.db.prepare('INSERT INTO external_refund_references(branch_id,method,reference,leg_id) VALUES(?,?,?,?)')
              .run(actor.branchId,String(leg.method),reference,legId);
          }
        }
      }
      const time = this.now();
      this.db.prepare(`UPDATE refund_legs SET status=?,version=?,reference=?,note=?,completed_at=?,completion_command_id=?
        WHERE id=? AND branch_id=?`).run(status,exact(input.expectedVersion+1),reference,note,status==='completed'?time:null,
          status==='completed'?input.commandId:null,legId,actor.branchId);
      this.db.prepare(`INSERT INTO refund_leg_events(command_id,branch_id,leg_id,version,action,reference,note,actor_id,accepted_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(input.commandId,actor.branchId,legId,exact(input.expectedVersion+1),input.action,reference,note,actor.id,time);
      if (status==='completed' || status==='voided') {
        const order = this.order(actor,String(leg.order_id));
        this.bumpOrder(actor,String(leg.order_id),Number(order.version));
      }
      return {refund:this.refundProjection(actor,refundId)};
    });
  }

  private cancelOrder(actor: Actor, order: Row, approvalId: string, commandId: string) {
    if (order.cancelled_at !== null) throw conflict();
    const orderId = String(order.id);
    const time = this.now();
    const unreleased = order.released_at === null;
    this.db.prepare(`INSERT INTO order_cancellations
      (branch_id,order_id,approval_id,cancelled_at,status,outcome,disposition_note,resolved_at,resolved_by,resolution_command_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      actor.branchId, orderId, approvalId, time, unreleased ? 'resolved' : 'awaiting_disposition',
      unreleased ? 'unprepared' : null, unreleased ? 'Order cancelled before release.' : null,
      unreleased ? time : null, unreleased ? actor.id : null, unreleased ? commandId : null,
    );
    this.amendments.supersede(actor, orderId);
    this.loyalty.restoreRedemptionOnCancel(actor, order, commandId);
    this.db.prepare('UPDATE orders SET cancelled_at=?,version=? WHERE branch_id=? AND id=?')
      .run(time, exact(Number(order.version) + 1), actor.branchId, orderId);
  }

  private cancellationRecipe(actor: Actor, id: string) {
    return this.db.prepare(`SELECT r.ingredient_id, i.name, i.unit, r.quantity_milli
      FROM reservations r JOIN ingredients i ON i.branch_id=r.branch_id AND i.id=r.ingredient_id
      WHERE r.branch_id=? AND r.order_id=? ORDER BY i.name,i.id`).all(actor.branchId, id)
      .map(row => ({ ingredientId: String(row.ingredient_id), name: String(row.name), unit: String(row.unit), quantityMilli: Number(row.quantity_milli) }));
  }

  private cancellationProjection(actor: Actor, id: string, confirmed: number, pending: number) {
    const row = this.db.prepare(`SELECT c.*,a.reason FROM order_cancellations c
      JOIN order_approvals a ON a.id=c.approval_id AND a.branch_id=c.branch_id AND a.order_id=c.order_id
      WHERE c.branch_id=? AND c.order_id=?`).get(actor.branchId, id)!;
    const actualUsed = this.db.prepare(`SELECT w.ingredient_id,i.name,i.unit,w.quantity_milli
      FROM cancellation_waste c JOIN waste_entries w ON w.branch_id=c.branch_id AND w.id=c.waste_id
      JOIN ingredients i ON i.branch_id=w.branch_id AND i.id=w.ingredient_id
      WHERE c.branch_id=? AND c.order_id=? ORDER BY i.name,i.id`).all(actor.branchId, id)
      .map(item => ({ ingredientId: String(item.ingredient_id), name: String(item.name), unit: String(item.unit), quantityMilli: Number(item.quantity_milli) }));
    return {
      approvalId: String(row.approval_id), reason: String(row.reason), status: row.status,
      cancelledAt: Number(row.cancelled_at), resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
      outcome: row.outcome, dispositionNote: row.disposition_note,
      recipe: this.cancellationRecipe(actor, id), actualUsed,
      ...(actor.role !== 'barista' ? { confirmedPaymentCentavos: confirmed, pendingPaymentCentavos: pending } : {}),
    };
  }

  resolveCancellation(actor: Actor, id: string, input: CancellationDispositionInput) {
    this.permit(actor, ['barista']);
    return this.mutation(actor, input, 'order.cancellation.disposition', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      const cancellation = this.db.prepare('SELECT status FROM order_cancellations WHERE branch_id=? AND order_id=?')
        .get(actor.branchId, id);
      if (cancellation?.status !== 'awaiting_disposition' ||
          (order.ready_at !== null) !== (input.outcome === 'already_consumed') ||
          (input.used.length > 0) !== (input.outcome === 'used')) throw conflict();
      const recipe = new Set(this.cancellationRecipe(actor, id).map(item => item.ingredientId));
      if (input.used.some(item => !recipe.has(item.ingredientId))) throw invalidRequest('Record ingredients from the order recipe.');
      for (const item of input.used) {
        const waste = this.postWaste(actor, { ...item, commandId: input.commandId, reason: 'Cancelled preparation', note: input.note });
        this.db.prepare('INSERT INTO cancellation_waste(branch_id,order_id,waste_id) VALUES(?,?,?)')
          .run(actor.branchId, id, waste.id);
      }
      this.db.prepare('UPDATE reservations SET released=1 WHERE branch_id=? AND order_id=? AND consumed=0').run(actor.branchId, id);
      this.db.prepare(`UPDATE order_cancellations SET status='resolved',outcome=?,disposition_note=?,
        resolved_at=?,resolved_by=?,resolution_command_id=? WHERE branch_id=? AND order_id=?`)
        .run(input.outcome, input.note, this.now(), actor.id, input.commandId, actor.branchId, id);
      this.bumpOrder(actor, id, input.expectedVersion);
      return { order: this.orderProjection(actor, id) };
    });
  }

  startPreparation(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['barista']);
    return this.mutation(actor, input, 'order.prepare', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.cancelled_at !== null || order.ready_at !== null || this.amendments.awaitingStation(actor, id)) throw conflict();
      if (order.preparing_at === null) {
        this.db.prepare('UPDATE orders SET preparing_at=? WHERE branch_id=? AND id=?').run(this.now(), actor.branchId, id);
        this.bumpOrder(actor, id, input.expectedVersion);
      }
      return { order: this.orderProjection(actor, id) };
    });
  }

  private release(actor: Actor, id: string, commandId: string) {
    const row = this.order(actor, id);
    if (row.cancelled_at !== null) throw conflict();
    if (row.released_at !== null) return;
    this.assertAvailableOrder(actor, id);
    const required = new Map<string, number>();
    const lines = this.db.prepare('SELECT line_no,product_id,quantity FROM order_lines WHERE branch_id=? AND order_id=? AND retired=0 ORDER BY line_no').all(actor.branchId, id);
    for (const line of lines) {
      const lineNo = Number(line.line_no);
      let recipe = this.db.prepare('SELECT ingredient_id,quantity_milli FROM order_line_recipe WHERE branch_id=? AND order_id=? AND line_no=? ORDER BY ingredient_id')
        .all(actor.branchId, id, lineNo)
        .map(item => ({ ingredientId: String(item.ingredient_id), quantityMilli: Number(item.quantity_milli) }));
      if (recipe.length === 0) {
        const product = this.product(actor, String(line.product_id));
        this.db.prepare('UPDATE order_lines SET recipe_version=? WHERE branch_id=? AND order_id=? AND line_no=?').run(product.version, actor.branchId, id, lineNo);
        recipe = product.recipe;
        for (const ingredient of recipe) {
          this.db.prepare('INSERT INTO order_line_recipe(branch_id,order_id,line_no,ingredient_id,quantity_milli) VALUES(?,?,?,?,?)').run(actor.branchId, id, lineNo, ingredient.ingredientId, ingredient.quantityMilli);
        }
      }
      for (const ingredient of recipe) {
        required.set(ingredient.ingredientId, exact((required.get(ingredient.ingredientId) ?? 0) + exact(ingredient.quantityMilli * Number(line.quantity))));
      }
    }
    for (const [ingredientId, quantity] of required) {
      const item = this.ingredient(actor, ingredientId);
      exact(item.reservedMilli + quantity);
      this.db.prepare('INSERT INTO reservations(branch_id,order_id,ingredient_id,quantity_milli) VALUES(?,?,?,?)').run(actor.branchId, id, ingredientId, quantity);
      const estimate = item.onHandMilli - item.reservedMilli < quantity
        ? null : estimateRemovalCost(this.db, actor.branchId, ingredientId, item.onHandMilli, quantity);
      this.db.prepare('INSERT INTO order_recipe_valuation_estimates(branch_id,order_id,ingredient_id,cost_microcentavos) VALUES(?,?,?,?)')
        .run(actor.branchId, id, ingredientId, estimate);
    }
    this.db.prepare('UPDATE orders SET released_at=? WHERE branch_id=? AND id=?').run(this.now(), actor.branchId, id);
    const labelJobId = randomUUID();
    this.db.prepare("INSERT INTO print_jobs(id,branch_id,order_id,type,command_id) VALUES(?,?,?,'label',?)").run(labelJobId, actor.branchId, id, commandId);
    this.setup.onPrintJobCreated(actor, labelJobId, id, 'label', commandId);
  }
  sendOrder(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.send', id, () => {
      const row = this.order(actor, id);
      this.version(row, input.expectedVersion);
      if (row.cancelled_at !== null) throw conflict();
      if (!row.dine_in && this.paid(actor, id) < Number(row.total_centavos)) throw conflict();
      if (row.released_at === null) {
        this.release(actor, id, input.commandId);
        this.bumpOrder(actor, id, input.expectedVersion);
      }
      return { order: this.orderProjection(actor, id) };
    });
  }
  private bumpOrder(actor: Actor, id: string, expected: number) {
    this.db.prepare('UPDATE orders SET version=? WHERE id=? AND branch_id=?').run(exact(expected + 1), id, actor.branchId);
  }
  private settlement(actor: Actor, id: string, commandId: string) {
    const order = this.order(actor, id);
    if (order.cancelled_at !== null) return;
    const total = Number(order.total_centavos);
    if (this.paid(actor, id) !== total) return;
    const settledAt = this.now();
    this.db.prepare('INSERT INTO order_settlements(branch_id,order_id,settled_at,business_date,total_centavos,command_id,discount_centavos) VALUES(?,?,?,?,?,?,?)')
      .run(actor.branchId, id, settledAt, manilaBusinessDate(settledAt), total, commandId, Number(order.discount_centavos));
    this.loyalty.recordSettlementEarning(actor, order, settledAt, commandId);
    this.db.prepare(`INSERT INTO settlement_payment_links(payment_id,branch_id,order_id)
      SELECT id,branch_id,order_id FROM payments WHERE branch_id=? AND order_id=? AND status='confirmed'`).run(actor.branchId,id);
    if (!this.unavailableLines(actor, id).length) this.release(actor, id, commandId);
  }
  addPayment(session: Session, id: string, input: PaymentInput) {
    const actor = session.actor;
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.payment', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.cancelled_at !== null || this.amendments.awaitingPrice(actor, id)) throw conflict();
      if (order.released_at === null) this.assertAvailableOrder(actor, id);
      const remainder = Number(order.total_centavos) - this.paid(actor, id);
      if (remainder <= 0 || (input.verified && input.amountCentavos > remainder)) throw conflict();
      const confirmed = input.method === 'cash' || input.verified;
      let shift: Row | undefined;
      if (input.method === 'cash') {
        const drawerId = this.drawerFor(session);
        const current = this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND drawer_id=? AND status='open'").get(actor.branchId, drawerId);
        if (!current) throw conflict();
        shift = this.shift(actor, String(current.id));
        monetary(this.expectedCash(actor, shift) + input.amountCentavos);
      } else if (this.db.prepare("SELECT id FROM payments WHERE branch_id=? AND method=? AND reference=? AND status<>'rejected'").get(actor.branchId, input.method, input.reference ?? '')) throw conflict();
      const paymentId = randomUUID();
      const received = input.method === 'cash' ? input.cashReceivedCentavos! : null;
      const change = received === null ? null : monetary(received - input.amountCentavos);
      this.db.prepare('INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos,accepted_at,command_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(paymentId, actor.branchId, id, input.method, input.amountCentavos, confirmed ? 'confirmed' : 'pending', input.method === 'cash' ? null : input.reference!, received, change, this.now(), input.commandId);
      if (shift) {
        this.db.prepare('INSERT INTO cash_movements(id,branch_id,shift_id,payment_id,actor_id,device_id,amount_centavos,command_id) VALUES(?,?,?,?,?,?,?,?)')
          .run(randomUUID(), actor.branchId, String(shift.id), paymentId, actor.id, session.deviceId!, input.amountCentavos, input.commandId);
        this.db.prepare('UPDATE shifts SET version=? WHERE id=? AND branch_id=?').run(exact(Number(shift.version) + 1), String(shift.id), actor.branchId);
      }
      this.settlement(actor, id, input.commandId);
      this.bumpOrder(actor, id, input.expectedVersion);
      const payment = this.db.prepare('SELECT id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos FROM payments WHERE id=? AND branch_id=?').get(paymentId, actor.branchId)!;
      return { order: this.orderProjection(actor, id), payment: this.paymentProjection(payment) };
    });
  }
  private pendingPayment(actor: Actor, orderId: string, paymentId: string): Row {
    const row = this.db.prepare('SELECT id,method,amount_centavos,status,reference,cash_received_centavos,change_centavos FROM payments WHERE id=? AND order_id=? AND branch_id=?').get(paymentId, orderId, actor.branchId);
    if (!row) throw notFound();
    if (row.status !== 'pending' || row.method === 'cash') throw conflict();
    return row;
  }
  verifyPayment(session: Session, id: string, paymentId: string, input: VersionInput) {
    const actor = session.actor;
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.payment.verify', id + '/' + paymentId, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      const row = this.pendingPayment(actor, id, paymentId);
      const confirmed = exact(Number(row.amount_centavos) + this.paid(actor, id));
      if (order.cancelled_at === null && confirmed > Number(order.total_centavos)) throw conflict();
      this.db.prepare("UPDATE payments SET status='confirmed' WHERE id=? AND order_id=? AND branch_id=?").run(paymentId, id, actor.branchId);
      this.settlement(actor, id, input.commandId);
      this.bumpOrder(actor, id, input.expectedVersion);
      return { order: this.orderProjection(actor, id), payment: this.paymentProjection({ ...row, status: 'confirmed' }) };
    });
  }
  rejectPayment(session: Session, id: string, paymentId: string, input: PaymentRejectInput) {
    const actor = session.actor;
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.payment.reject', id + '/' + paymentId, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      const row = this.pendingPayment(actor, id, paymentId);
      this.db.prepare("UPDATE payments SET status='rejected',rejection_reason=? WHERE id=? AND order_id=? AND branch_id=?").run(input.reason, paymentId, id, actor.branchId);
      this.bumpOrder(actor, id, input.expectedVersion);
      return { order: this.orderProjection(actor, id), payment: this.paymentProjection({ ...row, status: 'rejected' }) };
    });
  }
  markReady(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['barista']);
    return this.mutation(actor, input, 'order.ready', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.released_at === null || order.cancelled_at !== null || this.amendments.awaitingStation(actor, id)) throw conflict();
      if (order.ready_at === null) {
        this.alerts.recordShortages(actor, id, input.commandId, 'order.ready');
        const entries = this.db.prepare('SELECT ingredient_id,quantity_milli FROM reservations WHERE branch_id=? AND order_id=? AND consumed=0 AND released=0').all(actor.branchId, id);
        const acceptedAt = this.now();
        for (const item of entries) {
          const ingredientId = String(item.ingredient_id);
          const quantity = Number(item.quantity_milli);
          const ingredient = this.ingredient(actor, ingredientId);
          const quantityAfter = exact(ingredient.onHandMilli - quantity);
          recordStockMovement(this.db, {
            branchId: actor.branchId,
            ingredientId,
            quantityBeforeMilli: ingredient.onHandMilli,
            deltaMilli: -quantity,
            quantityAfterMilli: quantityAfter,
            kind: 'consumption',
            referenceId: id,
            commandId: input.commandId,
            acceptedAt,
          });
        }
        this.db.prepare('UPDATE reservations SET consumed=1 WHERE branch_id=? AND order_id=? AND released=0').run(actor.branchId, id);
        this.db.prepare('UPDATE orders SET ready_at=?,version=? WHERE branch_id=? AND id=?').run(acceptedAt, exact(input.expectedVersion + 1), actor.branchId, id);
      }
      return { order: this.orderProjection(actor, id) };
    });
  }
  requestReceipt(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'order.receipt', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      if (order.cancelled_at !== null || this.paid(actor, id) !== Number(order.total_centavos)) throw conflict();
      let job = this.db.prepare("SELECT id FROM print_jobs WHERE branch_id=? AND order_id=? AND type='receipt'").get(actor.branchId, id);
      if (!job) {
        const jobId = randomUUID();
        this.db.prepare("INSERT INTO print_jobs(id,branch_id,order_id,type,command_id) VALUES(?,?,?,'receipt',?)").run(jobId, actor.branchId, id, input.commandId);
        job = { id: jobId };
      }
      this.setup.onPrintJobCreated(actor, String(job.id), id, 'receipt', input.commandId);
      return { job: this.setup.getReceiptJobResponse(actor.branchId, String(job.id), id) };
    });
  }
  handoverOrder(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['barista', 'cashier']);
    return this.mutation(actor, input, 'order.handover', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      this.setup.handoverOrder(actor, order);
      this.bumpOrder(actor, id, input.expectedVersion);
      return { order: this.orderProjection(actor, id) };
    });
  }
  recallOrder(actor: Actor, id: string, input: VersionInput) {
    this.permit(actor, ['barista', 'cashier']);
    return this.mutation(actor, input, 'order.recall', id, () => {
      const order = this.order(actor, id);
      this.version(order, input.expectedVersion);
      this.setup.recallOrder(actor, order);
      this.bumpOrder(actor, id, input.expectedVersion);
      return { order: this.orderProjection(actor, id) };
    });
  }
  listWasteEntries(actor: Actor) {
    this.permit(actor, ['barista', ...ADMIN_ROLES]);
    return this.setup.listWasteEntries(actor);
  }
  correctWasteEntry(actor: Actor, id: string, input: WasteCorrectionInput) {
    this.permit(actor, ['barista', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'inventory.waste.correct', id, () => this.setup.correctWasteEntry(actor, id, input));
  }
  listAccounts(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return this.setup.listAccounts(actor);
  }
  createAccount(actor: Actor, input: AccountCreateInput, credentialHash: string) {
    this.permit(actor, ['owner']);
    const redactedInput = { ...input, secret: digest(input.secret) };
    return this.mutation(actor, redactedInput, 'account.create', input.accountId, () => this.setup.createAccount(actor, input, credentialHash));
  }
  updateAccount(actor: Actor, id: string, input: AccountUpdateInput, credentialHash?: string) {
    this.permit(actor, ['owner']);
    const redactedInput = { ...input, ...(input.secret !== undefined ? { secret: digest(input.secret) } : {}) };
    return this.mutation(actor, redactedInput, 'account.update', id, () => this.setup.updateAccount(actor, id, input, credentialHash));
  }
  enrollDevice(actor: Actor, input: DeviceCreateInput) {
    this.permit(actor, ['owner']);
    const redactedInput = { ...input, secret: digest(input.secret) };
    return this.mutation(actor, redactedInput, 'device.enroll', input.deviceId, () => this.setup.enrollDevice(actor, input));
  }
  getHubInfo() {
    return this.setup.getHubInfo();
  }
  createDevicePairingCode(actor: Actor, id: string, input: DevicePairingCreateInput) {
    this.permit(actor, ['owner']);
    return this.mutation(actor, input, 'device.pair.create', id, () => this.setup.createDevicePairingCode(actor, id, input));
  }
  claimDevicePairingCode(input: DevicePairingClaimInput, clientIp: string) {
    return this.store.transaction(() => this.setup.claimDevicePairingCode(input, clientIp));
  }
  getBranchConfig(actor: Actor) {
    this.permit(actor, ['cashier', 'barista', ...ADMIN_ROLES]);
    return this.setup.getBranchConfig(actor);
  }
  updateBranchConfig(actor: Actor, input: BranchConfigInput) {
    this.permit(actor, ['owner']);
    return this.mutation(actor, input, 'branch.config.update', actor.branchId, () => this.setup.updateBranchConfig(actor, input));
  }
  getPrinterAdapters(actor: Actor) {
    this.permit(actor, ['cashier', 'barista', ...ADMIN_ROLES]);
    return this.setup.getPrinterAdapters(actor);
  }
  setPrinterAdapterMode(actor: Actor, input: PrinterAdapterModeInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'printer.mode.set', input.type, () => this.setup.setPrinterAdapterMode(actor, input));
  }
  listPrintJobs(actor: Actor, orderId?: string) {
    this.permit(actor, ['cashier', 'barista', ...ADMIN_ROLES]);
    return this.setup.listPrintJobs(actor, orderId);
  }
  retryPrintJob(actor: Actor, id: string, input: PrintJobRetryInput) {
    this.permit(actor, ['cashier', 'barista', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'print-job.' + input.action, id, () => this.setup.retryPrintJob(actor, id, input));
  }
  previewCsv(actor: Actor, input: CsvPreviewInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.setup.previewCsv(actor, input);
  }
  importCsv(actor: Actor, input: CsvImportInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'csv.import', input.kind, () => this.setup.importCsv(actor, input));
  }
  listCsvImports(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return this.setup.listCsvImports(actor);
  }
  exportCsv(actor: Actor, query: CsvExportQueryInput) {
    return this.setup.exportCsv(actor, query);
  }
  getSyncStatus(actor: Actor) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.setup.getSyncStatus(actor);
  }
  setSyncMode(actor: Actor, input: SyncModeInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'sync.mode.set', actor.branchId, () => this.setup.setSyncMode(actor, input));
  }
  pushOutboxSync(actor: Actor, input: SyncPushInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'sync.push', actor.branchId, () => this.setup.pushOutboxSync(actor));
  }
  ingestSyncEnvelopes(actor: Actor, input: SyncIngestInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'sync.ingest', actor.branchId, () => this.setup.ingestSyncEnvelopes(actor, input));
  }
  resolveSyncConflict(actor: Actor, id: string, input: SyncConflictResolveInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'sync.conflict.resolve', id, () => this.setup.resolveSyncConflict(actor, id, input));
  }
  exportBackup(actor: Actor) {
    this.permit(actor, ['owner']);
    return this.setup.exportBackup(actor);
  }
  restoreBackup(actor: Actor, input: BackupRestoreInput) {
    this.permit(actor, ['owner']);
    const redactedInput = { commandId: input.commandId, checksum: typeof input.backup.checksum === 'string' ? input.backup.checksum : '' };
    return this.mutation(actor, redactedInput, 'backup.restore', actor.branchId, () => this.setup.restoreBackup(actor, input));
  }
  logWaste(actor: Actor, input: WasteInput) {
    this.permit(actor, ['barista']);
    return this.mutation(actor, input, 'inventory.waste', input.ingredientId, () => ({ waste: this.postWaste(actor, input) }));
  }
  private postWaste(actor: Actor, input: WasteInput) {
    const ingredient = this.ingredient(actor, input.ingredientId);
    const quantityAfter = exact(ingredient.onHandMilli - input.quantityMilli);
    const id = randomUUID();
    const time = this.now();
    this.db.prepare('INSERT INTO waste_entries(id,branch_id,ingredient_id,quantity_milli,reason,note,actor_id,accepted_at,command_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, actor.branchId, input.ingredientId, input.quantityMilli, input.reason, input.note, actor.id, time, input.commandId);
    recordStockMovement(this.db, {
      branchId: actor.branchId,
      ingredientId: input.ingredientId,
      quantityBeforeMilli: ingredient.onHandMilli,
      deltaMilli: -input.quantityMilli,
      quantityAfterMilli: quantityAfter,
      kind: 'waste',
      referenceId: id,
      commandId: input.commandId,
      acceptedAt: time,
    });
    return { id, ingredientId: input.ingredientId, quantityMilli: input.quantityMilli, reason: input.reason, note: input.note };
  }

  getCustomerPolicy(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return { policy: this.loyalty.getPolicy(actor) };
  }
  updateCustomerPolicy(actor: Actor, input: CustomerPolicyInput) {
    this.permit(actor, ['owner']);
    return this.mutation(actor, input, 'customer.policy.update', actor.branchId, () => this.loyalty.updatePolicy(actor, input));
  }
  listCustomers(actor: Actor, query: CustomerListInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.loyalty.listCustomers(actor, query);
  }
  createCustomer(actor: Actor, input: CustomerCreateInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'customer.create', input.customerId ?? '', () => this.loyalty.createCustomer(actor, input));
  }
  updateCustomer(actor: Actor, id: string, input: CustomerUpdateInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'customer.update', id, () => this.loyalty.updateCustomer(actor, id, input));
  }
  getCustomerProfile(actor: Actor, id: string) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.loyalty.getCustomerProfile(actor, id);
  }
  getLoyaltyCloudState(actor: Actor) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return { cloudState: this.loyalty.getCloudState(actor) };
  }
  setLoyaltyCloudMode(actor: Actor, input: LoyaltyCloudModeInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'loyalty.cloud-mode', actor.branchId, () => this.loyalty.setCloudMode(actor, input));
  }
  syncPendingLoyalty(actor: Actor, input: LoyaltySyncInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'loyalty.sync', actor.branchId, () => this.loyalty.syncPendingLoyalty(actor));
  }
  listLoyaltyRedemptions(actor: Actor) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.loyalty.listRedemptions(actor);
  }
  requestLoyaltyRedemption(session: Session, orderId: string, input: LoyaltyRedeemRequestInput) {
    const actor = session.actor;
    this.permit(actor, ['cashier']);
    return this.mutation(actor, input, 'loyalty.redeem.request', orderId, () => {
      const order = this.order(actor, orderId);
      this.version(order, input.expectedVersion);
      return this.loyalty.requestRedemption(
        session,
        order,
        this.paid(actor, orderId),
        this.pendingAmount(actor, orderId),
        this.amendments.awaitingPrice(actor, orderId),
        input,
      );
    });
  }
  decideLoyaltyRedemption(actor: Actor, id: string, input: LoyaltyRedeemDecisionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'loyalty.redeem.decide', id, () => this.loyalty.decideRedemption(actor, id, input));
  }
  validateLoyaltyRedemptionCloud(actor: Actor, id: string, input: LoyaltyRedeemCloudValidateInput) {
    this.permit(actor, ['cashier', ...ADMIN_ROLES]);
    return this.mutation(actor, input, 'loyalty.redeem.validate-cloud', id, () => {
      const res = this.loyalty.validateRedemptionCloud(
        actor,
        id,
        input,
        orderId => ({
          order: this.order(actor, orderId),
          paidCentavos: this.paid(actor, orderId),
          pendingCentavos: this.pendingAmount(actor, orderId),
        }),
        (orderId, commandId) => this.settlement(actor, orderId, commandId),
      );
      return { ...res, order: this.orderProjection(actor, res.redemption.orderId) };
    });
  }
  reconcileLoyaltyRedemptionCloud(actor: Actor, id: string, input: LoyaltyRedeemCloudReconcileInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'loyalty.redeem.reconcile-cloud', id, () => {
      const res = this.loyalty.reconcileRedemptionCloud(
        actor,
        id,
        input,
        orderId => ({
          order: this.order(actor, orderId),
          paidCentavos: this.paid(actor, orderId),
          pendingCentavos: this.pendingAmount(actor, orderId),
        }),
        (orderId, commandId) => this.settlement(actor, orderId, commandId),
      );
      return { ...res, order: this.orderProjection(actor, res.redemption.orderId) };
    });
  }
  listLoyaltyRefundCases(actor: Actor) {
    this.permit(actor, ADMIN_ROLES);
    return this.loyalty.listRefundCases(actor);
  }
  decideLoyaltyRefundCase(actor: Actor, id: string, input: LoyaltyRefundCaseDecisionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'loyalty.refund-case.decide', id, () => this.loyalty.decideRefundCase(actor, id, input));
  }
  resolveLoyaltyRefundCaseException(actor: Actor, id: string, input: LoyaltyRefundCaseExceptionInput) {
    this.permit(actor, ADMIN_ROLES);
    return this.mutation(actor, input, 'loyalty.refund-case.resolve-exception', id, () => this.loyalty.resolveRefundCaseException(actor, id, input));
  }
}
