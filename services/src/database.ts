import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

type MigrationOption = {
  rebuildsReferencedTables?: boolean;
  afterApply?: (db: DatabaseSync) => void;
};

const MIGRATION_OPTIONS: Record<string, MigrationOption> = {
  '008_order_cancellations.sql': { rebuildsReferencedTables: true },
  '011_hub_identity.sql': {
    afterApply: (db) => {
      db.prepare('INSERT INTO hub_identity(singleton,authority_id) VALUES(1,?)').run(randomUUID());
    },
  },
  '013_inventory_counts.sql': { rebuildsReferencedTables: true },
};

export class HubDatabase {
  readonly connection: DatabaseSync;
  readonly authorityId: string;

  constructor(databasePath: string) {
    this.connection = new DatabaseSync(databasePath);
    try {
      this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;');
      const versions = this.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
      const migrations = ['001_authority.sql', '002_auth_reservations.sql', '003_business.sql', '004_command_context.sql', '005_operating_expenses.sql', '006_sales_valuation.sql', '007_order_approvals.sql', '008_order_cancellations.sql', '009_refunds.sql', '010_command_outcomes.sql', '011_hub_identity.sql', '012_sent_order_amendments.sql', '013_inventory_counts.sql', '014_inventory_alerts.sql', '015_threshold_history.sql', '016_product_availability.sql', '017_recipes_and_receiving.sql', '018_customers_and_loyalty.sql', '019_setup_csv_recovery_and_printers.sql', '020_device_pairing_and_discovery.sql'];
      if (versions.some((row, index) => Number(row.version) !== index + 1) || versions.length > migrations.length) throw new Error('Unsupported database schema version.');
      for (let index = versions.length; index < migrations.length; index++) {
        const name = migrations[index]!;
        const options = MIGRATION_OPTIONS[name];
        // Some migrations rebuild referenced tables. Check all retained references in
        // the startup transaction before restoring enforcement and serving requests.
        if (options?.rebuildsReferencedTables) this.connection.exec('PRAGMA foreign_keys=OFF;');
        try {
          this.transaction(() => {
            if (this.connection.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(index + 1)) return;
            this.connection.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
            options?.afterApply?.(this.connection);
            if (options?.rebuildsReferencedTables && this.connection.prepare('PRAGMA foreign_key_check').get()) {
              throw new Error('The database contains invalid references. Migration was rolled back.');
            }
            this.connection.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(index + 1, name);
          });
        } finally {
          if (options?.rebuildsReferencedTables) this.connection.exec('PRAGMA foreign_keys=ON;');
        }
      }
      const identity = this.connection.prepare('SELECT authority_id FROM hub_identity WHERE singleton=1').get();
      if (!identity || typeof identity.authority_id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity.authority_id)) {
        throw new Error('The hub authority identity is missing or invalid.');
      }
      this.authorityId = identity.authority_id;
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  transaction<T>(action: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      if (result instanceof Promise) throw new Error('Database transactions cannot contain asynchronous work.');
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.connection.close(); }
}
