import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
if (existsSync('.env.local')) Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const file = resolve(process.env.DATABASE_PATH || './data/store.sqlite');
if (!existsSync(file)) { console.error('First start the app and open the homepage to initialize the database.'); process.exit(1); }
const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = (process.env.ADMIN_EMAIL || await rl.question('Admin email: ')).trim().toLowerCase();
const name = process.env.ADMIN_NAME || await rl.question('Display name: ');
// Prefer an environment variable supplied by your secret manager for a non-echoed password.
const password = process.env.ADMIN_PASSWORD || await rl.question('Password (visible input; 12+ characters): '); rl.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128 || name.length < 2) { console.error('Invalid email, name or password.'); process.exit(1); }
const d = new DatabaseSync(file); d.exec('PRAGMA foreign_keys=ON');
if (d.prepare('SELECT id FROM users WHERE email=?').get(email)) { console.error('This email exists. No account was modified.'); process.exit(1); }
const salt = randomBytes(16).toString('hex'); const hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
d.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(randomUUID(), name, email, hash, 'admin', new Date().toISOString());
console.log('Admin created. Sign in through /auth, then visit /admin.'); d.close();
