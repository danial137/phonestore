import { OrderDetail } from '@/components/account';
export const metadata={title:'جزئیات سفارش'};
export default async function Page({params}:{params:Promise<{id:string}>}){return <OrderDetail id={(await params).id}/>;}
