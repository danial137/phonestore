import Link from 'next/link';
import { ChevronLeft, PackageOpen } from 'lucide-react';
export function Breadcrumb({items}:{items:{label:string;href?:string}[]}){return <div className="breadcrumb"><Link href="/">خانه</Link>{items.map((i,n)=><span key={n} style={{display:'contents'}}><ChevronLeft size={14}/>{i.href?<Link href={i.href}>{i.label}</Link>:<span>{i.label}</span>}</span>)}</div>;}
export function Empty({title,description,href='/products',label='دیدن محصولات'}:{title:string;description:string;href?:string;label?:string}){return <div className="empty-state"><PackageOpen size={46} strokeWidth={1.3}/><h2>{title}</h2><p>{description}</p><Link className="btn btn-dark" href={href}>{label}</Link></div>;}
