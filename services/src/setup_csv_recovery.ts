import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { digest, isStaffRole, type Actor } from './identity.js';
import { ApiError, conflict, exact as safeExact, forbidden, invalidRequest, notFound } from './errors.js';
import { ADMIN_ROLES, identifier, MAX_MONEY_CENTAVOS, MAX_VERSION } from './validation.js';
import { physicalStock } from './inventory_counts.js';
import { recordStockMovement } from './inventory_valuation.js';
import type {
  AccountCreateInput, AccountUpdateInput, BackupRestoreInput, BranchConfigInput,
  CsvExportQueryInput, CsvImportInput, CsvPreviewInput, DeviceCreateInput,
  DevicePairingClaimInput, DevicePairingCreateInput,
  PrinterAdapterModeInput, PrintJobRetryInput, SyncConflictResolveInput,
  SyncIngestInput, SyncModeInput, WasteCorrectionInput,
} from './business_validation.js';

type Row = Record<string, unknown>;
const exact = (value: number) => safeExact(value, 'The resulting amount exceeds the supported range.');

const BACKUP_TABLES = [
  'ingredients',
  'stock_receipts',
  'products',
  'product_versions',
  'product_recipe',
  'drawers',
  'drawer_devices',
  'shifts',
  'shift_counts',
  'shift_reviews',
  'orders',
  'order_lines',
  'order_line_recipe',
  'order_service_states',
  'reservations',
  'payments',
  'cash_movements',
  'order_settlements',
  'settlement_payment_links',
  'waste_entries',
  'waste_corrections',
  'stock_movements',
  'ingredient_valuation_balances',
  'stock_movement_valuations',
  'order_recipe_valuation_estimates',
  'operating_expenses',
  'expense_coverage_confirmations',
  'order_approvals',
  'order_cancellations',
  'cancellation_waste',
  'refund_requests',
  'refund_lines',
  'refund_legs',
  'refund_leg_events',
  'refund_cash_movements',
  'external_refund_references',
  'order_amendments',
  'unreleased_order_replacements',
  'inventory_counts',
  'inventory_count_costs',
  'inventory_count_revaluations',
  'ingredient_stock_thresholds',
  'inventory_threshold_events',
  'inventory_alerts',
  'inventory_alert_events',
  'inventory_order_shortages',
  'product_availability_events',
  'customers',
  'customer_policies',
  'branch_cloud_state',
  'loyalty_redemptions',
  'loyalty_refund_cases',
  'loyalty_ledger',
  'branch_configs',
  'branch_config_versions',
  'printer_adapters',
  'print_jobs',
  'print_job_states',
  'print_job_events',
  'csv_imports',
  'cloud_sync_state',
  'sync_envelopes',
  'sync_conflicts',
  'device_pairing_codes',
  'command_receipts',
  'audit_events',
  'outbox',
] as const;

