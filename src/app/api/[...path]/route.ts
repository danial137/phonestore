import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, products, product, orderRow } from '@/lib/db';
import { AppError, currentUser, requireUser, createSession, endSession, hashPassword, verifyPassword, jsonBody, rateLimit } from '@/lib/security';
import { checkoutSchema, createOrder, quote, updateOrder, cancelUninitiatedPayment } from '@/lib/commerce';
import { paymentConfigured, startPayment, verifyPayment } from '@/lib/payments';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={ params:Promise<{path:string[]}> };
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const credentials=z.object({email:z.email().max(254).transform(s=>s.toLowerCase().trim()),password:z.string().min(8).max(128)});
const productSchema=z.object({
  slug:z.string().regex(/^[a-z0-9-]{2,80}$/), title:z.string().trim().min(2).max(120), subtitle:z.string().trim().max(160),
  brand:z.string().min(1).max(50), category:z.enum(['phone','earbuds','watch','tablet','accessory']),
  price:z.number().int().min(1000).max(1000000000), originalPrice:z.number().int().min(0).max(1000000000),
  stock:z.number().int().min(0).max(100000), colors:z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(8),
  specs:z.record(z.string().max(100),z.string().max(200)).refine(v=>Object.keys(v).length<=30),
  featured:z.boolean(),active:z.boolean(),art:z.enum(['phone','earbuds','watch','tablet','charger']),hue:z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description:z.string().min(10).max(4000),imageUrl:z.union([z.literal(''),z.url().max(2048).refine(v=>v.startsWith('https://'))]).default('')
});
async function handle(request:Request,ctx:Context) {
  try {
    const {path}=await ctx.params, route=path.join('/'), method=request.method;
    if(method==='GET') {
      if(route==='products') return reply({products:products()});
      if(path[0]==='products' && path.length===2) {const p=product(path[1]);if(!p?.active) throw new AppError('محصول پیدا نشد.',404);return reply({product:p});}
      if(route==='me') return reply({user:await currentUser()});
      if(route==='config') return reply({onlinePayment:paymentConfigured(),sandbox:process.env.ZARINPAL_SANDBOX==='true'});
      if(route==='payments/callback') {
        const authority=new URL(request.url).searchParams.get('Authority');
        if(!authority || authority.length>200) throw new AppError('شناسه تراکنش معتبر نیست.');
        const result=await verifyPayment(authority);
        return NextResponse.redirect(new URL(`/account/orders/${result.id}?payment=${result.paid?'success':'unverified'}`,process.env.APP_URL||request.url));
      }
      if(route==='orders') {const user=await requireUser();return reply({orders:db().prepare('SELECT * FROM orders WHERE userId=? ORDER BY createdAt DESC').all(user.id).map(orderRow)});}
      if(path[0]==='orders' && path.length===2) {const user=await requireUser();const row=db().prepare('SELECT * FROM orders WHERE id=? AND userId=?').get(path[1],user.id);if(!row)throw new AppError('سفارش پیدا نشد.',404);return reply({order:orderRow(row)});}
      if(route==='tickets') {const user=await requireUser();return reply({tickets:db().prepare('SELECT * FROM tickets WHERE userId=? ORDER BY createdAt DESC').all(user.id)});}
      if(route==='admin') {
        await requireUser(true);
        return reply({products:products(true),orders:db().prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 200').all().map(orderRow),coupons:db().prepare('SELECT * FROM coupons').all(),tickets:db().prepare('SELECT t.*,u.email FROM tickets t JOIN users u ON u.id=t.userId ORDER BY createdAt DESC LIMIT 200').all(),customers:(db().prepare("SELECT COUNT(*) as n FROM users WHERE role='customer'").get() as {n:number}).n});
      }
    }
    const body=await jsonBody(request);
    if(method==='POST' && ['auth/login','auth/register'].includes(route)) {
      const input=credentials.parse(body);rateLimit('auth:'+input.email,15);rateLimit('auth-global',200,60000);
      if(route==='auth/register') {
        const name=z.string().trim().min(2).max(100).parse(body.name);
        if(db().prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new AppError('امکان ثبت‌نام با این ایمیل وجود ندارد. وارد شوید.',409);
        const id=randomUUID();const hash=await hashPassword(input.password);
        db().prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,name,input.email,hash,'customer',new Date().toISOString());
        await createSession(id);return reply({user:await currentUser()},201);
      }
      const user=db().prepare('SELECT * FROM users WHERE email=?').get(input.email) as {id:string;password:string}|undefined;
      // Run scrypt for unknown users as well, reducing the timing difference.
      const valid=await verifyPassword(input.password,user?.password||'00000000000000000000000000000000:'+ '00'.repeat(64));
      if(!user||!valid)throw new AppError('ایمیل یا رمز عبور درست نیست.',401);
      await createSession(user.id);return reply({user:await currentUser()});
    }
    if(method==='POST' && route==='auth/logout'){await endSession();return reply({ok:true});}
    const user=await requireUser(path[0]==='admin');
    rateLimit('writes:'+user.id,100,60000);
    if(route==='me' && method==='PATCH') {
      const name=z.string().trim().min(2).max(100).parse(body.name);
      db().prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);return reply({user:await currentUser()});
    }
    if(route==='auth/password' && method==='POST') {
      const input=z.object({current:z.string().max(128),password:z.string().min(8).max(128)}).parse(body);
      const row=db().prepare('SELECT password FROM users WHERE id=?').get(user.id) as {password:string};
      if(!await verifyPassword(input.current,row.password)) throw new AppError('رمز فعلی درست نیست.');
      db().prepare('UPDATE users SET password=? WHERE id=?').run(await hashPassword(input.password),user.id);
      db().prepare('DELETE FROM sessions WHERE userId=?').run(user.id);await createSession(user.id);return reply({ok:true});
    }
    if(route==='checkout/quote' && method==='POST') {
      const items=checkoutSchema.shape.items.parse(body.items), code=z.string().max(32).parse(body.coupon||'');
      const q=quote(items,code);return reply({subtotal:q.subtotal,shipping:q.shipping,discount:q.discount,total:q.total});
    }
    if(route==='orders' && method==='POST') {
      const input=checkoutSchema.parse(body);
      if(input.payment==='zarinpal' && !paymentConfigured())throw new AppError('درگاه پرداخت آنلاین هنوز فعال نیست.');
      const order=createOrder(user.id,input);
      if(order.payment==='zarinpal' && order.status==='pending_payment') {
        // Keep the reservation on ambiguous gateway failures; never risk overselling a paid order.
        try { return reply({order,paymentUrl:await startPayment(order)},201); }
        catch { return reply({order,paymentUrl:null,paymentError:'ارتباط با درگاه برقرار نشد. از صفحه سفارش دوباره تلاش کنید.'},201); }
      }
      return reply({order},201);
    }
    if(path[0]==='orders' && path.length===3 && method==='POST') {
      const row=db().prepare('SELECT * FROM orders WHERE id=? AND userId=?').get(path[1],user.id);if(!row)throw new AppError('سفارش پیدا نشد.',404);
      const order=orderRow(row);
      if(path[2]==='pay')return reply({paymentUrl:await startPayment(order)});
      if(path[2]==='cancel') {
        if(order.status==='pending_payment') {cancelUninitiatedPayment(order.id);const updated=orderRow(db().prepare('SELECT * FROM orders WHERE id=?').get(order.id));if(updated.status!=='cancelled')throw new AppError('تراکنش درگاه باید توسط پشتیبانی بررسی شود.');return reply({order:updated});}
        if(order.status!=='confirmed')throw new AppError('لغو در این مرحله ممکن نیست.');
        return reply({order:updateOrder(order.id,'cancelled')});
      }
    }
    if(route==='tickets' && method==='POST') {
      rateLimit('ticket:'+user.id,10,3600000);
      const input=z.object({subject:z.string().trim().min(3).max(120),message:z.string().trim().min(10).max(3000)}).parse(body);
      db().prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?)').run(randomUUID(),user.id,input.subject,input.message,null,new Date().toISOString());return reply({ok:true},201);
    }
    if(path[0]==='admin') {
      if(path[1]==='products' && (method==='POST'||method==='PATCH')) {
        const p=productSchema.parse(body);const id=method==='POST'?randomUUID():path[2];
        if(method==='PATCH'&&!product(id))throw new AppError('محصول پیدا نشد.',404);
        if(p.originalPrice && p.originalPrice<p.price) throw new AppError('قیمت قبلی باید از قیمت فروش بیشتر باشد.');
        if(!p.colors.includes(p.hue)) throw new AppError('رنگ اصلی باید در رنگ‌های موجود باشد.');
        const values=[p.slug,p.title,p.subtitle,p.brand,p.category,p.price,p.originalPrice,p.stock,JSON.stringify(p.colors),JSON.stringify(p.specs),Number(p.featured),Number(p.active),p.art,p.hue,p.description,p.imageUrl];
        if(method==='POST')db().prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...values);
        else db().prepare('UPDATE products SET slug=?,title=?,subtitle=?,brand=?,category=?,price=?,originalPrice=?,stock=?,colors=?,specs=?,featured=?,active=?,art=?,hue=?,description=?,imageUrl=? WHERE id=?').run(...values,id);
        return reply({product:product(id)});
      }
      if(path[1]==='products' && method==='DELETE') {db().prepare('UPDATE products SET active=0 WHERE id=?').run(path[2]);return reply({ok:true});}
      if(path[1]==='orders' && method==='PATCH')return reply({order:updateOrder(path[2],z.string().parse(body.status))});
      if(path[1]==='coupons' && method==='POST') {
        const p=z.object({code:z.string().regex(/^[A-Z0-9_-]{3,32}$/),percent:z.number().int().min(1).max(90),maxDiscount:z.number().int().min(1000).max(100000000),maxUses:z.number().int().min(1).max(100000),active:z.boolean()}).parse(body);
        db().prepare('INSERT INTO coupons VALUES (?,?,?,?,?,0) ON CONFLICT(code) DO UPDATE SET percent=excluded.percent,maxDiscount=excluded.maxDiscount,active=excluded.active,maxUses=excluded.maxUses').run(p.code,p.percent,p.maxDiscount,Number(p.active),p.maxUses);return reply({ok:true});
      }
      if(path[1]==='tickets' && method==='PATCH') {const text=z.string().trim().min(2).max(3000).parse(body.reply);db().prepare('UPDATE tickets SET reply=? WHERE id=?').run(text,path[2]);return reply({ok:true});}
    }
    throw new AppError('مسیر پیدا نشد.',404);
  } catch(error) {
    if(error instanceof z.ZodError) return reply({error:'اطلاعات فرم معتبر نیست. فیلدها، شماره موبایل و کد پستی را بررسی کنید.',fields:error.issues.map(i=>i.path.join('.'))},400);
    if(error instanceof AppError) return reply({error:error.message},error.status);
    if(error instanceof Error && error.message.includes('UNIQUE constraint')) return reply({error:'این مقدار قبلاً ثبت شده است.'},409);
    console.error('[API]',error instanceof Error?error.message:'Unknown error');return reply({error:'خطای موقت سرور. دوباره تلاش کنید.'},500);
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
