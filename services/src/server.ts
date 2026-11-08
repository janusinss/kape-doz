import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHub } from './hub.js';

const databasePath = process.env.KAPE_DOZ_DATABASE_PATH;
if (!databasePath) throw new Error('KAPE_DOZ_DATABASE_PATH must point to protected persistent storage.');
const host = process.env.KAPE_DOZ_HOST ?? '127.0.0.1';
const port = Number(process.env.KAPE_DOZ_PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid service port.');
const certPath = process.env.KAPE_DOZ_TLS_CERT;
const keyPath = process.env.KAPE_DOZ_TLS_KEY;
const allowLanHttp = process.env.KAPE_DOZ_ALLOW_LAN_HTTP === '1';
if (!!certPath !== !!keyPath) throw new Error('Both TLS certificate and key are required.');
if (!certPath && host !== '127.0.0.1' && host !== '::1' && !allowLanHttp) throw new Error('Network binding requires TLS.');
mkdirSync(dirname(databasePath), { recursive: true });
const allowedOrigins=(process.env.KAPE_DOZ_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
const hub = await createHub({ databasePath, allowedOrigins, allowPrivateLanHttp: allowLanHttp, logger: true, ...(certPath && keyPath ? { https: { cert: readFileSync(certPath), key: readFileSync(keyPath) } } : {}) });
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { void hub.close().then(() => { process.exitCode = 0; }); });
try {
  await hub.app.listen({ host, port });
} catch (error) {
  await hub.close();
  throw error;
}