function parseCsvRows(csvText: string): string[][] {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  return lines.map(line => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export class SetupCsvAndRecovery {
  constructor(private db: DatabaseSync, private now: () => number, private authorityId: string) {}

  // --- F05-01 & F08-02: Accounts, Roles, Devices & Branch Config ---

  listAccounts(actor: Actor) {
    const rows = this.db.prepare(`
      SELECT id, branch_id, display_name, role, disabled, version
      FROM accounts WHERE branch_id=? ORDER BY id
    `).all(actor.branchId);
    return {
      accounts: rows.map(r => ({
        id: String(r.id),
        branchId: String(r.branch_id),
        displayName: String(r.display_name),
        role: String(r.role),
        disabled: Number(r.disabled) === 1,
        version: Number(r.version),
      })),
    };
  }

  createAccount(actor: Actor, input: AccountCreateInput, credentialHash: string) {
    if (this.db.prepare('SELECT id FROM accounts WHERE id=?').get(input.accountId)) {
      throw conflict('An account with this ID already exists.');
    }
    this.db.prepare(`
      INSERT INTO accounts(id, branch_id, display_name, role, credential_hash, disabled, version)
      VALUES(?, ?, ?, ?, ?, 0, 1)
    `).run(input.accountId, actor.branchId, input.displayName, input.role, credentialHash);
    return {
      account: {
        id: input.accountId,
        branchId: actor.branchId,
        displayName: input.displayName,
        role: input.role,
        disabled: false,
        version: 1,
      },
    };
  }

  updateAccount(actor: Actor, accountId: string, input: AccountUpdateInput, credentialHash?: string) {
    const existing = this.db.prepare(`
      SELECT id, branch_id, display_name, role, disabled, version
      FROM accounts WHERE id=? AND branch_id=?
    `).get(accountId, actor.branchId);
    if (!existing) throw notFound();
    if (Number(existing.version) !== input.expectedVersion) throw conflict();
    if (accountId === actor.id && (input.disabled || input.role !== 'owner')) {
      throw conflict('An owner cannot disable or demote their own active account.');
    }
    const nextVersion = exact(input.expectedVersion + 1);
    if (credentialHash !== undefined) {
      this.db.prepare(`
        UPDATE accounts SET display_name=?, role=?, disabled=?, credential_hash=?, version=?
        WHERE id=? AND branch_id=?
      `).run(input.displayName, input.role, input.disabled ? 1 : 0, credentialHash, nextVersion, accountId, actor.branchId);
    } else {
      this.db.prepare(`
        UPDATE accounts SET display_name=?, role=?, disabled=?, version=?
        WHERE id=? AND branch_id=?
      `).run(input.displayName, input.role, input.disabled ? 1 : 0, nextVersion, accountId, actor.branchId);
    }
    if (input.disabled || String(existing.role) !== input.role || credentialHash !== undefined) {
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE account_id=?').run(accountId);
      this.db.prepare('DELETE FROM auth_attempts WHERE subject=?').run(digest(accountId));
    }
    return {
      account: {
        id: accountId,
        branchId: actor.branchId,
        displayName: input.displayName,
        role: input.role,
        disabled: input.disabled,
        version: nextVersion,
      },
    };
  }

  enrollDevice(actor: Actor, input: DeviceCreateInput) {
    if (this.db.prepare('SELECT id FROM devices WHERE id=?').get(input.deviceId)) {
      throw conflict('A device with this ID is already enrolled.');
    }
    const secret = input.secret && input.secret.trim().length >= 6
      ? input.secret.trim()
      : `${input.deviceId}-secret-${randomBytes(16).toString('hex')}`;
    this.db.prepare(`
      INSERT INTO devices(id, branch_id, secret_hash, revoked, version)
      VALUES(?, ?, ?, 0, 1)
    `).run(input.deviceId, actor.branchId, digest(secret));
    const defaultDrawer = this.db.prepare('SELECT id FROM drawers WHERE branch_id=? ORDER BY id ASC LIMIT 1').get(actor.branchId);
    if (defaultDrawer) {
      this.db.prepare('INSERT OR IGNORE INTO drawer_devices(drawer_id, device_id) VALUES(?, ?)').run(String(defaultDrawer.id), input.deviceId);
    }
    return {
      device: {
        id: input.deviceId,
        branchId: actor.branchId,
        version: 1,
        revoked: false,
      },
    };
  }

  getHubInfo() {
    const branchRow = this.db.prepare('SELECT id FROM branches ORDER BY id ASC LIMIT 1').get();
    const branchId = branchRow ? String(branchRow.id) : 'default-branch';
    const cfgRow = this.db.prepare('SELECT receipt_header FROM branch_configs WHERE branch_id=?').get(branchId);
    return {
      authorityId: this.authorityId,
      branchId,
      displayName: cfgRow && typeof cfgRow.receipt_header === 'string' ? cfgRow.receipt_header : 'KAPE DOZ',
      schemaVersion: 20,
      status: 'ready' as const,
    };
  }

  createDevicePairingCode(actor: Actor, deviceId: string, input: DevicePairingCreateInput) {
    const device = this.db.prepare('SELECT id, branch_id, revoked FROM devices WHERE id=? AND branch_id=?').get(deviceId, actor.branchId);
    if (!device) throw notFound();
    if (Number(device.revoked) === 1) throw conflict('Cannot generate a pairing code for a revoked device.');
    let targetAccountId: string | null = null;
    let targetRole: 'cashier' | 'barista' | null = null;
    if (input.accountId !== undefined) {
      const account = this.db.prepare('SELECT id, role, disabled FROM accounts WHERE id=? AND branch_id=?').get(input.accountId, actor.branchId);
      if (!account || Number(account.disabled) === 1 || !isStaffRole(String(account.role))) {
        throw invalidRequest('Selected account must be an active cashier or barista in this branch.');
      }
      targetAccountId = String(account.id);
      targetRole = String(account.role) as 'cashier' | 'barista';
    } else {
      const preferredRole: 'cashier' | 'barista' = input.role ?? (deviceId.toLowerCase().includes('barista') ? 'barista' : 'cashier');
      const byRole = this.db.prepare(`
        SELECT id, role FROM accounts
        WHERE branch_id=? AND disabled=0 AND role=?
        ORDER BY id ASC
        LIMIT 1
      `).get(actor.branchId, preferredRole);
      if (byRole) {
        targetAccountId = String(byRole.id);
        targetRole = String(byRole.role) as 'cashier' | 'barista';
      } else {
        const anyStaff = this.db.prepare(`
          SELECT id, role FROM accounts
          WHERE branch_id=? AND disabled=0 AND role IN ('cashier', 'barista')
          ORDER BY id ASC
          LIMIT 1
        `).get(actor.branchId);
        if (anyStaff) {
          targetAccountId = String(anyStaff.id);
          targetRole = String(anyStaff.role) as 'cashier' | 'barista';
        }
      }
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    let rawCode = '';
    for (let i = 0; i < 8; i++) {
      rawCode += alphabet[bytes[i]! % alphabet.length];
    }
    const pairingCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4, 8)}`;
    const codeHash = digest(rawCode);
    const createdAt = this.now();
    const expiresAt = exact(createdAt + input.ttlMinutes * 60_000);
    const hubOrigin = input.hubOrigin?.trim() || null;

    this.db.prepare(`
      UPDATE device_pairing_codes SET consumed_at=? WHERE device_id=? AND branch_id=? AND consumed_at IS NULL
    `).run(createdAt, deviceId, actor.branchId);

    this.db.prepare(`
      INSERT INTO device_pairing_codes(
        code_hash, device_id, branch_id, account_id, hub_origin, expires_at, consumed_at, created_at, created_by, command_id
      ) VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(codeHash, deviceId, actor.branchId, targetAccountId, hubOrigin, expiresAt, createdAt, actor.id, input.commandId);

    const bundlePayload = JSON.stringify({
      type: 'kape-doz-pair-v1',
      hubOrigin,
      authorityId: this.authorityId,
      branchId: actor.branchId,
      deviceId,
      accountId: targetAccountId,
      role: targetRole,
      pairingCode,
      expiresAt,
    });

    return {
      pairing: {
        deviceId,
        branchId: actor.branchId,
        accountId: targetAccountId,
        role: targetRole,
        authorityId: this.authorityId,
        hubOrigin,
        pairingCode,
        expiresAt,
        qrPayload: bundlePayload,
      },
    };
  }

  claimDevicePairingCode(input: DevicePairingClaimInput, clientIp: string) {
    const time = this.now();
    const subject = `pair:${digest(clientIp)}`;
    const rateRow = this.db.prepare('SELECT window_start, used FROM request_limits WHERE scope=? AND subject=?').get('pair:ip', subject);
    const activeWindow = rateRow && Number(rateRow.window_start) + 60_000 > time;
    if (activeWindow && Number(rateRow.used) >= 10) {
      throw new ApiError(429, 'rate_limited', 'Too many pairing attempts. Wait before trying again.');
    }
    this.db.prepare(`
      INSERT INTO request_limits(scope, subject, window_start, used) VALUES('pair:ip', ?, ?, 1)
      ON CONFLICT(scope, subject) DO UPDATE SET window_start=excluded.window_start, used=?
    `).run(subject, activeWindow ? Number(rateRow.window_start) : time, activeWindow ? Number(rateRow.used) + 1 : 1);

    const normalized = input.pairingCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length !== 8) {
      throw new ApiError(404, 'not_found', 'Pairing code is invalid, expired, or already used.');
    }
    const codeHash = digest(normalized);
    const row = this.db.prepare(`
      SELECT code_hash, device_id, branch_id, account_id, hub_origin, expires_at, consumed_at
      FROM device_pairing_codes WHERE code_hash=?
    `).get(codeHash);
    if (!row || row.consumed_at !== null || Number(row.expires_at) <= time) {
      throw new ApiError(404, 'not_found', 'Pairing code is invalid, expired, or already used.');
    }
    const device = this.db.prepare('SELECT id, branch_id, revoked, version FROM devices WHERE id=? AND branch_id=?').get(String(row.device_id), String(row.branch_id));
    if (!device || Number(device.revoked) === 1) {
      throw conflict('The target device is no longer active.');
    }

    const secretAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!';
    const secretBytes = randomBytes(40);
    let newSecret = '';
    for (let i = 0; i < 40; i++) {
      newSecret += secretAlphabet[secretBytes[i]! % secretAlphabet.length];
    }

    this.db.prepare('UPDATE device_pairing_codes SET consumed_at=? WHERE code_hash=?').run(time, codeHash);
    this.db.prepare('UPDATE devices SET secret_hash=?, version=version+1 WHERE id=? AND branch_id=?')
      .run(digest(newSecret), String(row.device_id), String(row.branch_id));
    this.db.prepare('UPDATE sessions SET revoked=1 WHERE device_id=?').run(String(row.device_id));
    const defaultDrawer = this.db.prepare('SELECT id FROM drawers WHERE branch_id=? ORDER BY id ASC LIMIT 1').get(String(row.branch_id));
    if (defaultDrawer) {
      this.db.prepare('INSERT OR IGNORE INTO drawer_devices(drawer_id, device_id) VALUES(?, ?)').run(String(defaultDrawer.id), String(row.device_id));
    }

    let session: { token: string; expiresAt: number; actor: Actor } | undefined;
    const targetAccountId = row.account_id === null ? null : String(row.account_id);
    if (targetAccountId !== null) {
      const account = this.db.prepare(`
        SELECT id, display_name, role, branch_id, disabled
        FROM accounts WHERE id=? AND branch_id=?
      `).get(targetAccountId, String(row.branch_id));
      if (account && Number(account.disabled) === 0 && isStaffRole(String(account.role))) {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = time + 8 * 60 * 60 * 1000;
        this.db.prepare('INSERT INTO sessions(token_hash, account_id, device_id, expires_at) VALUES(?, ?, ?, ?)')
          .run(digest(token), String(account.id), String(row.device_id), expiresAt);
        session = {
          token,
          expiresAt,
          actor: {
            id: String(account.id),
            displayName: String(account.display_name),
            role: String(account.role) as Actor['role'],
            branchId: String(account.branch_id),
          },
        };
      }
    }

    return {
      enrollment: {
        authorityId: this.authorityId,
        branchId: String(row.branch_id),
        deviceId: String(row.device_id),
        deviceSecret: newSecret,
        hubOrigin: row.hub_origin === null ? null : String(row.hub_origin),
        ...(session ? { session } : {}),
      },
    };
  }

  private ensureBranchConfig(branchId: string): Row {
    let row = this.db.prepare('SELECT * FROM branch_configs WHERE branch_id=?').get(branchId);
    if (!row) {
      this.db.prepare('INSERT INTO branch_configs(branch_id) VALUES(?)').run(branchId);
      row = this.db.prepare('SELECT * FROM branch_configs WHERE branch_id=?').get(branchId)!;
    }
    return row;
  }

  getBranchConfig(actor: Actor) {
    const row = this.ensureBranchConfig(actor.branchId);
    const history = this.db.prepare(`
      SELECT version, receipt_header, receipt_footer, tax_display_note, station_visible_cards,
             offline_access_expiry_minutes, updated_at, updated_by
      FROM branch_config_versions WHERE branch_id=? ORDER BY version DESC LIMIT 20
    `).all(actor.branchId).map(h => ({
      version: Number(h.version),
      receiptHeader: String(h.receipt_header),
      receiptFooter: String(h.receipt_footer),
      taxDisplayNote: String(h.tax_display_note),
      stationVisibleCards: Number(h.station_visible_cards),
      offlineAccessExpiryMinutes: Number(h.offline_access_expiry_minutes),
      updatedAt: Number(h.updated_at),
      updatedBy: String(h.updated_by),
    }));
    return {
      config: {
        branchId: actor.branchId,
        version: Number(row.version),
        receiptHeader: String(row.receipt_header),
        receiptFooter: String(row.receipt_footer),
        taxDisplayNote: String(row.tax_display_note),
        stationVisibleCards: Number(row.station_visible_cards),
        offlineAccessExpiryMinutes: Number(row.offline_access_expiry_minutes),
        updatedAt: Number(row.updated_at),
        updatedBy: row.updated_by === null ? null : String(row.updated_by),
      },
      history,
    };
  }

  updateBranchConfig(actor: Actor, input: BranchConfigInput) {
    const current = this.ensureBranchConfig(actor.branchId);
    if (Number(current.version) !== input.expectedVersion) throw conflict();
    const nextVersion = exact(input.expectedVersion + 1);
    const time = this.now();
    this.db.prepare(`
      UPDATE branch_configs
      SET version=?, receipt_header=?, receipt_footer=?, tax_display_note=?,
          station_visible_cards=?, offline_access_expiry_minutes=?, updated_at=?, updated_by=?
      WHERE branch_id=?
    `).run(
      nextVersion,
      input.receiptHeader,
      input.receiptFooter,
      input.taxDisplayNote,
      input.stationVisibleCards,
      input.offlineAccessExpiryMinutes,
      time,
      actor.id,
      actor.branchId,
    );
    this.db.prepare(`
      INSERT INTO branch_config_versions(
        branch_id, version, receipt_header, receipt_footer, tax_display_note,
        station_visible_cards, offline_access_expiry_minutes, updated_at, updated_by, command_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor.branchId,
      nextVersion,
      input.receiptHeader,
      input.receiptFooter,
      input.taxDisplayNote,
      input.stationVisibleCards,
      input.offlineAccessExpiryMinutes,
      time,
      actor.id,
      input.commandId,
    );
    return this.getBranchConfig(actor);
  }

  recordOrderConfigSnapshot(branchId: string, orderId: string) {
    const config = this.ensureBranchConfig(branchId);
    this.db.prepare(`
      INSERT INTO order_service_states(branch_id, order_id, config_version, handover_at, recalled_count)
      VALUES(?, ?, ?, NULL, 0)
      ON CONFLICT(branch_id, order_id) DO NOTHING
    `).run(branchId, orderId, Number(config.version));
  }

  getOrderServiceState(branchId: string, orderId: string) {
    const row = this.db.prepare(`
      SELECT config_version, handover_at, recalled_count
      FROM order_service_states WHERE branch_id=? AND order_id=?
    `).get(branchId, orderId);
    return {
      configVersion: row ? Number(row.config_version) : 1,
      handoverAt: row && row.handover_at !== null ? Number(row.handover_at) : null,
      recalledCount: row ? Number(row.recalled_count) : 0,
    };
  }

  // --- F02-04 & F02-05: Barista Handover, Recall & Waste Corrections ---

  handoverOrder(actor: Actor, order: Row) {
    if (order.cancelled_at !== null || order.ready_at === null) {
      throw conflict('Only ready, non-cancelled orders can be handed over.');
    }
    this.recordOrderConfigSnapshot(actor.branchId, String(order.id));
    const current = this.getOrderServiceState(actor.branchId, String(order.id));
    if (current.handoverAt === null) {
      this.db.prepare(`
        UPDATE order_service_states SET handover_at=? WHERE branch_id=? AND order_id=?
      `).run(this.now(), actor.branchId, String(order.id));
    }
  }

  recallOrder(actor: Actor, order: Row) {
    if (order.cancelled_at !== null || order.ready_at === null) {
      throw conflict('Cancelled or unready orders cannot be recalled to the station.');
    }
    this.recordOrderConfigSnapshot(actor.branchId, String(order.id));
    this.db.prepare(`
      UPDATE order_service_states
      SET handover_at=NULL, recalled_count=recalled_count+1
      WHERE branch_id=? AND order_id=?
    `).run(actor.branchId, String(order.id));
  }

  listWasteEntries(actor: Actor) {
    const entries = this.db.prepare(`
      SELECT w.id, w.ingredient_id, i.name AS ingredient_name, i.unit, w.quantity_milli,
             w.reason, w.note, w.actor_id, w.accepted_at
      FROM waste_entries w
      JOIN ingredients i ON i.branch_id=w.branch_id AND i.id=w.ingredient_id
      WHERE w.branch_id=?
      ORDER BY w.accepted_at DESC, w.id DESC
    `).all(actor.branchId);
    return {
      wasteEntries: entries.map(w => {
        const corrections = this.db.prepare(`
          SELECT id, previous_quantity_milli, corrected_quantity_milli, delta_milli, reason, actor_id, recorded_at
          FROM waste_corrections
          WHERE branch_id=? AND waste_id=?
          ORDER BY recorded_at ASC, rowid ASC
        `).all(actor.branchId, String(w.id)).map(c => ({
          id: String(c.id),
          previousQuantityMilli: Number(c.previous_quantity_milli),
          correctedQuantityMilli: Number(c.corrected_quantity_milli),
          deltaMilli: Number(c.delta_milli),
          reason: String(c.reason),
          actorId: String(c.actor_id),
          recordedAt: Number(c.recorded_at),
        }));
        const effectiveQuantityMilli = corrections.length > 0
          ? corrections[corrections.length - 1]!.correctedQuantityMilli
          : Number(w.quantity_milli);
        return {
          id: String(w.id),
          ingredientId: String(w.ingredient_id),
          ingredientName: String(w.ingredient_name),
          unit: String(w.unit),
          initialQuantityMilli: Number(w.quantity_milli),
          effectiveQuantityMilli,
          reason: String(w.reason),
          note: String(w.note),
          actorId: String(w.actor_id),
          acceptedAt: Number(w.accepted_at),
          corrections,
        };
      }),
    };
  }

  correctWasteEntry(actor: Actor, wasteId: string, input: WasteCorrectionInput) {
    const entry = this.db.prepare(`
      SELECT id, ingredient_id, quantity_milli FROM waste_entries
      WHERE branch_id=? AND id=?
    `).get(actor.branchId, wasteId);
    if (!entry) throw notFound();
    const lastCorrection = this.db.prepare(`
      SELECT corrected_quantity_milli FROM waste_corrections
      WHERE branch_id=? AND waste_id=?
      ORDER BY recorded_at DESC, rowid DESC LIMIT 1
    `).get(actor.branchId, wasteId);
    const previousQuantityMilli = lastCorrection
      ? Number(lastCorrection.corrected_quantity_milli)
      : Number(entry.quantity_milli);
    const deltaMilli = exact(input.correctedQuantityMilli - previousQuantityMilli);
    if (deltaMilli < 0) {
      throw invalidRequest('Direct waste corrections cannot reduce already-deducted stock; use an authorized physical inventory count for positive stock recovery.');
    }
    const time = this.now();
    const correctionId = randomUUID();
    const ingredientId = String(entry.ingredient_id);
    this.db.prepare(`
      INSERT INTO waste_corrections(
        id, branch_id, waste_id, ingredient_id, previous_quantity_milli,
        corrected_quantity_milli, delta_milli, reason, actor_id, recorded_at, command_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      correctionId,
      actor.branchId,
      wasteId,
      ingredientId,
      previousQuantityMilli,
      input.correctedQuantityMilli,
      deltaMilli,
      input.reason,
      actor.id,
      time,
      input.commandId,
    );
    if (deltaMilli > 0) {
      const { onHandMilli } = physicalStock(this.db, actor.branchId, ingredientId);
      const quantityAfterMilli = exact(onHandMilli - deltaMilli);
      recordStockMovement(this.db, {
        branchId: actor.branchId,
        ingredientId,
        quantityBeforeMilli: onHandMilli,
        deltaMilli: -deltaMilli,
        quantityAfterMilli,
        kind: 'waste',
        referenceId: wasteId,
        commandId: input.commandId,
        acceptedAt: time,
      });
    }
    const updated = this.listWasteEntries(actor).wasteEntries.find(w => w.id === wasteId)!;
    return { wasteEntry: updated };
  }

  // --- F05-02 & F06-03: Controllable Printer Adapters & Print Job Recovery ---

  private getAdapter(branchId: string, type: 'receipt' | 'label') {
    const row = this.db.prepare(`
      SELECT mode, failure_reason, updated_at, updated_by
      FROM printer_adapters WHERE branch_id=? AND type=?
    `).get(branchId, type);
    return {
      type,
      mode: row ? (String(row.mode) as 'unconfigured' | 'confirmed' | 'pending' | 'failed' | 'unknown') : 'unconfigured',
      failureReason: row && row.failure_reason !== null ? String(row.failure_reason) : null,
      updatedAt: row ? Number(row.updated_at) : 0,
      updatedBy: row && row.updated_by !== null ? String(row.updated_by) : null,
    };
  }

  getPrinterAdapters(actor: Actor) {
    return {
      adapters: [
        this.getAdapter(actor.branchId, 'receipt'),
        this.getAdapter(actor.branchId, 'label'),
      ],
    };
  }

  setPrinterAdapterMode(actor: Actor, input: PrinterAdapterModeInput) {
    const time = this.now();
    const reason = input.mode === 'failed' || input.mode === 'unknown'
      ? (input.failureReason ?? (input.mode === 'failed' ? 'Simulated printer offline / paper out' : 'Simulated adapter timeout (outcome unknown)'))
      : null;
    this.db.prepare(`
      INSERT INTO printer_adapters(branch_id, type, mode, failure_reason, updated_at, updated_by)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id, type) DO UPDATE SET
        mode=excluded.mode,
        failure_reason=excluded.failure_reason,
        updated_at=excluded.updated_at,
        updated_by=excluded.updated_by
    `).run(actor.branchId, input.type, input.mode, reason, time, actor.id);
    return this.getPrinterAdapters(actor);
  }

  onPrintJobCreated(actor: Actor, jobId: string, orderId: string, type: 'receipt' | 'label', commandId: string) {
    const existing = this.db.prepare('SELECT * FROM print_job_states WHERE job_id=?').get(jobId);
    if (existing) return;
    const adapter = this.getAdapter(actor.branchId, type);
    const time = this.now();
    const lastError = adapter.mode === 'failed' || adapter.mode === 'unknown' ? adapter.failureReason : null;
    this.db.prepare(`
      INSERT INTO print_job_states(
        job_id, branch_id, order_id, type, adapter_status, attempts,
        original_job_id, last_error, simulated, updated_at
      ) VALUES(?, ?, ?, ?, ?, 1, ?, ?, 1, ?)
    `).run(jobId, actor.branchId, orderId, type, adapter.mode, jobId, lastError, time);
    this.db.prepare(`
      INSERT INTO print_job_events(
        id, branch_id, job_id, original_job_id, attempt_no, action, status, error_message, actor_id, recorded_at, command_id
      ) VALUES(?, ?, ?, ?, 1, 'initial', ?, ?, ?, ?, ?)
    `).run(randomUUID(), actor.branchId, jobId, jobId, adapter.mode, lastError, actor.id, time, commandId);
  }

  getReceiptJobResponse(branchId: string, jobId: string, orderId: string) {
    const state = this.db.prepare('SELECT * FROM print_job_states WHERE job_id=? AND branch_id=?').get(jobId, branchId);
    if (!state || (String(state.adapter_status) === 'unconfigured' && Number(state.attempts) === 1)) {
      return { id: jobId, orderId, type: 'receipt' as const, status: 'unconfigured' as const };
    }
    return {
      id: jobId,
      originalJobId: String(state.original_job_id),
      orderId,
      type: 'receipt' as const,
      status: String(state.adapter_status),
      attempts: Number(state.attempts),
      simulated: true,
      physicalPaperClaimed: false,
      lastError: state.last_error === null ? null : String(state.last_error),
    };
  }

  listPrintJobs(actor: Actor, orderId?: string) {
    const jobs = this.db.prepare(`
      SELECT j.id, j.order_id, o.order_no, j.type, j.status AS base_status,
             s.adapter_status, s.attempts, s.original_job_id, s.last_error, s.updated_at
      FROM print_jobs j
      JOIN orders o ON o.branch_id=j.branch_id AND o.id=j.order_id
      LEFT JOIN print_job_states s ON s.job_id=j.id
      WHERE j.branch_id=? AND (? IS NULL OR j.order_id=?)
      ORDER BY o.order_no DESC, j.type ASC
    `).all(actor.branchId, orderId ?? null, orderId ?? null);
    return {
      jobs: jobs.map(j => ({
        id: String(j.id),
        originalJobId: j.original_job_id ? String(j.original_job_id) : String(j.id),
        orderId: String(j.order_id),
        orderNo: Number(j.order_no),
        type: String(j.type) as 'receipt' | 'label',
        status: j.adapter_status ? String(j.adapter_status) : String(j.base_status),
        attempts: j.attempts ? Number(j.attempts) : 1,
        simulated: true,
        physicalPaperClaimed: false,
        lastError: j.last_error === null || j.last_error === undefined ? null : String(j.last_error),
        updatedAt: j.updated_at ? Number(j.updated_at) : 0,
      })),
    };
  }

  retryPrintJob(actor: Actor, jobId: string, input: PrintJobRetryInput) {
    const job = this.db.prepare('SELECT id, order_id, type FROM print_jobs WHERE branch_id=? AND id=?').get(actor.branchId, jobId);
    if (!job) throw notFound();
    const type = String(job.type) as 'receipt' | 'label';
    const orderId = String(job.order_id);
    this.onPrintJobCreated(actor, jobId, orderId, type, input.commandId);
    const state = this.db.prepare('SELECT * FROM print_job_states WHERE job_id=? AND branch_id=?').get(jobId, actor.branchId)!;
    const currentStatus = String(state.adapter_status);
    if (input.action === 'resolve') {
      if (currentStatus !== 'unknown' && currentStatus !== 'pending') {
        throw conflict('Only unknown or pending print jobs can be manually resolved.');
      }
    }
    const adapter = this.getAdapter(actor.branchId, type);
    const nextStatus = input.action === 'resolve' ? input.resolutionStatus! : adapter.mode;
    const nextAttempts = exact(Number(state.attempts) + 1);
    const lastError = nextStatus === 'failed' || nextStatus === 'unknown'
      ? (input.note ?? adapter.failureReason ?? 'Printer adapter failure')
      : null;
    const time = this.now();
    this.db.prepare(`
      UPDATE print_job_states
      SET adapter_status=?, attempts=?, last_error=?, updated_at=?
      WHERE job_id=? AND branch_id=?
    `).run(nextStatus, nextAttempts, lastError, time, jobId, actor.branchId);
    this.db.prepare(`
      INSERT INTO print_job_events(
        id, branch_id, job_id, original_job_id, attempt_no, action, status, error_message, actor_id, recorded_at, command_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), actor.branchId, jobId, String(state.original_job_id), nextAttempts, input.action, nextStatus, lastError, actor.id, time, input.commandId);
    const updated = this.listPrintJobs(actor, orderId).jobs.find(j => j.id === jobId)!;
    return { job: updated };
  }

  // --- F05-03, F05-04 & F08-01: Loyverse CSV Preview, Import & Export ---

  previewCsv(actor: Actor, input: CsvPreviewInput) {
    const rows = parseCsvRows(input.csvText);
    if (rows.length < 2) {
      throw invalidRequest('CSV file must include a header row and at least one data row.');
    }
    const headers = rows[0]!.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const dataRows = rows.slice(1);
    const errors: { rowNumber: number; identifier: string; message: string }[] = [];
    const additions: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const skipped: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();

    if (input.kind === 'customers') {
      const idIdx = headers.findIndex(h => ['customercode', 'customerid', 'id', 'handle'].includes(h));
      const nameIdx = headers.findIndex(h => ['name', 'displayname', 'customername'].includes(h));
      const phoneIdx = headers.findIndex(h => ['phone', 'phonenumber', 'mobile'].includes(h));
      const noteIdx = headers.findIndex(h => ['note', 'notes'].includes(h));
      if (idIdx === -1 || nameIdx === -1) {
        throw invalidRequest('Customer CSV requires Customer code (or id) and Name columns.');
      }
      dataRows.forEach((cells, idx) => {
        const rowNumber = idx + 2;
        const customerId = (cells[idIdx] ?? '').trim();
        const displayName = (cells[nameIdx] ?? '').trim();
        const phone = phoneIdx >= 0 ? (cells[phoneIdx] ?? '').trim() : '';
        const notes = noteIdx >= 0 ? (cells[noteIdx] ?? '').trim() : '';
        if (!identifier.safeParse(customerId).success) {
          errors.push({ rowNumber, identifier: customerId || '(empty)', message: 'Invalid Customer code/ID.' });
          return;
        }
        if (!displayName || displayName.length > 120) {
          errors.push({ rowNumber, identifier: customerId, message: 'Customer name is required (1–120 chars).' });
          return;
        }
        if (phone.length > 40) {
          errors.push({ rowNumber, identifier: customerId, message: 'Phone number exceeds 40 characters.' });
          return;
        }
        if (seenIds.has(customerId)) {
          errors.push({ rowNumber, identifier: customerId, message: 'Duplicate Customer code within CSV file.' });
          return;
        }
        seenIds.add(customerId);
        const existing = this.db.prepare('SELECT id FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, customerId);
        const item = { customerId, displayName, phone, notes };
        if (existing) {
          if (input.duplicatePolicy === 'update') updates.push(item);
          else skipped.push(item);
        } else {
          additions.push(item);
        }
      });
    } else {
      const idIdx = headers.findIndex(h => ['handle', 'productid', 'id', 'sku'].includes(h));
      const nameIdx = headers.findIndex(h => ['itemname', 'name', 'productname'].includes(h));
      const priceIdx = headers.findIndex(h => ['price', 'defaultprice', 'pricephp'].includes(h));
      const ingIdIdx = headers.findIndex(h => ['ingredientid', 'componenthandle', 'ingredient'].includes(h));
      const ingNameIdx = headers.findIndex(h => ['ingredientname', 'componentname'].includes(h));
      const unitIdx = headers.findIndex(h => ['unit', 'ingredientunit'].includes(h));
      const qtyIdx = headers.findIndex(h => ['recipequantitymilli', 'quantitymilli', 'componentquantitymilli'].includes(h));
      if (idIdx === -1 || nameIdx === -1 || priceIdx === -1 || ingIdIdx === -1 || qtyIdx === -1) {
        throw invalidRequest('Catalog CSV requires Handle, Item name, Price, IngredientId, and RecipeQuantityMilli columns.');
      }
      dataRows.forEach((cells, idx) => {
        const rowNumber = idx + 2;
        const productId = (cells[idIdx] ?? '').trim();
        const name = (cells[nameIdx] ?? '').trim();
        const priceRaw = (cells[priceIdx] ?? '').trim();
        const ingredientId = (cells[ingIdIdx] ?? '').trim();
        const ingredientName = ingNameIdx >= 0 ? (cells[ingNameIdx] ?? '').trim() || ingredientId : ingredientId;
        const unit = unitIdx >= 0 ? (cells[unitIdx] ?? '').trim() || 'g' : 'g';
        const qtyRaw = (cells[qtyIdx] ?? '').trim();

        if (!identifier.safeParse(productId).success) {
          errors.push({ rowNumber, identifier: productId || '(empty)', message: 'Invalid Handle/ProductId.' });
          return;
        }
        if (!name || name.length > 120) {
          errors.push({ rowNumber, identifier: productId, message: 'Item name is required (1–120 chars).' });
          return;
        }
        const priceNumber = Number(priceRaw);
        const priceCentavos = Number.isFinite(priceNumber) ? Math.round(priceNumber * 100) : NaN;
        if (!Number.isInteger(priceCentavos) || priceCentavos <= 0 || priceCentavos > MAX_MONEY_CENTAVOS) {
          errors.push({ rowNumber, identifier: productId, message: 'Price must be a positive number.' });
          return;
        }
        if (!identifier.safeParse(ingredientId).success) {
          errors.push({ rowNumber, identifier: productId, message: 'Invalid IngredientId.' });
          return;
        }
        if (!['g', 'ml', 'piece'].includes(unit)) {
          errors.push({ rowNumber, identifier: productId, message: 'Unit must be g, ml, or piece.' });
          return;
        }
        const quantityMilli = Number(qtyRaw);
        if (!Number.isInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > MAX_VERSION) {
          errors.push({ rowNumber, identifier: productId, message: 'RecipeQuantityMilli must be a positive integer.' });
          return;
        }
        if (seenIds.has(productId)) {
          errors.push({ rowNumber, identifier: productId, message: 'Duplicate Handle within CSV file.' });
          return;
        }
        seenIds.add(productId);
        const existing = this.db.prepare('SELECT id FROM products WHERE branch_id=? AND id=?').get(actor.branchId, productId);
        const item = { productId, name, priceCentavos, ingredientId, ingredientName, unit, quantityMilli };
        if (existing) {
          if (input.duplicatePolicy === 'update') updates.push(item);
          else skipped.push(item);
        } else {
          additions.push(item);
        }
      });
    }

    return {
      preview: {
        kind: input.kind,
        duplicatePolicy: input.duplicatePolicy,
        fileHash: digest(input.csvText.trim()),
        valid: errors.length === 0,
        summary: {
          totalRows: dataRows.length,
          addedCount: additions.length,
          updatedCount: updates.length,
          skippedCount: skipped.length,
          errorCount: errors.length,
        },
        additions,
        updates,
        skipped,
        errors,
      },
    };
  }

  importCsv(actor: Actor, input: CsvImportInput) {
    const { preview } = this.previewCsv(actor, input);
    if (!preview.valid) {
      throw invalidRequest(`CSV validation failed with ${preview.summary.errorCount} error(s): ${preview.errors[0]?.message ?? 'Invalid row'}`);
    }
    const time = this.now();
    if (input.kind === 'customers') {
      for (const item of preview.additions as { customerId: string; displayName: string; phone: string; notes: string }[]) {
        this.db.prepare(`
          INSERT INTO customers(branch_id, id, display_name, phone, notes, version, created_at, created_by)
          VALUES(?, ?, ?, ?, ?, 1, ?, ?)
        `).run(actor.branchId, item.customerId, item.displayName, item.phone, item.notes, time, actor.id);
      }
      for (const item of preview.updates as { customerId: string; displayName: string; phone: string; notes: string }[]) {
        this.db.prepare(`
          UPDATE customers SET display_name=?, phone=?, notes=?, version=version+1
          WHERE branch_id=? AND id=?
        `).run(item.displayName, item.phone, item.notes, actor.branchId, item.customerId);
      }
    } else {
      for (const item of [...preview.additions, ...preview.updates] as {
        productId: string; name: string; priceCentavos: number;
        ingredientId: string; ingredientName: string; unit: string; quantityMilli: number;
      }[]) {
        const existingIng = this.db.prepare('SELECT id, unit FROM ingredients WHERE branch_id=? AND id=?').get(actor.branchId, item.ingredientId);
        if (!existingIng) {
          this.db.prepare('INSERT INTO ingredients(branch_id, id, name, unit) VALUES(?, ?, ?, ?)')
            .run(actor.branchId, item.ingredientId, item.ingredientName, item.unit);
        }
      }
      for (const item of preview.additions as {
        productId: string; name: string; priceCentavos: number;
        ingredientId: string; quantityMilli: number;
      }[]) {
        this.db.prepare('INSERT INTO products(branch_id, id, name, price_centavos, version) VALUES(?, ?, ?, ?, 1)')
          .run(actor.branchId, item.productId, item.name, item.priceCentavos);
        this.db.prepare('INSERT INTO product_versions(branch_id, product_id, version, options_json) VALUES(?, ?, 1, ?)')
          .run(actor.branchId, item.productId, '{}');
        this.db.prepare('INSERT INTO product_recipe(branch_id, product_id, version, ingredient_id, quantity_milli) VALUES(?, ?, 1, ?, ?)')
          .run(actor.branchId, item.productId, item.ingredientId, item.quantityMilli);
      }
      for (const item of preview.updates as {
        productId: string; name: string; priceCentavos: number;
        ingredientId: string; quantityMilli: number;
      }[]) {
        const current = this.db.prepare('SELECT version FROM products WHERE branch_id=? AND id=?').get(actor.branchId, item.productId)!;
        const nextVersion = exact(Number(current.version) + 1);
        this.db.prepare('UPDATE products SET name=?, price_centavos=?, version=? WHERE branch_id=? AND id=?')
          .run(item.name, item.priceCentavos, nextVersion, actor.branchId, item.productId);
        this.db.prepare('INSERT INTO product_versions(branch_id, product_id, version, options_json) VALUES(?, ?, ?, ?)')
          .run(actor.branchId, item.productId, nextVersion, '{}');
        this.db.prepare('INSERT INTO product_recipe(branch_id, product_id, version, ingredient_id, quantity_milli) VALUES(?, ?, ?, ?, ?)')
          .run(actor.branchId, item.productId, nextVersion, item.ingredientId, item.quantityMilli);
      }
    }

    const batchId = randomUUID();
    this.db.prepare(`
      INSERT INTO csv_imports(
        id, branch_id, kind, duplicate_policy, file_hash,
        added_count, updated_count, skipped_count, error_count,
        actor_id, imported_at, command_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      batchId,
      actor.branchId,
      input.kind,
      input.duplicatePolicy,
      preview.fileHash,
      preview.summary.addedCount,
      preview.summary.updatedCount,
      preview.summary.skippedCount,
      actor.id,
      time,
      input.commandId,
    );

    return {
      importBatch: {
        id: batchId,
        kind: input.kind,
        duplicatePolicy: input.duplicatePolicy,
        fileHash: preview.fileHash,
        addedCount: preview.summary.addedCount,
        updatedCount: preview.summary.updatedCount,
        skippedCount: preview.summary.skippedCount,
        errorCount: 0,
        importedAt: time,
      },
    };
  }

  listCsvImports(actor: Actor) {
    const rows = this.db.prepare(`
      SELECT id, kind, duplicate_policy, file_hash, added_count, updated_count, skipped_count, error_count, actor_id, imported_at
      FROM csv_imports WHERE branch_id=? ORDER BY imported_at DESC, rowid DESC LIMIT 25
    `).all(actor.branchId);
    return {
      imports: rows.map(r => ({
        id: String(r.id),
        kind: String(r.kind),
        duplicatePolicy: String(r.duplicate_policy),
        fileHash: String(r.file_hash),
        addedCount: Number(r.added_count),
        updatedCount: Number(r.updated_count),
        skippedCount: Number(r.skipped_count),
        errorCount: Number(r.error_count),
        actorId: String(r.actor_id),
        importedAt: Number(r.imported_at),
      })),
    };
  }

  exportCsv(actor: Actor, query: CsvExportQueryInput) {
    if (query.kind === 'financial') {
      if (isStaffRole(actor.role)) throw forbidden();
      const expenses = this.db.prepare(`
        SELECT id, category, description, amount_centavos, starts_on, ends_on
        FROM operating_expenses WHERE branch_id=? ORDER BY starts_on, id
      `).all(actor.branchId);
      const lines = ['ExpenseId,Category,Description,AmountPHP,StartsOn,EndsOn'];
      for (const e of expenses) {
        lines.push([
          escapeCsvCell(String(e.id)),
          escapeCsvCell(String(e.category)),
          escapeCsvCell(String(e.description)),
          escapeCsvCell((Number(e.amount_centavos) / 100).toFixed(2)),
          escapeCsvCell(String(e.starts_on)),
          escapeCsvCell(String(e.ends_on)),
        ].join(','));
      }
      return { kind: 'financial', csvText: lines.join('\n') };
    }

    if (query.kind === 'customers') {
      const customers = this.db.prepare(`
        SELECT id, display_name, phone, notes FROM customers WHERE branch_id=? ORDER BY id
      `).all(actor.branchId);
      const lines = ['Customer code,Name,Phone,Note'];
      for (const c of customers) {
        lines.push([
          escapeCsvCell(String(c.id)),
          escapeCsvCell(String(c.display_name)),
          escapeCsvCell(String(c.phone)),
          escapeCsvCell(String(c.notes)),
        ].join(','));
      }
      return { kind: 'customers', csvText: lines.join('\n') };
    }

    const products = this.db.prepare(`
      SELECT p.id, p.name, p.price_centavos, p.version,
             r.ingredient_id, i.name AS ingredient_name, i.unit, r.quantity_milli
      FROM products p
      JOIN product_recipe r ON r.branch_id=p.branch_id AND r.product_id=p.id AND r.version=p.version
      JOIN ingredients i ON i.branch_id=r.branch_id AND i.id=r.ingredient_id
      WHERE p.branch_id=?
      ORDER BY p.id, r.ingredient_id
    `).all(actor.branchId);
    const lines = ['Handle,Item name,Price,IngredientId,IngredientName,Unit,RecipeQuantityMilli'];
    for (const p of products) {
      lines.push([
        escapeCsvCell(String(p.id)),
        escapeCsvCell(String(p.name)),
        escapeCsvCell((Number(p.price_centavos) / 100).toFixed(2)),
        escapeCsvCell(String(p.ingredient_id)),
        escapeCsvCell(String(p.ingredient_name)),
        escapeCsvCell(String(p.unit)),
        escapeCsvCell(Number(p.quantity_milli)),
      ].join(','));
    }
    return { kind: 'catalog', csvText: lines.join('\n') };
  }

  // --- F08-04: Cloud Outbox Sync Ordering, Retry & Conflict Inspection ---

  private ensureSyncState(branchId: string): Row {
    let row = this.db.prepare('SELECT * FROM cloud_sync_state WHERE branch_id=?').get(branchId);
    if (!row) {
      this.db.prepare('INSERT INTO cloud_sync_state(branch_id) VALUES(?)').run(branchId);
      row = this.db.prepare('SELECT * FROM cloud_sync_state WHERE branch_id=?').get(branchId)!;
    }
    return row;
  }

  getSyncStatus(actor: Actor) {
    const state = this.ensureSyncState(actor.branchId);
    const pendingCount = Number(this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE branch_id=? AND status='pending'").get(actor.branchId)!.n);
    const ackCount = Number(this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE branch_id=? AND status='acknowledged'").get(actor.branchId)!.n);
    const conflicts = ADMIN_ROLES.includes(actor.role as 'owner' | 'manager')
      ? this.db.prepare(`
          SELECT id, envelope_id, entity_type, entity_id, incoming_version, local_version,
                 reason, payload_json, status, resolution_note, detected_at, resolved_at, resolved_by
          FROM sync_conflicts WHERE branch_id=? ORDER BY detected_at DESC, rowid DESC
        `).all(actor.branchId).map(c => ({
          id: String(c.id),
          envelopeId: String(c.envelope_id),
          entityType: String(c.entity_type),
          entityId: String(c.entity_id),
          incomingVersion: Number(c.incoming_version),
          localVersion: Number(c.local_version),
          reason: String(c.reason),
          payload: JSON.parse(String(c.payload_json)) as Record<string, unknown>,
          status: String(c.status),
          resolutionNote: c.resolution_note === null ? null : String(c.resolution_note),
          detectedAt: Number(c.detected_at),
          resolvedAt: c.resolved_at === null ? null : Number(c.resolved_at),
          resolvedBy: c.resolved_by === null ? null : String(c.resolved_by),
        }))
      : [];
    return {
      syncStatus: {
        branchId: actor.branchId,
        mode: String(state.mode) as 'online' | 'offline',
        lastSyncedAt: state.last_synced_at === null ? null : Number(state.last_synced_at),
        lastSyncedOutboxSequence: Number(state.last_synced_outbox_rowid),
        pendingOutboxCount: pendingCount,
        acknowledgedOutboxCount: ackCount,
        openConflictCount: conflicts.filter(c => c.status === 'open').length,
        conflicts,
      },
    };
  }

  setSyncMode(actor: Actor, input: SyncModeInput) {
    this.ensureSyncState(actor.branchId);
    this.db.prepare('UPDATE cloud_sync_state SET mode=? WHERE branch_id=?').run(input.mode, actor.branchId);
    return this.getSyncStatus(actor);
  }

  pushOutboxSync(actor: Actor) {
    const state = this.ensureSyncState(actor.branchId);
    if (String(state.mode) === 'offline') {
      throw new ApiError(409, 'cloud_offline', 'Cloud synchronization is currently offline; pending outbox events remain queued.');
    }
    const pending = this.db.prepare(`
      SELECT rowid AS seq, id FROM outbox
      WHERE branch_id=? AND status='pending'
      ORDER BY rowid ASC
    `).all(actor.branchId);
    const time = this.now();
    let maxSeq = Number(state.last_synced_outbox_rowid);
    for (const row of pending) {
      this.db.prepare("UPDATE outbox SET status='acknowledged' WHERE id=? AND branch_id=?").run(String(row.id), actor.branchId);
      if (Number(row.seq) > maxSeq) maxSeq = Number(row.seq);
    }
    this.db.prepare(`
      UPDATE cloud_sync_state SET last_synced_at=?, last_synced_outbox_rowid=? WHERE branch_id=?
    `).run(time, maxSeq, actor.branchId);
    return {
      ...this.getSyncStatus(actor),
      pushedCount: pending.length,
    };
  }

  ingestSyncEnvelopes(actor: Actor, input: SyncIngestInput) {
    const state = this.ensureSyncState(actor.branchId);
    if (String(state.mode) === 'offline') {
      throw new ApiError(409, 'cloud_offline', 'Cloud synchronization is offline.');
    }
    const time = this.now();
    const outcomes: { envelopeId: string; outcome: 'applied' | 'duplicate' | 'conflict'; conflictId?: string }[] = [];

    for (const env of input.envelopes) {
      const seen = this.db.prepare(`
        SELECT outcome FROM sync_envelopes WHERE branch_id=? AND envelope_id=?
      `).get(actor.branchId, env.envelopeId);
      if (seen) {
        outcomes.push({ envelopeId: env.envelopeId, outcome: 'duplicate' });
        continue;
      }

      let localVersion = 0;
      if (env.entityType === 'product') {
        const p = this.db.prepare('SELECT version FROM products WHERE branch_id=? AND id=?').get(actor.branchId, env.entityId);
        localVersion = p ? Number(p.version) : 0;
      } else if (env.entityType === 'customer') {
        const c = this.db.prepare('SELECT version FROM customers WHERE branch_id=? AND id=?').get(actor.branchId, env.entityId);
        localVersion = c ? Number(c.version) : 0;
      } else {
        const cfg = this.ensureBranchConfig(actor.branchId);
        localVersion = Number(cfg.version);
      }

      if (env.version <= localVersion) {
        const conflictId = randomUUID();
        const reason = env.version < localVersion
          ? `Stale out-of-order envelope (incoming v${env.version} < local v${localVersion})`
          : `Conflicting concurrent version (incoming v${env.version} == local v${localVersion})`;
        this.db.prepare(`
          INSERT INTO sync_conflicts(
            id, branch_id, envelope_id, entity_type, entity_id,
            incoming_version, local_version, reason, payload_json, status, detected_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(
          conflictId,
          actor.branchId,
          env.envelopeId,
          env.entityType,
          env.entityId,
          env.version,
          localVersion,
          reason,
          JSON.stringify(env.payload),
          time,
        );
        this.db.prepare(`
          INSERT INTO sync_envelopes(branch_id, envelope_id, entity_type, entity_id, version, outcome, processed_at)
          VALUES(?, ?, ?, ?, ?, 'conflict', ?)
        `).run(actor.branchId, env.envelopeId, env.entityType, env.entityId, env.version, time);
        outcomes.push({ envelopeId: env.envelopeId, outcome: 'conflict', conflictId });
        continue;
      }

      if (env.entityType === 'customer') {
        const displayName = typeof env.payload.displayName === 'string' && env.payload.displayName.trim()
          ? env.payload.displayName.trim()
          : env.entityId;
        const phone = typeof env.payload.phone === 'string' ? env.payload.phone.trim() : '';
        const notes = typeof env.payload.notes === 'string' ? env.payload.notes.trim() : '';
        if (localVersion === 0) {
          this.db.prepare(`
            INSERT INTO customers(branch_id, id, display_name, phone, notes, version, created_at, created_by)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          `).run(actor.branchId, env.entityId, displayName, phone, notes, env.version, time, actor.id);
        } else {
          this.db.prepare(`
            UPDATE customers SET display_name=?, phone=?, notes=?, version=?
            WHERE branch_id=? AND id=?
          `).run(displayName, phone, notes, env.version, actor.branchId, env.entityId);
        }
      } else if (env.entityType === 'product' && localVersion > 0) {
        const name = typeof env.payload.name === 'string' && env.payload.name.trim() ? env.payload.name.trim() : undefined;
        const priceCentavos = typeof env.payload.priceCentavos === 'number' && Number.isInteger(env.payload.priceCentavos) && env.payload.priceCentavos > 0
          ? env.payload.priceCentavos
          : undefined;
        if (name !== undefined && priceCentavos !== undefined) {
          this.db.prepare('UPDATE products SET name=?, price_centavos=?, version=? WHERE branch_id=? AND id=?')
            .run(name, priceCentavos, env.version, actor.branchId, env.entityId);
          const prevRecipe = this.db.prepare('SELECT ingredient_id, quantity_milli FROM product_recipe WHERE branch_id=? AND product_id=? AND version=?')
            .all(actor.branchId, env.entityId, localVersion);
          this.db.prepare('INSERT INTO product_versions(branch_id, product_id, version, options_json) VALUES(?, ?, ?, ?)')
            .run(actor.branchId, env.entityId, env.version, '{}');
          for (const line of prevRecipe) {
            this.db.prepare('INSERT INTO product_recipe(branch_id, product_id, version, ingredient_id, quantity_milli) VALUES(?, ?, ?, ?, ?)')
              .run(actor.branchId, env.entityId, env.version, String(line.ingredient_id), Number(line.quantity_milli));
          }
        }
      }

      this.db.prepare(`
        INSERT INTO sync_envelopes(branch_id, envelope_id, entity_type, entity_id, version, outcome, processed_at)
        VALUES(?, ?, ?, ?, ?, 'applied', ?)
      `).run(actor.branchId, env.envelopeId, env.entityType, env.entityId, env.version, time);
      outcomes.push({ envelopeId: env.envelopeId, outcome: 'applied' });
    }

    this.db.prepare('UPDATE cloud_sync_state SET last_synced_at=? WHERE branch_id=?').run(time, actor.branchId);
    return {
      ...this.getSyncStatus(actor),
      outcomes,
    };
  }

  resolveSyncConflict(actor: Actor, conflictId: string, input: SyncConflictResolveInput) {
    const row = this.db.prepare('SELECT id, status FROM sync_conflicts WHERE branch_id=? AND id=?').get(actor.branchId, conflictId);
    if (!row) throw notFound();
    if (String(row.status) !== 'open') throw conflict('Sync conflict is already resolved.');
    this.db.prepare(`
      UPDATE sync_conflicts SET status='resolved', resolution_note=?, resolved_at=?, resolved_by=?
      WHERE branch_id=? AND id=?
    `).run(input.resolutionNote, this.now(), actor.id, actor.branchId, conflictId);
    return this.getSyncStatus(actor);
  }

  // --- F05-05 & F08-05: Software Backup & Isolated Restore ---

  exportBackup(actor: Actor) {
    const tables: Record<string, unknown[]> = {};
    tables.accounts = this.db.prepare(`
      SELECT id, branch_id, display_name, role, disabled, version
      FROM accounts WHERE branch_id=? ORDER BY id
    `).all(actor.branchId).map(r => ({ ...r }));
    tables.devices = this.db.prepare(`
      SELECT id, branch_id, revoked, version
      FROM devices WHERE branch_id=? ORDER BY id
    `).all(actor.branchId).map(r => ({ ...r }));

    for (const table of BACKUP_TABLES) {
      const hasBranch = this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name='branch_id'`).get(table);
      const rows = hasBranch
        ? this.db.prepare(`SELECT * FROM ${table} WHERE branch_id=? ORDER BY rowid ASC`).all(actor.branchId)
        : table === 'inventory_alert_events'
          ? this.db.prepare(`
              SELECT t.* FROM inventory_alert_events t
              JOIN inventory_alerts a ON a.id=t.alert_id
              WHERE a.branch_id=? ORDER BY t.rowid ASC
            `).all(actor.branchId)
          : table === 'stock_movement_valuations'
            ? this.db.prepare(`
                SELECT t.* FROM stock_movement_valuations t
                JOIN stock_movements m ON m.id=t.movement_id
                WHERE m.branch_id=? ORDER BY t.rowid ASC
              `).all(actor.branchId)
            : this.db.prepare(`
                SELECT t.* FROM ${table} t
                JOIN inventory_counts c ON c.id=t.count_id
                WHERE c.branch_id=? ORDER BY t.rowid ASC
              `).all(actor.branchId);
      tables[table] = rows.map(r => ({ ...r }));
    }

    const canonicalPayload = JSON.stringify({
      format: 'kape-doz-backup-v1',
      schemaVersion: 19,
      branchId: actor.branchId,
      tables,
    });
    const checksum = digest(canonicalPayload);

    return {
      backup: {
        format: 'kape-doz-backup-v1',
        schemaVersion: 19,
        authorityId: this.authorityId,
        branchId: actor.branchId,
        exportedAt: this.now(),
        secretsRedacted: true,
        checksum,
        tables,
      },
    };
  }

  restoreBackup(actor: Actor, input: BackupRestoreInput) {
    const raw = input.backup;
    if (raw.format !== 'kape-doz-backup-v1') {
      throw new ApiError(400, 'invalid_backup_format', 'Unsupported backup archive format.');
    }
    if (raw.schemaVersion !== 19) {
      throw new ApiError(400, 'incompatible_backup_version', `Backup schema version ${String(raw.schemaVersion)} is not compatible with hub schema 19.`);
    }
    if (raw.branchId !== actor.branchId) {
      throw new ApiError(409, 'backup_branch_mismatch', 'Backup archive belongs to a different branch.');
    }
    if (!raw.tables || typeof raw.tables !== 'object' || Array.isArray(raw.tables)) {
      throw new ApiError(400, 'corrupt_backup_archive', 'Backup archive tables section is missing or invalid.');
    }
    const tables = raw.tables as Record<string, Record<string, SQLInputValue>[]>;
    const expectedChecksum = digest(JSON.stringify({
      format: 'kape-doz-backup-v1',
      schemaVersion: 19,
      branchId: actor.branchId,
      tables,
    }));
    if (typeof raw.checksum !== 'string' || raw.checksum !== expectedChecksum) {
      throw new ApiError(400, 'corrupt_backup_archive', 'Backup archive checksum verification failed; no records were modified.');
    }

    this.db.exec('PRAGMA defer_foreign_keys=ON;');
    for (const table of [...BACKUP_TABLES].reverse()) {
      const hasBranch = this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name='branch_id'`).get(table);
      if (hasBranch) {
        this.db.prepare(`DELETE FROM ${table} WHERE branch_id=?`).run(actor.branchId);
      } else if (table === 'inventory_alert_events') {
        this.db.prepare(`
          DELETE FROM inventory_alert_events WHERE alert_id IN (SELECT id FROM inventory_alerts WHERE branch_id=?)
        `).run(actor.branchId);
      } else if (table === 'stock_movement_valuations') {
        this.db.prepare(`
          DELETE FROM stock_movement_valuations WHERE movement_id IN (SELECT id FROM stock_movements WHERE branch_id=?)
        `).run(actor.branchId);
      } else {
        this.db.prepare(`
          DELETE FROM ${table} WHERE count_id IN (SELECT id FROM inventory_counts WHERE branch_id=?)
        `).run(actor.branchId);
      }
    }

    if (Array.isArray(tables.accounts)) {
      for (const acc of tables.accounts) {
        if (typeof acc.id === 'string' && acc.branch_id === actor.branchId) {
          this.db.prepare(`
            INSERT INTO accounts(id, branch_id, display_name, role, credential_hash, disabled, version)
            VALUES(?, ?, ?, ?, 'RESTORED_REQUIRES_SECRET_RESET', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              display_name=excluded.display_name,
              role=CASE WHEN accounts.id=? THEN accounts.role ELSE excluded.role END,
              disabled=CASE WHEN accounts.id=? THEN 0 ELSE excluded.disabled END,
              version=excluded.version
            WHERE accounts.branch_id=excluded.branch_id
          `).run(
            acc.id,
            actor.branchId,
            String(acc.display_name),
            String(acc.role),
            Number(acc.disabled ?? 0),
            Number(acc.version ?? 1),
            actor.id,
            actor.id,
          );
        }
      }
    }
    if (Array.isArray(tables.devices)) {
      for (const dev of tables.devices) {
        if (typeof dev.id === 'string' && dev.branch_id === actor.branchId) {
          this.db.prepare(`
            INSERT INTO devices(id, branch_id, secret_hash, revoked, version)
            VALUES(?, ?, 'RESTORED_REQUIRES_SECRET_RESET', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              revoked=excluded.revoked,
              version=excluded.version
            WHERE devices.branch_id=excluded.branch_id
          `).run(dev.id, actor.branchId, Number(dev.revoked ?? 0), Number(dev.version ?? 1));
        }
      }
    }

    let restoredRows = 0;
    for (const table of BACKUP_TABLES) {
      const rows = tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map(c => row[c] ?? null);
        this.db.prepare(`INSERT INTO ${table}(${cols.map(c => `"${c}"`).join(', ')}) VALUES(${placeholders})`).run(...values);
        restoredRows++;
      }
    }
    if (this.db.prepare('PRAGMA foreign_key_check').get()) {
      throw new ApiError(400, 'corrupt_backup_archive', 'Restored backup archive failed referential integrity checks.');
    }

    return {
      restored: {
        branchId: actor.branchId,
        schemaVersion: 19,
        checksum: expectedChecksum,
        restoredRows,
        restoredAt: this.now(),
      },
    };
  }
}
