import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Actor, Session } from './identity.js';
import { conflict, exact as safeExact, forbidden, invalidRequest, notFound } from './errors.js';
import { ADMIN_ROLES, MAX_VERSION } from './validation.js';
import { deriveRequestStatus } from './inventory_valuation.js';
import { manilaBusinessDate } from './sales_report.js';
import type {
  CustomerCreateInput,
  CustomerListInput,
  CustomerPolicyInput,
  CustomerUpdateInput,
  LoyaltyCloudModeInput,
  LoyaltyRedeemCloudReconcileInput,
  LoyaltyRedeemCloudValidateInput,
  LoyaltyRedeemDecisionInput,
  LoyaltyRedeemRequestInput,
  LoyaltyRefundCaseDecisionInput,
  LoyaltyRefundCaseExceptionInput,
} from './business_validation.js';

type Row = Record<string, unknown>;
const exact = (value: number) => safeExact(value, 'The resulting amount exceeds the supported range.');
const calendarDay = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
const isAdminRole = (role: Actor['role']) => (ADMIN_ROLES as readonly string[]).includes(role);

export class CustomersAndLoyalty {
  constructor(private db: DatabaseSync, private now: () => number) {}

  private ensurePolicy(branchId: string): Row {
    let row = this.db.prepare('SELECT * FROM customer_policies WHERE branch_id=?').get(branchId);
    if (!row) {
      this.db.prepare(`INSERT INTO customer_policies(branch_id,version,inactivity_days,vip_rule,vip_threshold,points_expiry_days)
        VALUES(?,1,30,'unconfigured',NULL,NULL)`).run(branchId);
      row = this.db.prepare('SELECT * FROM customer_policies WHERE branch_id=?').get(branchId)!;
    }
    return row;
  }

  private ensureCloudState(branchId: string): Row {
    let row = this.db.prepare('SELECT * FROM branch_cloud_state WHERE branch_id=?').get(branchId);
    if (!row) {
      const time = this.now();
      this.db.prepare(`INSERT INTO branch_cloud_state(branch_id,loyalty_cloud_mode,last_synced_at,updated_at)
        VALUES(?,'online',?,?)`).run(branchId, time, time);
      row = this.db.prepare('SELECT * FROM branch_cloud_state WHERE branch_id=?').get(branchId)!;
    }
    return row;
  }

  getPolicy(actor: Actor) {
    const row = this.ensurePolicy(actor.branchId);
    return {
      version: Number(row.version),
      inactivityDays: Number(row.inactivity_days),
      vipRule: String(row.vip_rule) as 'unconfigured' | 'lifetime_spend' | 'purchase_count',
      vipThreshold: row.vip_threshold === null ? null : Number(row.vip_threshold),
      vipConfigured: row.vip_rule !== 'unconfigured' && row.vip_threshold !== null,
      pointsExpiryDays: row.points_expiry_days === null ? null : Number(row.points_expiry_days),
      updatedBy: row.updated_by === null ? null : String(row.updated_by),
      updatedAt: row.updated_at === null ? null : Number(row.updated_at),
    };
  }

  updatePolicy(actor: Actor, input: CustomerPolicyInput) {
    if (actor.role !== 'owner') throw forbidden();
    const current = this.ensurePolicy(actor.branchId);
    if (Number(current.version) !== input.expectedVersion || Number(current.version) >= MAX_VERSION) throw conflict();
    const nextVersion = exact(Number(current.version) + 1);
    const time = this.now();
    this.db.prepare(`UPDATE customer_policies
      SET version=?,inactivity_days=?,vip_rule=?,vip_threshold=?,points_expiry_days=?,updated_by=?,updated_at=?
      WHERE branch_id=?`).run(
      nextVersion,
      input.inactivityDays,
      input.vipRule,
      input.vipThreshold,
      input.pointsExpiryDays,
      actor.id,
      time,
      actor.branchId,
    );
    return { policy: this.getPolicy(actor) };
  }

