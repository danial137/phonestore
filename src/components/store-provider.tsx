'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { CheckCircle2, X, AlertCircle } from 'lucide-react';
import type { Product, CartItem, User } from '@/lib/types';
type Notice={message:string;error?:boolean};
type Store={products:Product[];cart:CartItem[];user:User|null;authReady:boolean;ready:boolean;wishlist:string[];compare:string[];add:(p:Product,color?:string,qty?:number)=>void;setQuantity:(id:string,color:string,qty:number)=>void;clearCart:()=>void;toggleWish:(id:string)=>void;toggleCompare:(id:string)=>void;notify:(message:string,error?:boolean)=>void;refreshUser:()=>Promise<void>};
const Context=createContext<Store|null>(null);
export async function api<T=any>(path:string,method='GET',body?:unknown):Promise<T> {
  const res=await fetch(`/api/${path}`,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'خطا در ارتباط با سرور.');return data;
}
export function StoreProvider({products,children}:{products:Product[];children:React.ReactNode}) {
  const [cart,setCart]=useState<CartItem[]>([]),[wishlist,setWishlist]=useState<string[]>([]),[compare,setCompare]=useState<string[]>([]);
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[authReady,setAuthReady]=useState(false),[notice,setNotice]=useState<Notice|null>(null);
  const notify=useCallback((message:string,error=false)=>setNotice({message,error}),[]);
  const refreshUser=useCallback(async()=>{try{const data=await api('me');setUser(data.user);}finally{setAuthReady(true);}},[]);
  useEffect(()=>{
    try {const saved=JSON.parse(localStorage.getItem('pm-store')||'{}');
      if(Array.isArray(saved.cart))setCart(saved.cart.filter((i:CartItem)=>typeof i.productId==='string'&&typeof i.color==='string'&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=10));
      if(Array.isArray(saved.wishlist))setWishlist(saved.wishlist.filter((x:unknown)=>typeof x==='string'));
      if(Array.isArray(saved.compare))setCompare(saved.compare.filter((x:unknown)=>typeof x==='string').slice(0,3));
    }catch{}setReady(true);refreshUser().catch(()=>{});
  },[refreshUser]);
  useEffect(()=>{if(ready)try{localStorage.setItem('pm-store',JSON.stringify({cart,wishlist,compare}));}catch{}},[cart,wishlist,compare,ready]);
  useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(null),4000);return()=>clearTimeout(timer);}},[notice]);
  function add(p:Product,color=p.colors[0],qty=1){
    const current=cart.filter(i=>i.productId===p.id).reduce((s,i)=>s+i.quantity,0);
    if(!p.active||current+qty>Math.min(10,p.stock)){notify('بیشتر از موجودی قابل خرید نیست.',true);return;}
    setCart(items=>{const exists=items.some(i=>i.productId===p.id&&i.color===color);return exists?items.map(i=>i.productId===p.id&&i.color===color?{...i,quantity:i.quantity+qty}:i):[...items,{productId:p.id,color,quantity:qty}];});notify('به سبد خرید اضافه شد.');
  }
  function setQuantity(id:string,color:string,qty:number){
    const p=products.find(p=>p.id===id),others=cart.filter(i=>i.productId===id&&i.color!==color).reduce((s,i)=>s+i.quantity,0);
    if(qty>0&&(!p||qty+others>Math.min(p.stock,10))){notify('تعداد انتخابی از موجودی بیشتر است.',true);return;}
    setCart(items=>qty<=0?items.filter(i=>!(i.productId===id&&i.color===color)):items.map(i=>i.productId===id&&i.color===color?{...i,quantity:qty}:i));
  }
  const toggleWish=(id:string)=>setWishlist(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id]);
  const toggleCompare=(id:string)=>{if(compare.includes(id))setCompare(a=>a.filter(x=>x!==id));else if(compare.length<3){setCompare(a=>[...a,id]);notify('به مقایسه اضافه شد.');}else notify('حداکثر ۳ محصول را مقایسه کنید.',true);};
  return <Context.Provider value={{products,cart,user,ready,authReady,wishlist,compare,add,setQuantity,clearCart:()=>setCart([]),toggleWish,toggleCompare,notify,refreshUser}}>{children}{notice&&<div className={`toast ${notice.error?'error':''}`} role="status">{notice.error?<AlertCircle size={21}/>:<CheckCircle2 size={21}/>}<span>{notice.message}</span><button aria-label="بستن پیام" onClick={()=>setNotice(null)}><X size={18}/></button></div>}</Context.Provider>;
}
export function useStore(){const context=useContext(Context);if(!context)throw new Error('Missing StoreProvider');return context;}
