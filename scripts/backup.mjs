import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';
if (existsSync('.env.local')) Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const source = resolve(process.env.DATABASE_PATH || './data/store.sqlite');
if (!existsSync(source)) throw new Error('Database does not exist. Start the app first.');
const target = resolve(process.argv[2] || `./backups/store-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
if (source === target || existsSync(target)) throw new Error('Backup path must be a new file, separate from the source.');
mkdirSync(dirname(target), { recursive: true }); const d = new DatabaseSync(source, { readOnly: true });
try { await backup(d, target); console.log('Backup saved:', target); } finally { d.close(); }
