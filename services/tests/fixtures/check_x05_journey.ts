import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const prefix = 'PASS X05 Loyverse CSV import, offline outbox sync, printer timeout retry, barista recall/handover, and backup/restore ';
const [databasePath, logPath, ...extra] = process.argv.slice(2);
assert.ok(databasePath && logPath && !extra.length, 'Usage: check_x05_journey.ts <fixture.sqlite> <browser.log>');
const traces = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.startsWith(prefix));
assert.equal(traces.length, 1, 'Expected one complete browser trace');
const trace = JSON.parse(traces[0]!.slice(prefix.length)) as {
  orderId: string;
  productId: string;
  ingredientId: string;
  printJobId: string;
};
assert.deepEqual(Object.keys(trace).sort(), [
  'ingredientId',
  'orderId',
  'printJobId',
  'productId',
]);

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const rows = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args).map(row => ({ ...row }));
  const one = (sql: string, ...args: SQLInputValue[]) => {
    const items = rows(sql, ...args);
    assert.equal(items.length, 1, `Expected one row for ${sql}`);
    return items[0]!;
  };
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(one('SELECT MAX(version) AS version FROM schema_migrations').version, 20);
  const branch = 'transport-branch';

  const csvRun = one('SELECT kind,added_count,error_count FROM csv_imports WHERE branch_id=?', branch);
  assert.deepEqual(csvRun, {
    kind: 'catalog',
    added_count: 1,
    error_count: 0,
  });

  const product = one('SELECT id,name,price_centavos FROM products WHERE branch_id=? AND id=?', branch, trace.productId);
  assert.deepEqual(product, {
    id: trace.productId,
    name: 'Cold Brew X05',
    price_centavos: 18000,
  });

  const order = one('SELECT id,total_centavos FROM orders WHERE branch_id=? AND id=?', branch, trace.orderId);
  assert.equal(order.id, trace.orderId);
  assert.equal(order.total_centavos, 18000);

  const serviceState = one('SELECT handover_at,recalled_count FROM order_service_states WHERE branch_id=? AND order_id=?', branch, trace.orderId);
  assert.ok(Number(serviceState.handover_at) > 0);
  assert.equal(serviceState.recalled_count, 1);

  const jobState = one(
    `SELECT job_id, original_job_id, adapter_status, attempts
     FROM print_job_states
     WHERE branch_id=? AND job_id=?`,
    branch,
    trace.printJobId,
  );
  assert.deepEqual(jobState, {
    job_id: trace.printJobId,
    original_job_id: trace.printJobId,
    adapter_status: 'confirmed',
    attempts: 2,
  });

  const jobEvents = rows(
    `SELECT attempt_no, action, status, original_job_id
     FROM print_job_events
     WHERE branch_id=? AND job_id=?
     ORDER BY attempt_no ASC`,
    branch,
    trace.printJobId,
  );
  assert.deepEqual(jobEvents, [
    { attempt_no: 1, action: 'initial', status: 'unknown', original_job_id: trace.printJobId },
    { attempt_no: 2, action: 'retry', status: 'confirmed', original_job_id: trace.printJobId },
  ]);

  const syncState = one('SELECT mode FROM cloud_sync_state WHERE branch_id=?', branch);
  assert.equal(syncState.mode, 'online');
  const acknowledgedOutboxCount = Number(one(`SELECT COUNT(*) AS n FROM outbox WHERE branch_id=? AND status='acknowledged'`, branch).n);
  assert.ok(acknowledgedOutboxCount >= 1);

  const restoreReceipts = rows(
    `SELECT action, outcome FROM command_receipts WHERE branch_id=? AND action='backup.restore'`,
    branch,
  );
  assert.equal(restoreReceipts.length, 1);
  assert.equal(restoreReceipts[0]!.outcome, 'accepted');

  const receipts = rows('SELECT id,action,outcome FROM command_receipts WHERE branch_id=?', branch);
  for (const r of receipts) {
    assert.equal(r.outcome, 'accepted');
  }

  console.log('PASS X05 SQLite reconciliation', JSON.stringify({
    orderId: trace.orderId,
    printJobId: trace.printJobId,
    acknowledgedOutboxCount,
    acceptedCommands: receipts.length,
  }));
} finally {
  db.close();
}
