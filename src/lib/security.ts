import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "./db";
import type { User } from "./types";
const scrypt = promisify(scryptCb);
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, saved: string) {
  const [salt, hash] = saved.split(":");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hash, "hex");
  return stored.length === key.length && timingSafeEqual(stored, key);
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("pm_session")?.value;
  if (!token) return null;
  return (
    (db()
      .prepare(
        "SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.userId=u.id WHERE s.token=? AND s.expiresAt>?",
      )
      .get(hashToken(token), Date.now()) as User | undefined) || null
  );
}
export async function requireUser(admin = false) {
  const user = await currentUser();
  if (!user) throw new AppError("برای ادامه وارد حساب خود شوید.", 401);
  if (admin && user.role !== "admin")
    throw new AppError("دسترسی مدیریت لازم است.", 403);
  return user;
}
export async function createSession(userId: string) {
  const jar = await cookies();
  const old = jar.get("pm_session")?.value;
  if (old)
    db().prepare("DELETE FROM sessions WHERE token=?").run(hashToken(old));
  const token = randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM sessions WHERE expiresAt<=?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(hashToken(token), userId, Date.now() + 604800000);
  jar.set("pm_session", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get("pm_session")?.value;
  if (token)
    db().prepare("DELETE FROM sessions WHERE token=?").run(hashToken(token));
  jar.delete("pm_session");
}
export function rateLimit(key: string, max = 10, windowMs = 900000) {
  const d = db(),
    now = Date.now();
  const k = hashToken(key);
  d.prepare("DELETE FROM rate_limits WHERE resetAt<?").run(now);
  d.prepare(
    "INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
  ).run(k, now + windowMs);
  const row = d.prepare("SELECT count FROM rate_limits WHERE key=?").get(k) as {
    count: number;
  };
  if (row.count > max)
    throw new AppError(
      "درخواست‌های زیادی ارسال شده. چند دقیقه دیگر تلاش کنید.",
      429,
    );
}
export async function jsonBody(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (!origin || origin !== expected)
    throw new AppError("مبدأ درخواست معتبر نیست.", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("نوع درخواست معتبر نیست.", 415);
  // Bound the stream, not only Content-Length (which clients can omit).
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("درخواست خالی است.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new AppError("حجم درخواست بیش از حد است.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("ساختار درخواست معتبر نیست.");
  }
}
