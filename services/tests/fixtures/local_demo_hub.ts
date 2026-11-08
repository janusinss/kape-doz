import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createHub } from '../../src/hub.js';

async function main() {
  const databasePath = process.env.KAPE_DOZ_TEST_DATABASE_PATH || 'c:/xampp/htdocs/YEAR 4/CAFE DOS/scratch/local-demo.sqlite';
  const hosts = new Set<string>(['127.0.0.1', 'localhost', '192.168.137.1', '192.168.254.140', '192.168.43.1', '10.0.2.2']);
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && iface.address) hosts.add(iface.address);
    }
  }
  const origins: string[] = [];
  for (const h of hosts) {
    origins.push(`http://${h}:5173`, `http://${h}:8080`);
  }
  const port = 4000;

  const hub = await createHub({ databasePath, allowedOrigins: origins, allowPrivateLanHttp: true });
  try {
    for (const acc of [
      { id: 'admin', branchId: 'transport-branch', displayName: 'Administrator', role: 'owner' as const, secret: 'admin123' },
      { id: 'staffCashier', branchId: 'transport-branch', displayName: 'Staff Cashier', role: 'cashier' as const, secret: 'staff123' },
      { id: 'staffBarista', branchId: 'transport-branch', displayName: 'Staff Barista', role: 'barista' as const, secret: 'staff123' },
      { id: 'transport-owner', branchId: 'transport-branch', displayName: 'Transport fixture owner', role: 'owner' as const, secret: 'Transport-Fixture-Owner-Password!' },
      { id: 'transport-manager', branchId: 'transport-branch', displayName: 'Transport fixture manager', role: 'manager' as const, secret: 'Transport-Fixture-Manager-Password!' },
      { id: 'transport-cashier', branchId: 'transport-branch', displayName: 'Transport fixture cashier', role: 'cashier' as const, secret: '4826' },
      { id: 'transport-barista', branchId: 'transport-branch', displayName: 'Transport fixture barista', role: 'barista' as const, secret: '5937' },
    ]) {
      try { await hub.provisionAccount(acc); } catch {}
    }
    for (const dev of [
      { id: 'transport-cashier-tablet', branchId: 'transport-branch', secret: 'Transport-Fixture-Device-Secret-32!' },
      { id: 'transport-barista-tablet', branchId: 'transport-branch', secret: 'Transport-Fixture-Device-Secret-32!' },
      { id: 'janus-cashier-1', branchId: 'transport-branch', secret: 'janus-cashier-1-secret-key-0123456789abcdef' },
      { id: 'janus-barista-1', branchId: 'transport-branch', secret: 'janus-barista-1-secret-key-0123456789abcdef' },
    ]) {
      try { await hub.provisionDevice(dev); } catch {}
    }

    const login = await hub.app.inject({ method: 'POST', url: '/api/v1/auth/admin', payload: { accountId: 'admin', password: 'admin123' } });
    if (login.statusCode !== 200) throw new Error('Owner login failed: ' + login.payload);
    const token = login.json().token;

    for (const [url, payload] of [
      ['/api/v1/ingredients', { ingredientId: 'beans', name: 'Fixture espresso beans', unit: 'g' }],
      ['/api/v1/ingredients', { ingredientId: 'milk', name: 'Whole Milk', unit: 'ml' }],
      ['/api/v1/inventory/receipts', { ingredientId: 'beans', quantityMilli: 2000000, totalCostCentavos: 160000, reference: 'Initial Beans Stock' }],
      ['/api/v1/inventory/receipts', { ingredientId: 'milk', quantityMilli: 5000000, totalCostCentavos: 250000, reference: 'Initial Milk Stock' }],
      ['/api/v1/products', { productId: 'fixture-latte', name: 'Fixture Latte', priceCentavos: 16500, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] }],
      ['/api/v1/products', { productId: 'fixture-espresso', name: 'Fixture Espresso', priceCentavos: 9000, recipe: [{ ingredientId: 'beans', quantityMilli: 9000 }] }],
      ['/api/v1/drawers', { drawerId: 'fixture-counter', name: 'Fixture counter', deviceIds: ['transport-cashier-tablet', 'transport-barista-tablet'] }]
    ] as const) {
      const res = await hub.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { commandId: randomUUID(), ...payload } });
      if (res.statusCode !== 200) {
        console.warn('Fixture setup warning on ' + url + ':', res.payload);
      }
    }

    const url = await hub.app.listen({ host: '0.0.0.0', port });
    console.log(JSON.stringify({ status: 'READY', url }));
    setInterval(() => {}, 60_000);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, async () => {
        await hub.close();
        process.exit(0);
      });
    }
  } catch (err) {
    await hub.close();
    throw err;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
