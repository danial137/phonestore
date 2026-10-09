export type Product = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  brand: string;
  category: string;
  price: number;
  originalPrice: number;
  stock: number;
  colors: string[];
  specs: Record<string, string>;
  featured: boolean;
  active: boolean;
  art: string;
  hue: string;
  description: string;
  imageUrl?: string;
};
export type User = {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
};
export type CartItem = { productId: string; quantity: number; color: string };
export type OrderItem = CartItem & {
  title: string;
  price: number;
  art: string;
  hue: string;
};
export type Order = {
  id: string;
  userId: string;
  number: string;
  status: string;
  payment: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  recipient: string;
  phone: string;
  city: string;
  address: string;
  postalCode: string;
  items: OrderItem[];
  createdAt: string;
  paymentRef: string | null;
};
export const statusLabels: Record<string, string> = {
  pending_payment: "در انتظار پرداخت",
  confirmed: "ثبت شده",
  processing: "در حال آماده‌سازی",
  shipped: "تحویل پست",
  delivered: "تحویل داده شده",
  cancelled: "لغو شده",
};
export const categories = [
  { id: "phone", name: "گوشی موبایل", subtitle: "همراه هر روزت", art: "phone" },
  {
    id: "earbuds",
    name: "هدفون و هندزفری",
    subtitle: "غرق در موسیقی",
    art: "earbuds",
  },
  { id: "watch", name: "ساعت هوشمند", subtitle: "یک قدم جلوتر", art: "watch" },
  { id: "tablet", name: "تبلت", subtitle: "بزرگ‌تر فکر کن", art: "tablet" },
  {
    id: "accessory",
    name: "لوازم جانبی",
    subtitle: "جزئیات مهم‌اند",
    art: "charger",
  },
];
