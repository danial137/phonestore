'use client';
import Link from 'next/link';
import { Heart, Plus, GitCompareArrows, ArrowUpLeft } from 'lucide-react';
import type { Product } from '@/lib/types';
import { ProductMedia } from './product-art';
import { useStore } from './store-provider';
import { money, digits } from '@/lib/format';
export function ProductCard({product:p}:{product:Product}){
  const {add,wishlist,toggleWish,compare,toggleCompare}=useStore();const discount=p.originalPrice>p.price?Math.round((1-p.price/p.originalPrice)*100):0;
  return <article className="product-card"><div className="product-visual"><Link href={`/products/${p.slug}`} aria-label={p.title}><ProductMedia product={p}/></Link>{discount>0&&<span className="discount">{digits(discount)}٪</span>}<div className="card-tools"><button className={wishlist.includes(p.id)?'selected':''} aria-label={`علاقه‌مندی ${p.title}`} onClick={()=>toggleWish(p.id)}><Heart size={18} fill={wishlist.includes(p.id)?'currentColor':'none'}/></button><button className={compare.includes(p.id)?'selected':''} aria-label={`مقایسه ${p.title}`} onClick={()=>toggleCompare(p.id)}><GitCompareArrows size={18}/></button></div><div className="swatches">{p.colors.map(c=><span key={c} style={{background:c}}/>)}</div></div><div className="product-info"><span className="product-brand">{p.brand}</span><Link href={`/products/${p.slug}`}><h3>{p.title}</h3></Link><p className="product-subtitle" dir="ltr">{p.subtitle.split(' · ').slice(1).join(' · ')||p.subtitle}</p><div className="product-bottom"><div className="price">{p.originalPrice>p.price&&<del>{money(p.originalPrice)}</del>}<strong>{money(p.price)} <small>تومان</small></strong></div><button disabled={!p.stock} className="add-btn" aria-label={`افزودن ${p.title} به سبد`} onClick={()=>add(p)}><Plus size={22}/></button></div>{!p.stock&&<span className="out-stock">ناموجود</span>}</div></article>;
}
export function SectionTitle({eyebrow,title,href='/products',link='مشاهده همه'}:{eyebrow:string;title:string;href?:string;link?:string}){return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Link href={href}>{link}<ArrowUpLeft size={19}/></Link></div>;}
