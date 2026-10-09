import { db } from "./db";
import { AppError } from "./security";
import type { Order } from "./types";
export const paymentConfigured = () => !!process.env.ZARINPAL_MERCHANT_ID;
const host = () =>
  process.env.ZARINPAL_SANDBOX === "true"
    ? "sandbox.zarinpal.com"
    : "payment.zarinpal.com";
export async function startPayment(order: Order) {
  if (!paymentConfigured())
    throw new AppError("درگاه پرداخت تنظیم نشده است.", 503);
  if (order.status !== "pending_payment") return null;
  const old = db()
    .prepare("SELECT authority FROM orders WHERE id=?")
    .get(order.id) as { authority: string | null };
  if (old.authority)
    return `https://${host()}/pg/StartPay/${encodeURIComponent(old.authority)}`;
  const response = await fetch(`https://${host()}/pg/v4/payment/request.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      merchant_id: process.env.ZARINPAL_MERCHANT_ID,
      amount: order.total * 10,
      callback_url: `${process.env.APP_URL}/api/payments/callback`,
      description: `Persian Mobile ${order.number}`,
      metadata: { mobile: order.phone },
    }),
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.data?.code !== 100 ||
    typeof result.data.authority !== "string"
  )
    throw new AppError(
      "اتصال به درگاه انجام نشد. دوباره از صفحه سفارش تلاش کنید.",
      502,
    );
  db()
    .prepare(
      "UPDATE orders SET authority=? WHERE id=? AND authority IS NULL AND status='pending_payment'",
    )
    .run(result.data.authority, order.id);
  const saved = db()
    .prepare("SELECT authority FROM orders WHERE id=?")
    .get(order.id) as { authority: string };
  return `https://${host()}/pg/StartPay/${encodeURIComponent(saved.authority)}`;
}
export async function verifyPayment(authority: string) {
  const order = db()
    .prepare("SELECT id,total,status FROM orders WHERE authority=?")
    .get(authority) as
    | { id: string; total: number; status: string }
    | undefined;
  if (!order) throw new AppError("تراکنش پیدا نشد.", 404);
  if (order.status !== "pending_payment")
    return { id: order.id, paid: order.status !== "cancelled" };
  const response = await fetch(`https://${host()}/pg/v4/payment/verify.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      merchant_id: process.env.ZARINPAL_MERCHANT_ID,
      amount: order.total * 10,
      authority,
    }),
  });
  const result = await response.json();
  const paid = response.ok && [100, 101].includes(result.data?.code);
  if (paid)
    db()
      .prepare(
        "UPDATE orders SET status='confirmed', paymentRef=? WHERE id=? AND status='pending_payment'",
      )
      .run(String(result.data.ref_id), order.id);
  return { id: order.id, paid };
}
