export const money = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
export const digits = (n: number | string) =>
  String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
export const normalizeDigits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const date = (s: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(s));
export const colorNames: Record<string, string> = {
  "#b9ae9d": "تیتانیوم طبیعی",
  "#22252b": "مشکی",
  "#d9e3ec": "آبی روشن",
  "#bbb2d4": "بنفش",
  "#e4e7e5": "نقره‌ای",
  "#879f8f": "سبز",
  "#f5f5f0": "سفید",
};
