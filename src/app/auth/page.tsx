import { Suspense } from 'react';
import { Auth } from '@/components/account';
export const metadata={title:'ورود و ثبت‌نام'};
export default function Page(){return <Suspense><Auth/></Suspense>;}
