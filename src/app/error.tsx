'use client';
export default function Error({reset}:{error:Error;reset:()=>void}){return <div className="container"><div className="empty-state" style={{marginTop:40}}><h2>مشکلی در بارگذاری پیش آمد</h2><p>لطفاً دوباره تلاش کنید.</p><button className="btn btn-dark" onClick={reset}>تلاش دوباره</button></div></div>;}