  getCloudState(actor: Actor) {
    const row = this.ensureCloudState(actor.branchId);
    const pending = this.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(points_delta),0) AS points
      FROM loyalty_ledger WHERE branch_id=? AND status='pending'`).get(actor.branchId)!;
    return {
      loyaltyCloudMode: String(row.loyalty_cloud_mode) as 'online' | 'offline' | 'timeout',
      lastSyncedAt: row.last_synced_at === null ? null : Number(row.last_synced_at),
      updatedAt: Number(row.updated_at),
      pendingEntriesCount: Number(pending.count),
      pendingPointsTotal: Number(pending.points),
    };
  }

  setCloudMode(actor: Actor, input: LoyaltyCloudModeInput) {
    if (!isAdminRole(actor.role)) throw forbidden();
    this.ensureCloudState(actor.branchId);
    const time = this.now();
    this.db.prepare('UPDATE branch_cloud_state SET loyalty_cloud_mode=?,updated_at=? WHERE branch_id=?')
      .run(input.mode, time, actor.branchId);
    return { cloudState: this.getCloudState(actor) };
  }

  syncPendingLoyalty(actor: Actor) {
    if (actor.role === 'barista') throw forbidden();
    const cloud = this.ensureCloudState(actor.branchId);
    if (cloud.loyalty_cloud_mode !== 'online') {
      throw conflict('Cloud loyalty service is unavailable; pending points cannot be synchronized while offline.');
    }
    const time = this.now();
    const pending = this.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(points_delta),0) AS points
      FROM loyalty_ledger WHERE branch_id=? AND status='pending'`).get(actor.branchId)!;
    this.db.prepare(`UPDATE loyalty_ledger SET status='available',acknowledged_at=?
      WHERE branch_id=? AND status='pending'`).run(time, actor.branchId);
    this.db.prepare('UPDATE branch_cloud_state SET last_synced_at=?,updated_at=? WHERE branch_id=?')
      .run(time, time, actor.branchId);
    return {
      syncedEntriesCount: Number(pending.count),
      syncedPoints: Number(pending.points),
      cloudState: this.getCloudState(actor),
    };
  }

  customerBalances(branchId: string, customerId: string) {
    const available = Number(this.db.prepare(`SELECT COALESCE(SUM(points_delta),0) AS pts
      FROM loyalty_ledger WHERE branch_id=? AND customer_id=? AND status='available'`).get(branchId, customerId)!.pts);
    const pending = Number(this.db.prepare(`SELECT COALESCE(SUM(points_delta),0) AS pts
      FROM loyalty_ledger WHERE branch_id=? AND customer_id=? AND status='pending'`).get(branchId, customerId)!.pts);
    return {
      availablePoints: exact(available),
      pendingPoints: exact(pending),
      totalPoints: exact(available + pending),
    };
  }

  private customerMetrics(branchId: string, customerId: string, policy: ReturnType<CustomersAndLoyalty['getPolicy']>) {
    const settlements = this.db.prepare(`
      SELECT s.order_id, s.business_date, s.total_centavos,
        COALESCE((SELECT SUM(l.amount_centavos) FROM refund_legs l
          WHERE l.branch_id=s.branch_id AND l.order_id=s.order_id AND l.status='completed'),0) AS refunded_centavos
      FROM order_settlements s
      JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id
      WHERE s.branch_id=? AND o.customer_id=? AND o.cancelled_at IS NULL
      ORDER BY s.settled_at ASC, s.order_id ASC
    `).all(branchId, customerId);

    let qualifyingPurchaseCount = 0;
    let lifetimeNetSpendCentavos = 0;
    let lastPurchaseDate: string | null = null;

    for (const s of settlements) {
      const total = Number(s.total_centavos);
      const refunded = Number(s.refunded_centavos);
      const net = Math.max(0, exact(total - refunded));
      lifetimeNetSpendCentavos = exact(lifetimeNetSpendCentavos + net);
      const fullyRefunded = total > 0 ? refunded >= total : refunded > 0;
      if (!fullyRefunded) {
        qualifyingPurchaseCount++;
        const bDate = String(s.business_date);
        if (lastPurchaseDate === null || bDate > lastPurchaseDate) {
          lastPurchaseDate = bDate;
        }
      }
    }

    const today = manilaBusinessDate(this.now());
    let activityStatus: 'active' | 'inactive' | 'no_purchases' = 'no_purchases';
    if (lastPurchaseDate !== null) {
      const elapsedDays = calendarDay(today) - calendarDay(lastPurchaseDate);
      activityStatus = elapsedDays >= policy.inactivityDays ? 'inactive' : 'active';
    }

    let isVip = false;
    if (policy.vipConfigured && policy.vipThreshold !== null) {
      if (policy.vipRule === 'lifetime_spend') {
        isVip = lifetimeNetSpendCentavos >= policy.vipThreshold;
      } else if (policy.vipRule === 'purchase_count') {
        isVip = qualifyingPurchaseCount >= policy.vipThreshold;
      }
    }

    return {
      qualifyingPurchaseCount,
      lifetimeNetSpendCentavos,
      lastPurchaseDate,
      activityStatus,
      isVip,
    };
  }

  customerProjection(actor: Actor, id: string) {
    const row = this.db.prepare('SELECT * FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    const balances = this.customerBalances(actor.branchId, id);
    const base = {
      id: String(row.id),
      displayName: String(row.display_name),
      phone: String(row.phone),
      notes: String(row.notes),
      version: Number(row.version),
      availablePoints: balances.availablePoints,
      pendingPoints: balances.pendingPoints,
      createdAt: Number(row.created_at),
    };
    if (!isAdminRole(actor.role)) {
      return base;
    }
    const policy = this.getPolicy(actor);
    const metrics = this.customerMetrics(actor.branchId, id, policy);
    return {
      ...base,
      ...metrics,
    };
  }

  createCustomer(actor: Actor, input: CustomerCreateInput) {
    if (actor.role === 'barista') throw forbidden();
    const id = input.customerId ?? `cust-${randomUUID().slice(0, 8)}`;
    if (this.db.prepare('SELECT 1 FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, id)) {
      throw conflict('A customer with this ID already exists.');
    }
    if (input.phone && this.db.prepare('SELECT 1 FROM customers WHERE branch_id=? AND phone=?').get(actor.branchId, input.phone)) {
      throw conflict('A customer with this phone number already exists.');
    }
    this.db.prepare(`INSERT INTO customers(id,branch_id,display_name,phone,notes,version,created_by,created_at)
      VALUES(?,?,?,?,?,1,?,?)`).run(id, actor.branchId, input.displayName, input.phone, input.notes, actor.id, this.now());
    return { customer: this.customerProjection(actor, id) };
  }

  updateCustomer(actor: Actor, id: string, input: CustomerUpdateInput) {
    if (actor.role === 'barista') throw forbidden();
    const row = this.db.prepare('SELECT * FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    if (Number(row.version) !== input.expectedVersion || Number(row.version) >= MAX_VERSION) throw conflict();
    if (input.phone && this.db.prepare('SELECT 1 FROM customers WHERE branch_id=? AND phone=? AND id<>?').get(actor.branchId, input.phone, id)) {
      throw conflict('A customer with this phone number already exists.');
    }
    this.db.prepare('UPDATE customers SET display_name=?,phone=?,notes=?,version=? WHERE branch_id=? AND id=?')
      .run(input.displayName, input.phone, input.notes, exact(Number(row.version) + 1), actor.branchId, id);
    return { customer: this.customerProjection(actor, id) };
  }

  listCustomers(actor: Actor, query: CustomerListInput) {
    if (actor.role === 'barista') throw forbidden();
    const q = (query.q ?? '').toLowerCase();
    const rows = this.db.prepare('SELECT id FROM customers WHERE branch_id=? ORDER BY display_name ASC, id ASC').all(actor.branchId);
    const all = rows.map(r => this.customerProjection(actor, String(r.id)));
    const searched = q
      ? all.filter(c => c.id.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q))
      : all;

    if (!isAdminRole(actor.role)) {
      return { customers: searched, cloudState: this.getCloudState(actor) };
    }

    const policy = this.getPolicy(actor);
    const adminAll = all as (ReturnType<CustomersAndLoyalty['customerProjection']> & {
      activityStatus: 'active' | 'inactive' | 'no_purchases';
      isVip: boolean;
    })[];
    const counters = {
      totalCount: adminAll.length,
      activeCount: adminAll.filter(c => c.activityStatus === 'active').length,
      inactiveCount: adminAll.filter(c => c.activityStatus === 'inactive').length,
      noPurchasesCount: adminAll.filter(c => c.activityStatus === 'no_purchases').length,
      vipConfigured: policy.vipConfigured,
      vipCount: policy.vipConfigured ? adminAll.filter(c => c.isVip).length : null,
    };

    const segment = query.segment ?? 'all';
    const filtered = (searched as typeof adminAll).filter(c => {
      if (segment === 'all') return true;
      if (segment === 'vip') return policy.vipConfigured && c.isVip;
      return c.activityStatus === segment;
    });

    return {
      customers: filtered,
      counters,
      policy,
      cloudState: this.getCloudState(actor),
    };
  }

  getCustomerProfile(actor: Actor, id: string) {
    if (actor.role === 'barista') throw forbidden();
    const customer = this.customerProjection(actor, id);
    if (!isAdminRole(actor.role)) {
      return { customer };
    }
    const ledger = this.db.prepare(`
      SELECT id, order_id, redemption_id, refund_case_id, kind, points_delta, status,
        eligible_spend_centavos, created_at, acknowledged_at
      FROM loyalty_ledger
      WHERE branch_id=? AND customer_id=?
      ORDER BY sequence DESC
    `).all(actor.branchId, id).map(row => ({
      id: String(row.id),
      orderId: row.order_id === null ? null : String(row.order_id),
      redemptionId: row.redemption_id === null ? null : String(row.redemption_id),
      refundCaseId: row.refund_case_id === null ? null : String(row.refund_case_id),
      kind: String(row.kind),
      pointsDelta: Number(row.points_delta),
      status: String(row.status),
      eligibleSpendCentavos: row.eligible_spend_centavos === null ? null : Number(row.eligible_spend_centavos),
      createdAt: Number(row.created_at),
      acknowledgedAt: row.acknowledged_at === null ? null : Number(row.acknowledged_at),
    }));

    const orders = this.db.prepare(`
      SELECT o.id, o.order_no, o.total_centavos, o.discount_centavos, o.redeemed_points,
        o.loyalty_redemption_centavos, o.accepted_at, o.cancelled_at,
        s.settled_at, s.business_date, s.earned_points,
        COALESCE((SELECT SUM(l.amount_centavos) FROM refund_legs l
          WHERE l.branch_id=o.branch_id AND l.order_id=o.id AND l.status='completed'),0) AS refunded_centavos
      FROM orders o
      LEFT JOIN order_settlements s ON s.branch_id=o.branch_id AND s.order_id=o.id
      WHERE o.branch_id=? AND o.customer_id=?
      ORDER BY o.accepted_at DESC, o.order_no DESC
    `).all(actor.branchId, id).map(row => ({
      orderId: String(row.id),
      orderNo: Number(row.order_no),
      totalCentavos: Number(row.total_centavos),
      discountCentavos: Number(row.discount_centavos),
      redeemedPoints: Number(row.redeemed_points),
      loyaltyRedemptionCentavos: Number(row.loyalty_redemption_centavos),
      earnedPoints: row.earned_points === null ? 0 : Number(row.earned_points),
      refundedCentavos: Number(row.refunded_centavos),
      acceptedAt: Number(row.accepted_at),
      settledAt: row.settled_at === null ? null : Number(row.settled_at),
      businessDate: row.business_date === null ? null : String(row.business_date),
      cancelled: row.cancelled_at !== null,
    }));

    return { customer, ledger, orders };
  }

  assertCustomerExists(branchId: string, customerId: string) {
    const row = this.db.prepare('SELECT id,display_name FROM customers WHERE branch_id=? AND id=?').get(branchId, customerId);
    if (!row) throw notFound();
    return { id: String(row.id), displayName: String(row.display_name) };
  }

  recordSettlementEarning(actor: Actor, order: Row, settledAt: number, commandId: string) {
    const customerId = order.customer_id === null || order.customer_id === undefined ? null : String(order.customer_id);
    const redeemedPoints = Number(order.redeemed_points ?? 0);
    const redemptionCentavos = Number(order.loyalty_redemption_centavos ?? 0);
    const eligibleSpendCentavos = Number(order.total_centavos);
    const earnedPoints = customerId ? Math.floor(eligibleSpendCentavos / 10_000) : 0;

    this.db.prepare(`UPDATE order_settlements
      SET customer_id=?, earned_points=?, redeemed_points=?, loyalty_redemption_centavos=?
      WHERE branch_id=? AND order_id=?`).run(
      customerId,
      earnedPoints,
      redeemedPoints,
      redemptionCentavos,
      actor.branchId,
      String(order.id),
    );

    if (customerId && earnedPoints > 0) {
      const cloud = this.ensureCloudState(actor.branchId);
      const isOnline = cloud.loyalty_cloud_mode === 'online';
      this.db.prepare(`INSERT INTO loyalty_ledger(
        id,branch_id,customer_id,order_id,kind,points_delta,status,eligible_spend_centavos,command_id,created_at,acknowledged_at
      ) VALUES(?,?,?,?,'earn',?,?,?,?,?,?)`).run(
        randomUUID(),
        actor.branchId,
        customerId,
        String(order.id),
        earnedPoints,
        isOnline ? 'available' : 'pending',
        eligibleSpendCentavos,
        commandId,
        settledAt,
        isOnline ? settledAt : null,
      );
      if (isOnline) {
        this.db.prepare('UPDATE branch_cloud_state SET last_synced_at=?,updated_at=? WHERE branch_id=?')
          .run(settledAt, settledAt, actor.branchId);
      }
    }
  }

  private redemptionRows(actor: Actor, id: string | null): Row[] {
    return this.db.prepare(`
      SELECT r.*, o.order_no, o.version AS current_order_version,
        c.display_name AS customer_name, a.display_name AS requester_name
      FROM loyalty_redemptions r
      JOIN orders o ON o.branch_id=r.branch_id AND o.id=r.order_id
      JOIN customers c ON c.branch_id=r.branch_id AND c.id=r.customer_id
      JOIN accounts a ON a.branch_id=r.branch_id AND a.id=r.requester_id
      WHERE r.branch_id=? AND (? IS NULL OR r.id=?) AND (?=0 OR r.requester_id=? OR r.decision='approve')
      ORDER BY r.rowid DESC
    `).all(actor.branchId, id, id, actor.role === 'cashier' ? 1 : 0, actor.id).map(row => {
      let status: string = deriveRequestStatus(row.decision, row.superseded_by, row.order_version, row.current_order_version);
      if (row.cloud_status === 'applied') status = 'applied';
      else if (row.cloud_status === 'cloud_unknown') status = 'cloud_unknown';
      else if (row.cloud_status === 'failed' && row.decision === 'approve') status = 'failed';
      else if (row.cloud_status === 'cancelled') status = 'cancelled';
      return { ...row, derived_status: status };
    });
  }

  private redemptionProjection(row: Row) {
    return {
      id: String(row.id),
      orderId: String(row.order_id),
      orderNo: Number(row.order_no),
      orderVersion: Number(row.order_version),
      customerId: String(row.customer_id),
      customerName: String(row.customer_name),
      requestedPoints: Number(row.requested_points),
      discountCentavos: Number(row.discount_centavos),
      subtotalCentavos: Number(row.subtotal_centavos),
      reason: String(row.reason),
      requesterId: String(row.requester_id),
      requesterName: String(row.requester_name),
      requestedAt: Number(row.requested_at),
      status: String(row.derived_status),
      cloudStatus: String(row.cloud_status),
      cloudReference: row.cloud_reference === null ? null : String(row.cloud_reference),
      cloudValidatedAt: row.cloud_validated_at === null ? null : Number(row.cloud_validated_at),
      decision: row.decision === null ? null : String(row.decision),
      decisionReason: row.decision_reason === null ? null : String(row.decision_reason),
      decidedAt: row.decided_at === null ? null : Number(row.decided_at),
      version: Number(row.version),
    };
  }

  listRedemptions(actor: Actor) {
    if (actor.role === 'barista') throw forbidden();
    return { redemptions: this.redemptionRows(actor, null).map(r => this.redemptionProjection(r)) };
  }

  orderRedemptions(actor: Actor, orderId: string) {
    if (actor.role === 'barista') return [];
    return this.redemptionRows(actor, null)
      .filter(r => String(r.order_id) === orderId)
      .map(r => this.redemptionProjection(r));
  }

  requestRedemption(
    session: Session,
    order: Row,
    paidCentavos: number,
    pendingCentavos: number,
    awaitingAmendmentPrice: boolean,
    input: LoyaltyRedeemRequestInput,
  ) {
    const actor = session.actor;
    const orderId = String(order.id);
    if (order.cancelled_at !== null || awaitingAmendmentPrice || paidCentavos !== 0 || pendingCentavos !== 0) {
      throw conflict('Points redemption must be requested before payments are recorded on an active order.');
    }
    if (Number(order.redeemed_points ?? 0) > 0) {
      throw conflict('A loyalty redemption has already been applied to this order.');
    }
    const customerId = order.customer_id === null || order.customer_id === undefined ? null : String(order.customer_id);
    if (!customerId) {
      throw conflict('Attach a customer to the order before requesting loyalty redemption.');
    }
    const unknown = this.db.prepare(`SELECT 1 FROM loyalty_redemptions
      WHERE branch_id=? AND order_id=? AND cloud_status='cloud_unknown'`).get(actor.branchId, orderId);
    if (unknown) {
      throw conflict('Resolve the unknown cloud redemption outcome before requesting another redemption.');
    }
    const balances = this.customerBalances(actor.branchId, customerId);
    if (input.points > balances.availablePoints) {
      throw conflict('Requested points exceed the customer’s available cloud-acknowledged balance.');
    }
    const discountCentavos = exact(input.points * 100);
    const payableCentavos = Number(order.total_centavos);
    if (discountCentavos > payableCentavos || payableCentavos <= 0) {
      throw conflict('Redemption cannot exceed the eligible checkout amount.');
    }
    const id = randomUUID();
    this.db.prepare(`UPDATE loyalty_redemptions SET superseded_by=?
      WHERE branch_id=? AND order_id=? AND superseded_by IS NULL AND cloud_status IN ('pending_approval','awaiting_cloud')`)
      .run(id, actor.branchId, orderId);
    this.db.prepare(`INSERT INTO loyalty_redemptions(
      id,branch_id,order_id,order_version,customer_id,requested_points,discount_centavos,subtotal_centavos,
      reason,requester_id,requester_device_id,requested_at,request_command_id,cloud_status,version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_approval',1)`).run(
      id,
      actor.branchId,
      orderId,
      input.expectedVersion,
      customerId,
      input.points,
      discountCentavos,
      payableCentavos,
      input.reason,
      actor.id,
      session.deviceId!,
      this.now(),
      input.commandId,
    );
    return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
  }

  decideRedemption(actor: Actor, id: string, input: LoyaltyRedeemDecisionInput) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const row = this.redemptionRows(actor, id)[0];
    if (!row) throw notFound();
    if (row.requester_id === actor.id) throw forbidden();
    if (row.derived_status !== 'pending' || row.cloud_status !== 'pending_approval') throw conflict();
    const nextCloudStatus = input.decision === 'approve' ? 'awaiting_cloud' : 'failed';
    this.db.prepare(`UPDATE loyalty_redemptions
      SET decision=?,decision_reason=?,reviewer_id=?,decided_at=?,decision_command_id=?,cloud_status=?,version=version+1
      WHERE branch_id=? AND id=?`).run(
      input.decision,
      input.reason ?? null,
      actor.id,
      this.now(),
      input.commandId,
      nextCloudStatus,
      actor.branchId,
      id,
    );
    return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
  }

  private applyValidatedRedemption(
    actor: Actor,
    row: Row,
    order: Row,
    paidCentavos: number,
    pendingCentavos: number,
    cloudReference: string,
    commandId: string,
    onZeroTotalSettled: (orderId: string, commandId: string) => void,
  ) {
    const orderId = String(order.id);
    if (order.cancelled_at !== null || paidCentavos !== 0 || pendingCentavos !== 0) throw conflict();
    if (Number(order.version) !== Number(row.order_version)) throw conflict();
    if (Number(order.redeemed_points ?? 0) > 0) throw conflict();
    const customerId = String(row.customer_id);
    const requestedPoints = Number(row.requested_points);
    const discountCentavos = Number(row.discount_centavos);
    const payableCentavos = Number(order.total_centavos);
    if (payableCentavos !== Number(row.subtotal_centavos) || discountCentavos > payableCentavos) throw conflict();
    const balances = this.customerBalances(actor.branchId, customerId);
    if (requestedPoints > balances.availablePoints) {
      throw conflict('Customer available points balance is no longer sufficient for this redemption.');
    }
    const time = this.now();
    this.db.prepare(`INSERT INTO loyalty_ledger(
      id,branch_id,customer_id,order_id,redemption_id,kind,points_delta,status,command_id,created_at,acknowledged_at
    ) VALUES(?,?,?,?,?,'redeem',?,'available',?,?,?)`).run(
      randomUUID(),
      actor.branchId,
      customerId,
      orderId,
      String(row.id),
      -requestedPoints,
      commandId,
      time,
      time,
    );
    const newTotal = exact(payableCentavos - discountCentavos);
    this.db.prepare(`UPDATE orders
      SET total_centavos=?,redeemed_points=?,loyalty_redemption_centavos=?,version=?
      WHERE branch_id=? AND id=?`).run(
      newTotal,
      requestedPoints,
      discountCentavos,
      exact(Number(order.version) + 1),
      actor.branchId,
      orderId,
    );
    this.db.prepare(`UPDATE loyalty_redemptions
      SET cloud_status='applied',cloud_reference=?,cloud_validated_at=?,cloud_command_id=?,version=version+1
      WHERE branch_id=? AND id=?`).run(
      cloudReference,
      time,
      commandId,
      actor.branchId,
      String(row.id),
    );
    this.db.prepare('UPDATE branch_cloud_state SET last_synced_at=?,updated_at=? WHERE branch_id=?')
      .run(time, time, actor.branchId);
    if (newTotal === 0) {
      onZeroTotalSettled(orderId, commandId);
    }
  }

  validateRedemptionCloud(
    actor: Actor,
    id: string,
    input: LoyaltyRedeemCloudValidateInput,
    getOrderState: (orderId: string) => { order: Row; paidCentavos: number; pendingCentavos: number },
    onZeroTotalSettled: (orderId: string, commandId: string) => void,
  ) {
    if (actor.role === 'barista') throw forbidden();
    const row = this.redemptionRows(actor, id)[0];
    if (!row) throw notFound();
    if (Number(row.version) !== input.expectedVersion) throw conflict();
    if (row.decision !== 'approve' || row.cloud_status !== 'awaiting_cloud' || row.derived_status !== 'approved') {
      throw conflict('Redemption must have an active manager approval awaiting cloud validation.');
    }
    const { order, paidCentavos, pendingCentavos } = getOrderState(String(row.order_id));
    const cloud = this.ensureCloudState(actor.branchId);
    if (cloud.loyalty_cloud_mode === 'offline') {
      throw conflict('Cloud loyalty service is unavailable; redemption requires online cloud authorization.');
    }
    if (cloud.loyalty_cloud_mode === 'timeout') {
      this.db.prepare(`UPDATE loyalty_redemptions
        SET cloud_status='cloud_unknown',cloud_command_id=?,version=version+1
        WHERE branch_id=? AND id=?`).run(input.commandId, actor.branchId, id);
      return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
    }
    const ref = input.cloudReference ?? `CLOUD-AUTH-${String(row.id).slice(0, 8)}`;
    this.applyValidatedRedemption(actor, row, order, paidCentavos, pendingCentavos, ref, input.commandId, onZeroTotalSettled);
    return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
  }

  reconcileRedemptionCloud(
    actor: Actor,
    id: string,
    input: LoyaltyRedeemCloudReconcileInput,
    getOrderState: (orderId: string) => { order: Row; paidCentavos: number; pendingCentavos: number },
    onZeroTotalSettled: (orderId: string, commandId: string) => void,
  ) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const row = this.redemptionRows(actor, id)[0];
    if (!row) throw notFound();
    if (Number(row.version) !== input.expectedVersion) throw conflict();
    if (row.cloud_status !== 'cloud_unknown') throw conflict();
    if (input.outcome === 'confirm_not_debited') {
      this.db.prepare(`UPDATE loyalty_redemptions
        SET cloud_status='failed',decision_reason=?,cloud_command_id=?,version=version+1
        WHERE branch_id=? AND id=?`).run(input.note, input.commandId, actor.branchId, id);
      return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
    }
    const { order, paidCentavos, pendingCentavos } = getOrderState(String(row.order_id));
    this.applyValidatedRedemption(actor, row, order, paidCentavos, pendingCentavos, input.cloudReference!, input.commandId, onZeroTotalSettled);
    return { redemption: this.redemptionProjection(this.redemptionRows(actor, id)[0]!) };
  }

  restoreRedemptionOnCancel(actor: Actor, order: Row, commandId: string) {
    const orderId = String(order.id);
    const redeemedPoints = Number(order.redeemed_points ?? 0);
    const customerId = order.customer_id === null || order.customer_id === undefined ? null : String(order.customer_id);
    const settled = this.db.prepare('SELECT 1 FROM order_settlements WHERE branch_id=? AND order_id=?').get(actor.branchId, orderId);
    if (!settled && customerId && redeemedPoints > 0) {
      const applied = this.db.prepare(`SELECT id FROM loyalty_redemptions
        WHERE branch_id=? AND order_id=? AND cloud_status='applied'`).get(actor.branchId, orderId);
      if (applied) {
        const time = this.now();
        this.db.prepare(`INSERT INTO loyalty_ledger(
          id,branch_id,customer_id,order_id,redemption_id,kind,points_delta,status,command_id,created_at,acknowledged_at
        ) VALUES(?,?,?,?,?,'redeem_cancel_restore',?,'available',?,?,?)`).run(
          randomUUID(),
          actor.branchId,
          customerId,
          orderId,
          String(applied.id),
          redeemedPoints,
          commandId,
          time,
          time,
        );
        this.db.prepare(`UPDATE loyalty_redemptions SET cloud_status='cancelled',version=version+1
          WHERE branch_id=? AND id=?`).run(actor.branchId, String(applied.id));
      }
    }
  }

  onRefundApproved(actor: Actor, refundId: string, orderId: string, refundAmountCentavos: number) {
    const order = this.db.prepare('SELECT customer_id,redeemed_points FROM orders WHERE branch_id=? AND id=?').get(actor.branchId, orderId);
    const customerId = order?.customer_id === null || order?.customer_id === undefined ? null : String(order.customer_id);
    if (!customerId) return null;
    const settlement = this.db.prepare('SELECT total_centavos,earned_points,redeemed_points FROM order_settlements WHERE branch_id=? AND order_id=?')
      .get(actor.branchId, orderId);
    const originalEarnedPoints = settlement ? Number(settlement.earned_points ?? 0) : 0;
    const originalRedeemedPoints = settlement ? Number(settlement.redeemed_points ?? 0) : Number(order?.redeemed_points ?? 0);
    const orderSettledCentavos = settlement ? Number(settlement.total_centavos) : 0;
    if (originalEarnedPoints === 0 && originalRedeemedPoints === 0) return null;

    const id = randomUUID();
    this.db.prepare(`INSERT INTO loyalty_refund_cases(
      id,branch_id,refund_id,order_id,customer_id,refund_amount_centavos,order_settled_centavos,
      original_earned_points,original_redeemed_points,status,version,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'pending',1,?)`).run(
      id,
      actor.branchId,
      refundId,
      orderId,
      customerId,
      refundAmountCentavos,
      orderSettledCentavos,
      originalEarnedPoints,
      originalRedeemedPoints,
      this.now(),
    );
    return this.refundCaseProjection(actor, id);
  }

  private priorOrderRefundCaseTotals(branchId: string, orderId: string, excludeCaseId?: string) {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(reversed_earned_points),0) AS reversed,
             COALESCE(SUM(restored_redeemed_points),0) AS restored
      FROM loyalty_refund_cases
      WHERE branch_id=? AND order_id=? AND status='resolved' AND (? IS NULL OR id<>?)
    `).get(branchId, orderId, excludeCaseId ?? null, excludeCaseId ?? null)!;
    return {
      priorReversedEarnedPoints: Number(row.reversed),
      priorRestoredRedeemedPoints: Number(row.restored),
    };
  }

  refundCaseProjection(actor: Actor, id: string) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const row = this.db.prepare(`
      SELECT c.*, o.order_no, cust.display_name AS customer_name
      FROM loyalty_refund_cases c
      JOIN orders o ON o.branch_id=c.branch_id AND o.id=c.order_id
      JOIN customers cust ON cust.branch_id=c.branch_id AND cust.id=c.customer_id
      WHERE c.branch_id=? AND c.id=?
    `).get(actor.branchId, id);
    if (!row) throw notFound();
    const prior = this.priorOrderRefundCaseTotals(actor.branchId, String(row.order_id), id);
    const balances = this.customerBalances(actor.branchId, String(row.customer_id));
    return {
      id: String(row.id),
      refundId: String(row.refund_id),
      orderId: String(row.order_id),
      orderNo: Number(row.order_no),
      customerId: String(row.customer_id),
      customerName: String(row.customer_name),
      customerAvailablePoints: balances.availablePoints,
      customerPendingPoints: balances.pendingPoints,
      refundAmountCentavos: Number(row.refund_amount_centavos),
      orderSettledCentavos: Number(row.order_settled_centavos),
      originalEarnedPoints: Number(row.original_earned_points),
      originalRedeemedPoints: Number(row.original_redeemed_points),
      priorReversedEarnedPoints: prior.priorReversedEarnedPoints,
      priorRestoredRedeemedPoints: prior.priorRestoredRedeemedPoints,
      remainingReversibleEarnedPoints: Math.max(0, exact(Number(row.original_earned_points) - prior.priorReversedEarnedPoints)),
      remainingRestorableRedeemedPoints: Math.max(0, exact(Number(row.original_redeemed_points) - prior.priorRestoredRedeemedPoints)),
      status: String(row.status) as 'pending' | 'insufficient_balance_review' | 'resolved',
      reversedEarnedPoints: row.reversed_earned_points === null ? null : Number(row.reversed_earned_points),
      restoredRedeemedPoints: row.restored_redeemed_points === null ? null : Number(row.restored_redeemed_points),
      requestedReversalPoints: row.requested_reversal_points === null ? null : Number(row.requested_reversal_points),
      reason: row.reason === null ? null : String(row.reason),
      resolutionNote: row.resolution_note === null ? null : String(row.resolution_note),
      decidedBy: row.decided_by === null ? null : String(row.decided_by),
      decidedAt: row.decided_at === null ? null : Number(row.decided_at),
      version: Number(row.version),
      createdAt: Number(row.created_at),
    };
  }

  listRefundCases(actor: Actor) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const rows = this.db.prepare('SELECT id FROM loyalty_refund_cases WHERE branch_id=? ORDER BY created_at DESC, id ASC')
      .all(actor.branchId);
    return { cases: rows.map(r => this.refundCaseProjection(actor, String(r.id))) };
  }

  private postRefundCaseLedgerEntries(
    actor: Actor,
    row: Row,
    reverseEarnedPoints: number,
    restoreRedeemedPoints: number,
    commandId: string,
  ) {
    const time = this.now();
    const cloud = this.ensureCloudState(actor.branchId);
    const isOnline = cloud.loyalty_cloud_mode === 'online';
    const customerId = String(row.customer_id);
    const orderId = String(row.order_id);
    const caseId = String(row.id);

    if (restoreRedeemedPoints > 0) {
      this.db.prepare(`INSERT INTO loyalty_ledger(
        id,branch_id,customer_id,order_id,refund_case_id,kind,points_delta,status,command_id,created_at,acknowledged_at
      ) VALUES(?,?,?,?,?,'refund_restoration',?,?,?,?,?)`).run(
        randomUUID(),
        actor.branchId,
        customerId,
        orderId,
        caseId,
        restoreRedeemedPoints,
        isOnline ? 'available' : 'pending',
        commandId,
        time,
        isOnline ? time : null,
      );
    }

    if (reverseEarnedPoints > 0) {
      const balances = this.customerBalances(actor.branchId, customerId);
      const earner = this.db.prepare(`SELECT status FROM loyalty_ledger WHERE branch_id=? AND order_id=? AND kind='earn'`).get(actor.branchId, orderId);
      const usePending = earner?.status === 'pending' && balances.pendingPoints >= reverseEarnedPoints;
      this.db.prepare(`INSERT INTO loyalty_ledger(
        id,branch_id,customer_id,order_id,refund_case_id,kind,points_delta,status,command_id,created_at,acknowledged_at
      ) VALUES(?,?,?,?,?,'refund_reversal',?,?,?,?,?)`).run(
        randomUUID(),
        actor.branchId,
        customerId,
        orderId,
        caseId,
        -reverseEarnedPoints,
        usePending ? 'pending' : 'available',
        commandId,
        time,
        usePending ? null : time,
      );
    }
  }

  decideRefundCase(actor: Actor, id: string, input: LoyaltyRefundCaseDecisionInput) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const row = this.db.prepare('SELECT * FROM loyalty_refund_cases WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    if (Number(row.version) !== input.expectedVersion) throw conflict();
    if (row.status !== 'pending') throw conflict();

    const prior = this.priorOrderRefundCaseTotals(actor.branchId, String(row.order_id), id);
    const maxReversible = exact(Number(row.original_earned_points) - prior.priorReversedEarnedPoints);
    const maxRestorable = exact(Number(row.original_redeemed_points) - prior.priorRestoredRedeemedPoints);

    if (input.reverseEarnedPoints > maxReversible) {
      throw conflict('Reversed earned points cannot exceed the remaining earned points on this order.');
    }
    if (input.restoreRedeemedPoints > maxRestorable) {
      throw conflict('Restored redeemed points cannot exceed the remaining redeemed points on this order.');
    }

    const balances = this.customerBalances(actor.branchId, String(row.customer_id));
    const earner = this.db.prepare(`SELECT status FROM loyalty_ledger WHERE branch_id=? AND order_id=? AND kind='earn'`).get(actor.branchId, String(row.order_id));
    const pool = earner?.status === 'pending' ? balances.pendingPoints : balances.availablePoints;
    const effectiveBalanceAfterRestore = exact(pool + input.restoreRedeemedPoints);

    const time = this.now();
    if (input.reverseEarnedPoints > effectiveBalanceAfterRestore) {
      this.db.prepare(`UPDATE loyalty_refund_cases
        SET status='insufficient_balance_review',requested_reversal_points=?,restored_redeemed_points=?,
            reason=?,decided_by=?,decided_at=?,decision_command_id=?,version=version+1
        WHERE branch_id=? AND id=?`).run(
        input.reverseEarnedPoints,
        input.restoreRedeemedPoints,
        input.reason,
        actor.id,
        time,
        input.commandId,
        actor.branchId,
        id,
      );
      return { refundCase: this.refundCaseProjection(actor, id) };
    }

    this.postRefundCaseLedgerEntries(actor, row, input.reverseEarnedPoints, input.restoreRedeemedPoints, input.commandId);
    this.db.prepare(`UPDATE loyalty_refund_cases
      SET status='resolved',reversed_earned_points=?,restored_redeemed_points=?,requested_reversal_points=?,
          reason=?,decided_by=?,decided_at=?,decision_command_id=?,version=version+1
      WHERE branch_id=? AND id=?`).run(
      input.reverseEarnedPoints,
      input.restoreRedeemedPoints,
      input.reverseEarnedPoints,
      input.reason,
      actor.id,
      time,
      input.commandId,
      actor.branchId,
      id,
    );
    return { refundCase: this.refundCaseProjection(actor, id) };
  }

  resolveRefundCaseException(actor: Actor, id: string, input: LoyaltyRefundCaseExceptionInput) {
    if (!isAdminRole(actor.role)) throw forbidden();
    const row = this.db.prepare('SELECT * FROM loyalty_refund_cases WHERE branch_id=? AND id=?').get(actor.branchId, id);
    if (!row) throw notFound();
    if (Number(row.version) !== input.expectedVersion) throw conflict();
    if (row.status !== 'insufficient_balance_review') throw conflict();

    const requestedReversal = Number(row.requested_reversal_points ?? 0);
    const restoreRedeemed = Number(row.restored_redeemed_points ?? 0);
    if (input.appliedReversalPoints > requestedReversal) {
      throw conflict('Applied reversal points cannot exceed the requested reversal points.');
    }
    const balances = this.customerBalances(actor.branchId, String(row.customer_id));
    const earner = this.db.prepare(`SELECT status FROM loyalty_ledger WHERE branch_id=? AND order_id=? AND kind='earn'`).get(actor.branchId, String(row.order_id));
    const pool = earner?.status === 'pending' ? balances.pendingPoints : balances.availablePoints;
    if (input.appliedReversalPoints > exact(pool + restoreRedeemed)) {
      throw conflict('Applied reversal points cannot exceed the customer’s available balance.');
    }

    this.postRefundCaseLedgerEntries(actor, row, input.appliedReversalPoints, restoreRedeemed, input.commandId);
    this.db.prepare(`UPDATE loyalty_refund_cases
      SET status='resolved',reversed_earned_points=?,resolution_note=?,decided_by=?,decided_at=?,decision_command_id=?,version=version+1
      WHERE branch_id=? AND id=?`).run(
      input.appliedReversalPoints,
      input.resolutionNote,
      actor.id,
      this.now(),
      input.commandId,
      actor.branchId,
      id,
    );
    return { refundCase: this.refundCaseProjection(actor, id) };
  }
}
