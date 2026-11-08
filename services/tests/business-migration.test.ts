import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubDatabase } from '../src/database.js';

function legacyDatabase(invalidCash:boolean) {
  const root=fileURLToPath(new URL('../../scratch/service-loop-tests/',import.meta.url));
  mkdirSync(root,{recursive:true});
  const folder=mkdtempSync(join(root,'schema3-'));
  const path=join(folder,'hub.sqlite');
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;');
  for(const [index,name] of ['001_authority.sql','002_auth_reservations.sql','003_business.sql'].entries()) {
    db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
    db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index+1,name);
  }
  db.prepare('INSERT INTO branches(id) VALUES(?)').run('legacy-branch');
  db.prepare('INSERT INTO accounts(id,branch_id,display_name,role,credential_hash) VALUES(?,?,?,?,?)').run('legacy-cashier','legacy-branch','Legacy fixture','cashier','fixture-only-digest');
  db.prepare('INSERT INTO command_receipts(id,actor_id,branch_id,action,fingerprint,response_json,accepted_at) VALUES(?,?,?,?,?,?,?)').run('legacy-command','legacy-cashier','legacy-branch','fixture','fixture','{}',0);
  db.prepare('INSERT INTO orders(id,branch_id,order_no,version,dine_in,table_ref,release_policy,accepted_at,total_centavos) VALUES(?,?,1,1,0,?,?,0,1)').run('legacy-order','legacy-branch','','after_payment');
  db.prepare("INSERT INTO payments(id,branch_id,order_id,method,amount_centavos,status,cash_received_centavos,change_centavos,accepted_at,command_id) VALUES(?,?,?,'cash',1,'confirmed',?,?,0,?)").run('legacy-payment','legacy-branch','legacy-order',invalidCash?null:1,invalidCash?null:0,'legacy-command');
  db.close();
  return {path,cleanup:()=>{assert.ok(resolve(folder).startsWith(resolve(root)+sep));rmSync(folder,{recursive:true,force:true});}};
}

test('schema-3 upgrade preserves accepted cash and adds authenticated-device metadata and cash guards',()=>{
  const fixture=legacyDatabase(false);
  let migrated:HubDatabase|undefined;
  try {
    migrated=new HubDatabase(fixture.path);
    const db=migrated.connection;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 20);
    assert.deepEqual({...db.prepare('SELECT amount_centavos,cash_received_centavos,change_centavos FROM payments WHERE id=?').get('legacy-payment')},{amount_centavos:1,cash_received_centavos:1,change_centavos:0});
    assert.equal(db.prepare('SELECT device_id FROM command_receipts WHERE id=?').get('legacy-command')!.device_id,null);
    assert.throws(()=>db.prepare('UPDATE payments SET cash_received_centavos=NULL WHERE id=?').run('legacy-payment'),/CHECK/);
    assert.equal(db.prepare('SELECT cash_received_centavos FROM payments WHERE id=?').get('legacy-payment')!.cash_received_centavos,1);
  } finally {migrated?.close();fixture.cleanup();}
});

test('invalid legacy cash causes migration rollback without deleting or resetting records',()=>{
  const fixture=legacyDatabase(true);
  try {
    assert.throws(()=>new HubDatabase(fixture.path),/CHECK/);
    const db=new DatabaseSync(fixture.path);
    try {
      assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version,3);
      assert.equal(db.prepare('SELECT cash_received_centavos FROM payments WHERE id=?').get('legacy-payment')!.cash_received_centavos,null);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM orders').get()!.total,1);
      assert.equal(db.prepare("SELECT COUNT(*) AS total FROM pragma_table_info('command_receipts') WHERE name='device_id'").get()!.total,0);
    } finally {db.close();}
  } finally {fixture.cleanup();}
});
