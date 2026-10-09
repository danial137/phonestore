import { Suspense } from 'react';
import { Catalog } from '@/components/catalog';
export const metadata={title:'محصولات'};
export default function Page(){return <Suspense fallback={<div className="loading">در حال بارگذاری…</div>}><Catalog/></Suspense>;}
