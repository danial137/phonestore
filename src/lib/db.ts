import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { seedProducts } from "./seed.ts";
import type { Product, Order } from "./types.ts";

const globalDb = globalThis as unknown as { storeDb?: DatabaseSync };
export function db() {
  if (globalDb.storeDb) return globalDb.storeDb;
  const file = resolve(process.env.DATABASE_PATH || "./data/store.sqlite");
  mkdirSync(dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0), originalPrice INTEGER NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), colors TEXT NOT NULL, specs TEXT NOT NULL, featured INTEGER NOT NULL, active INTEGER NOT NULL, art TEXT NOT NULL, hue TEXT NOT NULL, description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), number TEXT UNIQUE NOT NULL, status TEXT NOT NULL, payment TEXT NOT NULL, subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, discount INTEGER NOT NULL, total INTEGER NOT NULL, recipient TEXT NOT NULL, phone TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, postalCode TEXT NOT NULL, items TEXT NOT NULL, createdAt TEXT NOT NULL, authority TEXT UNIQUE, paymentRef TEXT, idempotencyKey TEXT NOT NULL, expiresAt INTEGER, coupon TEXT, UNIQUE(userId,idempotencyKey));
    CREATE TABLE IF NOT EXISTS coupons (code TEXT PRIMARY KEY, percent INTEGER NOT NULL, maxDiscount INTEGER NOT NULL, active INTEGER NOT NULL, maxUses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL, message TEXT NOT NULL, reply TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resetAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_user ON orders(userId);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expiresAt);
  `);
  if (
    !(
      d.prepare("PRAGMA table_info(products)").all() as { name: string }[]
    ).some((c) => c.name === "imageUrl")
  )
    d.exec("ALTER TABLE products ADD COLUMN imageUrl TEXT NOT NULL DEFAULT ''");
  const hasProducts = d.prepare("SELECT COUNT(*) as n FROM products").get() as {
    n: number;
  };
  if (!hasProducts.n) {
    const stmt = d.prepare(
      "INSERT INTO products (id,slug,title,subtitle,brand,category,price,originalPrice,stock,colors,specs,featured,active,art,hue,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const p of seedProducts)
      stmt.run(
        p.id,
        p.slug,
        p.title,
        p.subtitle,
        p.brand,
        p.category,
        p.price,
        p.originalPrice,
        p.stock,
        JSON.stringify(p.colors),
        JSON.stringify(p.specs),
        Number(p.featured),
        Number(p.active),
        p.art,
        p.hue,
        p.description,
      );
  }
  d.prepare("INSERT OR IGNORE INTO coupons VALUES (?,?,?,?,?,?)").run(
    "WELCOME",
    5,
    500000,
    1,
    100,
    0,
  );
  globalDb.storeDb = d;
  return d;
}
export function productRow(row: unknown): Product {
  const p = row as Product & { colors: string; specs: string };
  return {
    ...p,
    colors: JSON.parse(p.colors),
    specs: JSON.parse(p.specs),
    featured: !!p.featured,
    active: !!p.active,
  };
}
export function products(includeInactive = false) {
  return db()
    .prepare(
      `SELECT * FROM products ${includeInactive ? "" : "WHERE active=1"} ORDER BY featured DESC, rowid ASC`,
    )
    .all()
    .map(productRow);
}
export function product(id: string) {
  const row = db()
    .prepare("SELECT * FROM products WHERE id=? OR slug=?")
    .get(id, id);
  return row ? productRow(row) : null;
}
export function orderRow(row: unknown): Order {
  const p = row as Order & { items: string };
  return { ...p, items: JSON.parse(p.items) };
}
export function transaction<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}
