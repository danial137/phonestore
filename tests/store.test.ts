import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { brotliDecompressSync } from 'node:zlib';
import { randomUUID, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect } from '@playwright/test';
import chromiumBinary from '@sparticuz/chromium';

const temp=mkdtempSync(join(tmpdir(),'persian-mobile-test-'));
const base='http://127.0.0.1:3100';let server:ChildProcess;let logs='';
let customer='',second='',admin='',p:any,order:any;
async function request(path:string,method='GET',body?:unknown,cookie='',origin=base){
  const response=await fetch(base+'/api/'+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')||''};
}
const input=(items:any[],extra:Record<string,unknown>={})=>({items,recipient:'کاربر آزمایشی',phone:'۰۹۱۲۳۴۵۶۷۸۹',city:'تهران',address:'خیابان تست، پلاک ۱۲، واحد ۳',postalCode:'۱۲۳۴۵۶۷۸۹۰',coupon:'',payment:'cod',idempotencyKey:randomUUID(),...extra});
before(async()=>{
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3100','--hostname','127.0.0.1'],{cwd:process.cwd(),env:{...process.env,APP_URL:base,DATABASE_PATH:join(temp,'test.sqlite'),COOKIE_SECURE:'false',ZARINPAL_MERCHANT_ID:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  server.stdout?.on('data',b=>logs+=b);server.stderr?.on('data',b=>logs+=b);
  let started=false;
  for(let i=0;i<150;i++){try{const res=await fetch(base+'/api/products');if(res.ok){p=(await res.json()).products[0];started=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!started)throw new Error('Server startup failed: '+logs);
  const d=new DatabaseSync(join(temp,'test.sqlite'));const salt='test-only-salt';const hash=salt+':'+scryptSync('Testing-Admin-2026!',salt,64).toString('hex');
  d.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(randomUUID(),'مدیر تست','admin@test.example',hash,'admin',new Date().toISOString());d.close();
}, {timeout:25000});
after(async()=>{server?.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));rmSync(temp,{recursive:true,force:true});});

test('Public catalog and rendered pages are available; nonexistent routes return 404',async()=>{
  assert.equal((await request('products')).data.products.length,12);
  assert.equal((await request('config')).data.onlinePayment,false);
  for(const route of ['/','/products','/products/iphone-16-pro','/cart','/checkout','/auth','/account','/admin','/support','/wishlist','/compare','/about','/guide','/policies'])assert.equal((await fetch(base+route)).status,200,route);
  // Next.js streaming responses use a 200 transport status for a rendered not-found boundary.
  const missing=await fetch(base+'/products/nonexistent');assert.match(await missing.text(),/این صفحه پیدا نشد/);
  assert.equal((await request('products/nonexistent')).status,404);
});
test('Authentication enforces credentials, CSRF, HttpOnly sessions and server-owned roles',async()=>{
  assert.equal((await request('admin')).status,401);
  assert.equal((await request('auth/register','POST',{name:'Test',email:'wrong',password:'123'})).status,400);
  assert.equal((await request('auth/register','POST',{name:'Test',email:'csrf@test.example',password:'StrongPass123'},'','https://other.example')).status,403);
  const a=await request('auth/register','POST',{name:'خریدار اول',email:'customer@test.example',password:'StrongPass123',role:'admin'});
  assert.equal(a.status,201);assert.equal(a.data.user.role,'customer');assert.match(a.cookie,/HttpOnly/i);assert.match(a.cookie,/SameSite=lax/i);assert.ok(!('password' in a.data.user));customer=a.cookie.split(';')[0];
  assert.equal((await request('me','GET',undefined,customer)).data.user.email,'customer@test.example');
  assert.equal((await request('admin','GET',undefined,customer)).status,403);
  assert.equal((await request('auth/login','POST',{email:'customer@test.example',password:'WrongPass123'})).status,401);
  second=(await request('auth/register','POST',{name:'خریدار دوم',email:'second@test.example',password:'StrongPass123'})).cookie.split(';')[0];
  admin=(await request('auth/login','POST',{email:'admin@test.example',password:'Testing-Admin-2026!'})).cookie.split(';')[0];
  assert.equal((await request('admin','GET',undefined,admin)).status,200);
});
test('Prices are calculated on server, coupons are capped and variant quantities are aggregated',async()=>{
  const q=await request('checkout/quote','POST',{items:[{productId:p.id,color:p.colors[0],quantity:1,price:1}],coupon:'WELCOME'},customer);
  assert.equal(q.status,200);assert.equal(q.data.subtotal,p.price);assert.equal(q.data.discount,500000);assert.equal(q.data.shipping,0);
  assert.equal((await request('checkout/quote','POST',{items:[{productId:p.id,color:p.colors[0],quantity:-1}]},customer)).status,400);
  assert.equal((await request('checkout/quote','POST',{items:[{productId:p.id,color:p.colors[0],quantity:7},{productId:p.id,color:p.colors[1],quantity:7}]},customer)).status,400);
  assert.equal((await request('checkout/quote','POST',{items:[{productId:p.id,color:'#abcdef',quantity:1}]},customer)).status,400);
});
test('Order transaction is idempotent, reserves stock once and keeps customer data private',async()=>{
  const payload=input([{productId:p.id,color:p.colors[0],quantity:2}],{coupon:'WELCOME',total:1});
  const results=await Promise.all([request('orders','POST',payload,customer),request('orders','POST',payload,customer)]);
  assert.equal(results[0].status,201);assert.equal(results[1].status,201);order=results[0].data.order;
  assert.equal(order.id,results[1].data.order.id);assert.equal(order.total,p.price*2-500000);assert.equal(order.status,'confirmed');assert.equal(order.phone,'09123456789');
  assert.equal((await request('products/'+p.id)).data.product.stock,p.stock-2);
  assert.equal((await request('orders','GET',undefined,customer)).data.orders.length,1);
  assert.equal((await request('orders/'+order.id,'GET',undefined,second)).status,404);
  assert.equal((await request('orders/'+order.id+'/cancel','POST',{},second)).status,404);
  assert.equal((await request('admin','GET',undefined,admin)).data.coupons[0].uses,1);
});
test('Cancellation restores stock and coupon capacity exactly once',async()=>{
  assert.equal((await request('orders/'+order.id+'/cancel','POST',{},customer)).data.order.status,'cancelled');
  assert.equal((await request('orders/'+order.id+'/cancel','POST',{},customer)).status,400);
  assert.equal((await request('products/'+p.id)).data.product.stock,p.stock);
  assert.equal((await request('admin','GET',undefined,admin)).data.coupons[0].uses,0);
});
test('Concurrent shoppers cannot oversell the final unit; order transitions are enforced',async()=>{
  assert.equal((await request('admin/products/'+p.id,'PATCH',{...p,stock:1},admin)).status,200);
  const purchases=await Promise.all([request('orders','POST',input([{productId:p.id,color:p.colors[0],quantity:1}]),customer),request('orders','POST',input([{productId:p.id,color:p.colors[0],quantity:1}]),second)]);
  assert.deepEqual(purchases.map(r=>r.status).sort(),[201,400]);
  assert.equal((await request('products/'+p.id)).data.product.stock,0);
  const placed=purchases.find(r=>r.status===201)!.data.order;
  assert.equal((await request('admin/orders/'+placed.id,'PATCH',{status:'delivered'},admin)).status,400);
  for(const status of ['processing','shipped','delivered'])assert.equal((await request('admin/orders/'+placed.id,'PATCH',{status},admin)).status,200);
  assert.equal((await request('admin/orders/'+placed.id,'PATCH',{status:'confirmed'},admin)).status,400);
  await request('admin/products/'+p.id,'PATCH',{...p,stock:12},admin);
});
test('Admin CRUD, support replies and authorization boundaries work',async()=>{
  const payload={...p,id:undefined,slug:'integration-test-product',title:'محصول آزمایشی',stock:3};
  assert.equal((await request('admin/products','POST',payload,customer)).status,403);
  const created=await request('admin/products','POST',payload,admin);assert.equal(created.status,200);
  assert.equal((await request('admin/products/'+created.data.product.id,'PATCH',{...payload,price:-10},admin)).status,400);
  assert.equal((await request('admin/products/'+created.data.product.id,'DELETE',{},admin)).status,200);
  assert.equal((await request('products/'+created.data.product.id)).status,404);
  assert.equal((await request('tickets','POST',{subject:'پیگیری سفارش آزمایشی',message:'لطفاً وضعیت این سفارش آزمایشی را بررسی کنید.'},customer)).status,201);
  const ticket=(await request('tickets','GET',undefined,customer)).data.tickets[0];
  assert.equal((await request('tickets','GET',undefined,second)).data.tickets.length,0);
  await request('admin/tickets/'+ticket.id,'PATCH',{reply:'سفارش بررسی شد؛ ممنون از پیام شما.'},admin);
  assert.match((await request('tickets','GET',undefined,customer)).data.tickets[0].reply,/بررسی/);
});
test('Browser: responsive UI, search, cart, signup, coupon, checkout and admin editor',{timeout:90000},async()=>{
  // Extract without restoring archive ownership, so rootless containers work too.
  const browserDir=join(temp,'browser');
  if(process.platform==='linux') {
    const bin=resolve(dirname(createRequire(import.meta.url).resolve('@sparticuz/chromium')),'../../bin');
    mkdirSync(join(browserDir,'fonts'),{recursive:true});
    writeFileSync(join(browserDir,'chromium'),brotliDecompressSync(readFileSync(join(bin,'chromium.br'))),{mode:0o755});
    for(const name of ['fonts','swiftshader'])execFileSync('tar',['--no-same-owner','-xf','-','-C',name==='fonts'?join(browserDir,'fonts'):browserDir],{input:brotliDecompressSync(readFileSync(join(bin,name+'.tar.br')))});
    writeFileSync(join(browserDir,'fonts','fonts.conf'),`<?xml version="1.0"?><fontconfig><dir>${browserDir}/fonts/fonts</dir><dir>/usr/share/fonts</dir><cachedir>${browserDir}/font-cache</cachedir></fontconfig>`);
  }
  const browser=await chromium.launch(process.platform==='linux'?{headless:true,executablePath:join(browserDir,'chromium'),args:chromiumBinary.args.filter(a=>!['--disable-web-security','--allow-running-insecure-content'].includes(a)),env:{...process.env,FONTCONFIG_PATH:join(browserDir,'fonts'),LD_LIBRARY_PATH:browserDir}}:{headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.evaluate(()=>document.fonts.ready);await expect(page.getByRole('heading',{level:1})).toContainText('دنیای دیجیتال');
    const previews=resolve(process.env.PM_PREVIEW_DIR||'test-results');mkdirSync(previews,{recursive:true});
    await page.screenshot({path:join(previews,'persian-mobile-desktop.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(previews,'persian-mobile-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('textbox',{name:'جستجوی محصولات'}).fill('S25');await page.getByRole('textbox',{name:'جستجوی محصولات'}).press('Enter');await expect(page.locator('.product-card')).toHaveCount(1);
    await page.locator('.product-card h3').click();await expect(page.getByRole('heading',{level:1})).toContainText('S25');
    await page.getByRole('button',{name:'افزودن به سبد خرید',exact:true}).click();await page.getByRole('link',{name:/سبد خرید،/}).click();await expect(page.locator('.cart-row')).toHaveCount(1);
    await page.reload();await expect(page.locator('.cart-row')).toHaveCount(1);
    await page.getByRole('link',{name:'ادامه و ثبت سفارش'}).click();await page.getByRole('link',{name:'ورود یا ثبت‌نام',exact:true}).click();await page.getByRole('button',{name:'ثبت‌نام کن'}).click();
    await page.getByLabel('نام و نام خانوادگی').fill('خریدار مرورگر');await page.getByLabel('ایمیل',{exact:true}).fill('browser@test.example');await page.getByLabel('رمز عبور',{exact:true}).fill('Browser-Test-123');await page.getByRole('button',{name:'ساخت حساب کاربری',exact:true}).click();
    await expect(page).toHaveURL(base+'/checkout');await page.getByLabel('شماره موبایل').fill('09123456789');await page.getByLabel('شهر',{exact:true}).fill('تهران');await page.getByLabel('کد پستی ۱۰ رقمی').fill('1234567890');await page.getByLabel('نشانی کامل').fill('تهران، خیابان آزمایش، پلاک ۱۲');
    await page.getByLabel('کد تخفیف داری؟').fill('WELCOME');await page.getByRole('button',{name:'اعمال',exact:true}).click();await expect(page.locator('.summary-line').filter({hasText:'تخفیف WELCOME'})).toBeVisible();
    await page.getByRole('checkbox').check();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.getByRole('button',{name:'ثبت نهایی سفارش'}).click();
    await expect(page).toHaveURL(/\/account\/orders\//);await expect(page.getByRole('heading',{level:1})).toContainText('ثبت شده');
    await page.goto(base+'/account');await expect(page.locator('.order-card')).toHaveCount(1);await page.getByRole('button',{name:'خروج از حساب'}).click();
    await page.goto(base+'/auth?next=/admin');await page.getByLabel('ایمیل',{exact:true}).fill('admin@test.example');await page.getByLabel('رمز عبور',{exact:true}).fill('Testing-Admin-2026!');await page.getByRole('button',{name:'ورود به حساب',exact:true}).click();await expect(page).toHaveURL(base+'/admin');
    await page.getByRole('button',{name:'محصولات',exact:true}).click();await page.getByRole('button',{name:'محصول جدید',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('نام فارسی').fill('گوشی تست مرورگر');await page.getByLabel('آدرس محصول (حروف انگلیسی)').fill('browser-product');await page.getByLabel('توضیحات',{exact:true}).fill('این محصول برای تست فرم مدیریت ساخته شده است.');await page.getByRole('button',{name:'ذخیره محصول',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.admin-table')).toContainText('گوشی تست مرورگر');
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'نمای کلی',exact:true}).click();await page.screenshot({path:join(previews,'persian-mobile-admin.png'),fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});
