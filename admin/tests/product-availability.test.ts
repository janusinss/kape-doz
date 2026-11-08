import assert from 'node:assert/strict';
import test from 'node:test';
import { api, commandAction, HubError, refreshCommand, validateCommandStatus, type Mutation, type Session } from '../src/api';
import { AdminRecoveryError, pendingAdminCommand } from '../src/admin_recovery';

const commandId = '9cce8488-4531-4c38-8fc0-eab62d6a32cb';
const session: Session = {
  token: 'fixture-token', expiresAt: Date.now() + 60_000,
  authorityId: 'b2ac6c5c-7fba-41b3-9296-25374f3ec4ad', hubOrigin: 'http://127.0.0.1',
  actor: { id: 'manager', displayName: 'Fixture manager', branchId: 'branch', role: 'manager' },
};
const scope = { hubOrigin: session.hubOrigin, authorityId: session.authorityId, actorId: 'manager', branchId: 'branch', role: 'manager' as const };
const command: Mutation = { id: commandId, path: '/api/v1/products/latte/availability',
  data: { expectedVersion: 3, available: false, reason: 'Temporarily unavailable' },
  label: 'Product availability saved.', actorId: scope.actorId, branchId: scope.branchId };
const product = { id: 'latte', name: 'Latte', priceCentavos: 16500, version: 2, availabilityVersion: 4,
  available: false, recipe: [{ ingredientId: 'beans', quantityMilli: 18000 }] };

test('availability commands bind the target, version, state, reason and account', () => {
  const saved = pendingAdminCommand(command, scope, 1000);
  assert.equal(commandAction(saved), 'product.availability.set');
  for (const invalid of [
    { ...command, path: '/api/v1/products/../availability' },
    { ...command, data: { ...command.data, expectedVersion: 0 } },
    { ...command, data: { ...command.data, available: 'false' } },
    { ...command, data: { ...command.data, reason: ' ' } },
    { ...command, data: { ...command.data, reason: 'x'.repeat(161) } },
    { ...command, data: { ...command.data, extra: true } },
  ]) assert.throws(() => pendingAdminCommand(invalid, scope, 1000), AdminRecoveryError);
});

test('the recovery journal accepts a recorded unavailable-product rejection for an amendment', () => {
  const amendment: Mutation = { ...command, path: '/api/v1/amendments/changed/decision', data: { decision: 'approve', reason: 'Approved' } };
  const saved = pendingAdminCommand(amendment, scope, 1000);
  const rejected = { commandId, status: 'rejected', action: 'order.amendment.decide', rejectedAt: 1000,
    error: { code: 'product_unavailable', message: 'The product is unavailable.' } };
  assert.deepEqual(validateCommandStatus(rejected, saved), rejected);
});

test('availability acknowledgement binds its product and version before recovery unlock', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: session.hubOrigin } } });
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  let response: unknown = { commandId, product };
  let listing: unknown = { products: [product] };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push(new URL(url).pathname);
    assert.equal(new Headers(init?.headers).get('X-Kape-Doz-Authority'), session.authorityId);
    return new Response(JSON.stringify(init?.method === 'POST' ? response : listing), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const saved = pendingAdminCommand(command, scope, 1000);
  await api.mutate(session, saved);
  for (const invalid of [
    { ...product, id: 'other' }, { ...product, availabilityVersion: 5 }, { ...product, available: true },
    { ...product, available: undefined }, { ...product, recipe: [{ ingredientId: 'beans', quantityMilli: 0 }] },
  ]) {
    response = { commandId, product: invalid };
    await assert.rejects(api.mutate(session, saved), error => error instanceof HubError && error.unknown);
  }
  await refreshCommand(session, saved);
  assert.ok(calls.includes('/api/v1/products'));
  listing = { products: [{ ...product, availabilityVersion: 0 }] };
  await assert.rejects(refreshCommand(session, saved), HubError);
  const { available: _available, availabilityVersion: _availabilityVersion, ...legacy } = product;
  listing = { products: [legacy] };
  await refreshCommand(session, saved);
});

test('recipe update commands bind the target, version, price, recipe and options', async t => {
  const recipeCommand: Mutation = {
    id: commandId,
    path: '/api/v1/products/latte/recipe',
    data: {
      expectedVersion: 1,
      name: 'Latte',
      priceCentavos: 18000,
      recipe: [{ ingredientId: 'beans', quantityMilli: 20000 }],
      sizes: [{ id: 'large', name: '16oz Large', priceDeltaCentavos: 3000, recipe: [{ ingredientId: 'beans', quantityMilli: 26000 }] }],
      substitutions: [{ id: 'sub-oat', name: 'Oat Milk', priceDeltaCentavos: 2500, replaceIngredientId: 'beans', withIngredientId: 'oat-milk', quantityMilli: 200000 }],
      addons: [{ id: 'extra-shot', name: 'Extra Shot', priceDeltaCentavos: 2000, recipe: [{ ingredientId: 'beans', quantityMilli: 9000 }] }],
      dineInPackaging: [{ ingredientId: 'sleeve', quantityMilli: 1000 }],
      takeoutPackaging: [{ ingredientId: 'to-go-cup', quantityMilli: 1000 }],
    },
    label: 'Recipe updated to version 2.',
    actorId: scope.actorId,
    branchId: scope.branchId,
  };
  const saved = pendingAdminCommand(recipeCommand, scope, 1000);
  assert.equal(commandAction(saved), 'product.recipe.update');
  for (const invalid of [
    { ...recipeCommand, path: '/api/v1/products/../recipe' },
    { ...recipeCommand, data: { ...recipeCommand.data, expectedVersion: 0 } },
    { ...recipeCommand, data: { ...recipeCommand.data, priceCentavos: 0 } },
    { ...recipeCommand, data: { ...recipeCommand.data, recipe: [] } },
    { ...recipeCommand, data: { ...recipeCommand.data, substitutions: [{ id: 'sub-oat', name: 'Oat', priceDeltaCentavos: 0, replaceIngredientId: 'beans', withIngredientId: 'beans' }] } },
  ]) assert.throws(() => pendingAdminCommand(invalid, scope, 1000), AdminRecoveryError);

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: session.hubOrigin } } });
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  const updatedProduct = {
    ...product,
    version: 2,
    priceCentavos: 18000,
    recipe: [{ ingredientId: 'beans', quantityMilli: 20000 }],
    options: {
      sizes: recipeCommand.data.sizes,
      substitutions: recipeCommand.data.substitutions,
      addons: recipeCommand.data.addons,
      dineInPackaging: recipeCommand.data.dineInPackaging,
      takeoutPackaging: recipeCommand.data.takeoutPackaging,
    },
  };
  let response: unknown = { commandId, product: updatedProduct };
  const listing: unknown = { products: [updatedProduct] };
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    return new Response(JSON.stringify(init?.method === 'POST' ? response : listing), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await api.mutate(session, saved);
  await refreshCommand(session, saved);
  response = { commandId, product: { ...updatedProduct, version: 1 } };
  await assert.rejects(api.mutate(session, saved), error => error instanceof HubError && error.unknown);
});
