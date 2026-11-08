import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';

test('explicit web origin gets a bounded preflight while other origins are denied', async () => {
  const hub=await createHub({databasePath:':memory:',allowedOrigins:['http://localhost:8181']});
  try {
    const denied=await hub.app.inject({method:'POST',url:'/api/v1/auth/staff',headers:{origin:'https://untrusted.example'},payload:{}});
    assert.equal(denied.statusCode,403);
    assert.equal(denied.headers['access-control-allow-origin'],undefined);
    const preflight=await hub.app.inject({method:'OPTIONS',url:'/api/v1/products',headers:{origin:'http://localhost:8181','access-control-request-method':'GET','access-control-request-headers':'authorization'}});
    assert.equal(preflight.statusCode,204);
    assert.equal(preflight.headers['access-control-allow-origin'],'http://localhost:8181');
    assert.equal(preflight.headers['access-control-allow-credentials'],undefined);
    const wrongHeaders=await hub.app.inject({method:'OPTIONS',url:'/api/v1/products',headers:{origin:'http://localhost:8181','access-control-request-method':'GET','access-control-request-headers':'x-forged-role'}});
    assert.equal(wrongHeaders.statusCode,403);
  } finally {await hub.close();}
});

test('loopback HTTP listener exposes health without serving source or protected records', async () => {
  const hub = await createHub({ databasePath: ':memory:' });
  try {
    const address = await hub.app.listen({ host: '127.0.0.1', port: 0 });
    const health = await fetch(address + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ready' });
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.equal(health.headers.get('access-control-allow-origin'), null);
    assert.equal(health.headers.get('server'), null);
    for (const path of ['/api/v1/me','/api/v1/devices']) {
      const denied = await fetch(address + path);
      assert.equal(denied.status, 401);
      assert.ok(!/sqlite|credential_hash|token_hash|stack/i.test(await denied.text()));
    }
    for (const path of ['/src/hub.ts','/migrations/001_authority.sql','/.env','/package.json']) {
      const hidden = await fetch(address + path);
      assert.equal(hidden.status, 404);
    }
  } finally {
    await hub.close();
  }
});
