import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHub } from './hub.js';
import { isAdminRole, isStaffRole } from './validation.js';

const databasePath = process.env.KAPE_DOZ_DATABASE_PATH;
const id = process.env.KAPE_DOZ_PROVISION_ID;
const branchId = process.env.KAPE_DOZ_PROVISION_BRANCH;
const secret = process.env.KAPE_DOZ_PROVISION_SECRET;
const kind = process.env.KAPE_DOZ_PROVISION_KIND;
if (!databasePath || !id || !branchId || !secret || !kind) throw new Error('Explicit database, identity, branch, kind and secret are required.');
mkdirSync(dirname(databasePath), { recursive: true });
const hub = await createHub({ databasePath });
try {
  if (kind === 'device') await hub.provisionDevice({ id, branchId, secret });
  else if (isStaffRole(kind) || isAdminRole(kind)) await hub.provisionAccount({ id, branchId, role: kind, secret, displayName: process.env.KAPE_DOZ_PROVISION_NAME ?? id });
  else throw new Error('Unknown provisioning kind.');
  console.log('Provisioned identity without exporting credentials.');
} finally {
  await hub.close();
}
