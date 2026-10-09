import type { Metadata } from 'next';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import './globals.css';
import { StoreProvider } from '@/components/store-provider';
import { Header,Footer } from '@/components/shell';
import { products } from '@/lib/db';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const metadata:Metadata={title:{default:'پرشین موبایل | دنیای دیجیتال، به سبک تو',template:'%s | پرشین موبایل'},description:'فروشگاه فارسی موبایل و لوازم دیجیتال. انتخاب، مقایسه و خرید آنلاین گوشی، ساعت هوشمند و هدفون.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fa" dir="rtl"><body><StoreProvider products={products()}><a href="#main" className="skip-link">رفتن به محتوای اصلی</a><Header/><main id="main">{children}</main><Footer/></StoreProvider></body></html>;}
