import { product } from '@/lib/db';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product-detail';
type Props={params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props){const p=product((await params).slug);return {title:p?.title||'محصول پیدا نشد'};}
export default async function Page({params}:Props){const p=product((await params).slug);if(!p?.active)notFound();return <ProductDetail product={p}/>;}
