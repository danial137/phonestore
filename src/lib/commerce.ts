import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, product, orderRow, transaction } from "./db";
import { AppError } from "./security";
import { normalizeDigits } from "./format";
import type { CartItem, OrderItem } from "./types";

const digits = z.string().transform(normalizeDigits);
export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(10),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .min(1)
    .max(30),
  recipient: z.string().trim().min(3).max(100),
  phone: digits.pipe(z.string().regex(/^09\d{9}$/)),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(10).max(500),
  postalCode: digits.pipe(z.string().regex(/^\d{10}$/)),
  coupon: z.string().trim().max(32).default(""),
  payment: z.enum(["cod", "zarinpal"]),
  idempotencyKey: z.string().uuid(),
});
export function quote(items: CartItem[], code = "") {
  const merged = new Map<string, CartItem>();
  for (const item of items) {
    const key = item.productId + ":" + item.color;
    const old = merged.get(key);
    merged.set(key, {
      ...item,
      quantity: item.quantity + (old?.quantity || 0),
    });
  }
  const quantities = new Map<string, number>();
  const lines: OrderItem[] = [];
  for (const item of merged.values()) {
    const p = product(item.productId);
    if (!p || !p.active)
      throw new AppError("یکی از محصولات دیگر در فروشگاه موجود نیست.");
    if (!p.colors.includes(item.color))
      throw new AppError("رنگ انتخابی موجود نیست.");
    const count = (quantities.get(p.id) || 0) + item.quantity;
    if (count > p.stock || count > 10)
      throw new AppError(`موجودی «${p.title}» کافی نیست (حداکثر ۱۰ عدد).`);
    quantities.set(p.id, count);
    lines.push({
      ...item,
      title: p.title,
      price: p.price,
      art: p.art,
      hue: p.hue,
    });
  }
  const subtotal = lines.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = 0;
  if (code) {
    const coupon = db()
      .prepare(
        "SELECT * FROM coupons WHERE code=? AND active=1 AND uses<maxUses",
      )
      .get(code.toUpperCase()) as
      | { percent: number; maxDiscount: number }
      | undefined;
    if (!coupon)
      throw new AppError("کد تخفیف نامعتبر است یا ظرفیت آن تمام شده.");
    discount = Math.min(
      Math.floor((subtotal * coupon.percent) / 100),
      coupon.maxDiscount,
    );
  }
  const shipping = subtotal >= 20000000 ? 0 : 90000;
  return {
    items: lines,
    subtotal,
    discount,
    shipping,
    total: subtotal + shipping - discount,
    quantities,
  };
}
export function createOrder(
  userId: string,
  input: z.infer<typeof checkoutSchema>,
) {
  return transaction(() => {
    const d = db();
    const existing = d
      .prepare("SELECT * FROM orders WHERE userId=? AND idempotencyKey=?")
      .get(userId, input.idempotencyKey);
    if (existing) return orderRow(existing);
    const q = quote(input.items, input.coupon);
    for (const [id, quantity] of q.quantities)
      d.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(
        quantity,
        id,
      );
    if (input.coupon)
      d.prepare("UPDATE coupons SET uses=uses+1 WHERE code=?").run(
        input.coupon.toUpperCase(),
      );
    const id = randomUUID(),
      number = "PM-" + randomBytes(5).toString("hex").toUpperCase();
    d.prepare(
      `INSERT INTO orders (id,userId,number,status,payment,subtotal,shipping,discount,total,recipient,phone,city,address,postalCode,items,createdAt,idempotencyKey,coupon) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      userId,
      number,
      input.payment === "cod" ? "confirmed" : "pending_payment",
      input.payment,
      q.subtotal,
      q.shipping,
      q.discount,
      q.total,
      input.recipient,
      input.phone,
      input.city,
      input.address,
      input.postalCode,
      JSON.stringify(q.items),
      new Date().toISOString(),
      input.idempotencyKey,
      input.coupon.toUpperCase() || null,
    );
    return orderRow(d.prepare("SELECT * FROM orders WHERE id=?").get(id));
  });
}
const transitions: Record<string, string[]> = {
  confirmed: ["processing", "cancelled"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  pending_payment: [],
};
export function updateOrder(id: string, status: string) {
  return transaction(() => {
    const row = db().prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!row) throw new AppError("سفارش پیدا نشد.", 404);
    const order = orderRow(row);
    if (!transitions[order.status]?.includes(status))
      throw new AppError("این تغییر وضعیت مجاز نیست.");
    if (status === "cancelled") {
      if (order.payment === "zarinpal")
        throw new AppError(
          "لغو سفارش پرداخت‌شده به فرایند بازپرداخت نیاز دارد.",
        );
      for (const item of order.items)
        db()
          .prepare("UPDATE products SET stock=stock+? WHERE id=?")
          .run(item.quantity, item.productId);
      db()
        .prepare(
          "UPDATE coupons SET uses=MAX(0,uses-1) WHERE code=(SELECT coupon FROM orders WHERE id=?)",
        )
        .run(id);
    }
    db().prepare("UPDATE orders SET status=? WHERE id=?").run(status, id);
    return orderRow(db().prepare("SELECT * FROM orders WHERE id=?").get(id));
  });
}
export function cancelUninitiatedPayment(id: string) {
  transaction(() => {
    const row = db()
      .prepare(
        "SELECT * FROM orders WHERE id=? AND status='pending_payment' AND authority IS NULL",
      )
      .get(id);
    if (!row) return;
    const order = orderRow(row);
    for (const item of order.items)
      db()
        .prepare("UPDATE products SET stock=stock+? WHERE id=?")
        .run(item.quantity, item.productId);
    db()
      .prepare(
        "UPDATE coupons SET uses=MAX(0,uses-1) WHERE code=(SELECT coupon FROM orders WHERE id=?)",
      )
      .run(id);
    db().prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);
  });
}
