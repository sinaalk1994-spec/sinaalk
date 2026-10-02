let csrf='',catalog=[];
const el=id=>document.getElementById(id);
// این صفحه هم از ریشه‌ی سایت (store-admin.html) و هم از داخل پوشه‌ی
// erp (erp/store-management.html) لود می‌شود؛ عکس محصولات همیشه
// نسبت به ریشه‌ی سایت ذخیره شده، پس بدون این تابع، از مسیر erp/
// آدرس غلط (erp/images/...) ساخته می‌شد و عکس‌ها ۴۰۴ می‌خوردند.
function storeImgSrc(p){if(!p)return p;return /^(https?:|data:|\/)/.test(p)?p:'/'+p;}
function message(text){el('admin-message').textContent=text;}
async function request(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)}:{});const result=await r.json();if(!r.ok)throw Error(result.error||'خطا');return result;}
function td(value){const cell=document.createElement('td');cell.textContent=value;return cell;}
function number(v){return Number(v).toLocaleString('fa-IR');}
const STORE_STATUS_LABELS={
 pending:'در انتظار آپلود فیش', // وضعیتِ قدیمی، فقط برای سفارش‌های خیلی قدیمی
 awaiting_receipt:'در انتظار آپلود فیش',
 under_review:'در دست بررسی',
 awaiting_shipment:'در انتظار بارگیری',
 delivered:'تحویل شده',
 cancelled:'لغوشده',
 confirmed:'تأییدشده (سیستم قدیمی)'
};

async function load(){
 const data=await request('/api/admin');catalog=data.products;if(el('login-panel'))el('login-panel').hidden=true;el('admin-panel').hidden=false;
 el('count-products').textContent=number(catalog.length);el('count-stock').textContent=number(catalog.reduce((n,p)=>n+p.stock,0));el('count-low').textContent=number(catalog.filter(p=>p.stock<=p.min_stock).length);el('count-orders').textContent=number(data.orders.filter(o=>o.status==='under_review').length);
 render(catalog);
 // گردشِ انبار آنلاین (ورود/خروجِ خام) دیگر این‌جا نمایش داده نمی‌شود —
 // طبقِ طراحیِ جدید، تنها راهِ دیدنِ/کنترلِ موجودیِ فروشگاه آنلاین
 // صفحه‌ی «انبار» در ERP است (هم انتقال به فروشگاه آنلاین، هم بازگشت
 // از آن، هم نمودارِ زنده‌ی موجودی)
 el('orders-body').replaceChildren();data.orders.forEach(o=>renderOrderRow(o));
}

function renderOrderRow(o){
 const tr=document.createElement('tr'),customer=JSON.parse(o.customer);
 const statusText=(STORE_STATUS_LABELS[o.status]||o.status)+(o.invoice_number?' — فاکتور '+o.invoice_number:'');
 [o.id,customer.name,customer.phone,number(o.total)+' ریال',statusText].forEach(x=>tr.append(td(x)));

 const action=td('');
 action.style.cssText='display:flex;flex-wrap:wrap;gap:6px;justify-content:center;';

 const detail=document.createElement('button');detail.textContent='جزئیات';detail.className='btn btn-sm btn-outline';
 detail.onclick=()=>{
  let text=customer.name+' · '+customer.lab+' · '+customer.phone+'\n'+customer.address+'\n'+JSON.parse(o.items).map(i=>i.title+' × '+i.qty+' بسته').join('\n')+'\n'+(customer.note||'');
  if(o.delivery){const d=JSON.parse(o.delivery);text+='\n\nاطلاعات ارسال:\n'+JSON.stringify(d,null,1);}
  if(o.receipt_rejection_note)text+='\n\nعلت رد فیش قبلی: '+o.receipt_rejection_note;
  el('order-detail').textContent=text;el('order-dialog').showModal();
 };
 action.append(detail);

 const phone=document.createElement('a');phone.className='btn btn-sm btn-outline';phone.textContent='تماس';phone.href='tel:'+customer.phone.replace(/[^0-9+]/g,'');action.append(phone);
 if(customer.email){const email=document.createElement('a');email.className='btn btn-sm btn-outline';email.textContent='ایمیل';email.href='mailto:'+encodeURIComponent(customer.email)+'?subject='+encodeURIComponent('پیگیری سفارش '+o.id);action.append(email);}

 if(o.status==='under_review'){

  if(o.receipt_id){const viewBtn=document.createElement('a');viewBtn.className='btn btn-sm btn-outline';viewBtn.target='_blank';viewBtn.href='/api/receipts/'+o.receipt_id;viewBtn.textContent='مشاهده فیش';action.append(viewBtn);}

  const approveBtn=document.createElement('button');approveBtn.className='btn btn-sm';approveBtn.textContent='تأیید فیش و صدور فاکتور';
  approveBtn.onclick=async()=>{
   approveBtn.disabled=true;
   try{await approveOnlineOrderReceipt(o);await load();message('فیش تأیید شد و فاکتور در ERP ثبت شد.');}
   catch(e){message(e.message);}
   finally{approveBtn.disabled=false;}
  };
  action.append(approveBtn);

  const rejectBtn=document.createElement('button');rejectBtn.className='btn btn-sm btn-outline';rejectBtn.textContent='رد فیش';
  rejectBtn.onclick=async()=>{
   const note=prompt('علت رد فیش را وارد کنید:');
   if(!note)return;
   try{await request('/api/order-status',{id:o.id,status:'awaiting_receipt',rejection_note:note});await storeLogActivity('فروشگاه آنلاین','رد فیش بانکی','سفارش '+o.id+' — علت: '+note);await load();message('فیش رد شد.');}
   catch(e){message(e.message);}
  };
  action.append(rejectBtn);

 }

 if(o.status==='awaiting_shipment'){

  if(o.delivery){
   const deliveryInfo=JSON.parse(o.delivery);

   if(deliveryInfo.method==='post'){
    const trackingInput=document.createElement('input');trackingInput.type='text';trackingInput.placeholder='بارکد پستی';trackingInput.dir='ltr';trackingInput.style.width='110px';trackingInput.value=o.postal_tracking_code||'';
    const trackingBtn=document.createElement('button');trackingBtn.className='btn btn-sm btn-outline';trackingBtn.textContent=o.postal_tracking_code?'به‌روزرسانی بارکد':'ثبت بارکد پستی';
    trackingBtn.onclick=async()=>{
     const code=trackingInput.value.trim();
     if(!code){message('بارکد پستی را وارد کنید.');return;}
     trackingBtn.disabled=true;
     try{await request('/api/order-postal-tracking',{id:o.id,postal_tracking_code:code});await storeLogActivity('فروشگاه آنلاین','ثبت بارکد پستی','سفارش '+o.id+' — بارکد '+code);await load();message('بارکد پستی ثبت شد.');}
     catch(e){message(e.message);}
     finally{trackingBtn.disabled=false;}
    };
    action.append(trackingInput,trackingBtn);
   }

   const deliveredBtn=document.createElement('button');deliveredBtn.className='btn btn-sm';deliveredBtn.textContent='تحویل شده';
   deliveredBtn.onclick=async()=>{
    if(!confirm('این سفارش تحویل داده شد؟'))return;
    try{await request('/api/order-status',{id:o.id,status:'delivered'});await storeLogActivity('فروشگاه آنلاین','ثبت تحویل سفارش','سفارش '+o.id);await load();message('سفارش تحویل‌شده ثبت شد.');}
    catch(e){message(e.message);}
   };
   action.append(deliveredBtn);
  }else{
   const deliveredBtn=document.createElement('button');deliveredBtn.className='btn btn-sm';deliveredBtn.textContent='تحویل شده';deliveredBtn.disabled=true;deliveredBtn.title='هنوز مشتری اطلاعات ارسال را ثبت نکرده است';
   action.append(deliveredBtn);
  }

 }

 if(o.status==='awaiting_receipt'||o.status==='under_review'||o.status==='awaiting_shipment'){
  const cancelBtn=document.createElement('button');cancelBtn.className='btn btn-sm btn-outline';cancelBtn.textContent='لغو و برگشت موجودی';
  cancelBtn.onclick=async()=>{
   if(!confirm('سفارش لغو و موجودی رزرو به انبار برگردد؟'))return;
   try{await request('/api/order-status',{id:o.id,status:'cancelled'});await storeLogActivity('فروشگاه آنلاین','لغو سفارش آنلاین','سفارش '+o.id);await load();message('سفارش لغو شد.');}
   catch(e){message(e.message);}
  };
  action.append(cancelBtn);
 }

 if(o.invoice_number){const retryBtn=document.createElement('button');retryBtn.className='btn btn-sm btn-outline';retryBtn.textContent='ثبت در حسابداری';retryBtn.title='اگر بعد از تأیید، ثبت حسابداری ناموفق بود، دوباره امتحان کنید (تکراری ثبت نمی‌شود)';retryBtn.onclick=async()=>{retryBtn.disabled=true;try{await postOnlineSaleToErp(o,o.invoice_number);message('ثبت در حسابداری انجام شد.');}catch(e){message(e.message);}finally{retryBtn.disabled=false;}};action.append(retryBtn);}

 tr.append(action);el('orders-body').append(tr);
}
// تیکِ «انتشار» مستقیماً کنارِ هر ردیف — برای تغییرِ سریعِ وضعیتِ
// انتشار بدونِ باز کردنِ فرمِ کامل. چون /api/product یک upsertِ کامل
// است (نه patch)، بقیه‌ی فیلدهای همون محصول هم عیناً از روی نسخه‌ی
// کش‌شده (p) دوباره فرستاده می‌شود تا چیزی جز active خالی/بازنویسی نشود.
function toggleActive(p,checkbox){
 checkbox.disabled=true;
 request('/api/product',{code:p.code,title:p.title,type:p.type,size:p.size||'',volume:p.volume||'',brand:p.brand||'',pack:p.pack,min_stock:p.min_stock,active:checkbox.checked,image:''})
  .then(()=>{p.active=checkbox.checked;return storeLogActivity('فروشگاه آنلاین',checkbox.checked?'انتشار محصول':'لغو انتشار محصول',p.code+' — '+p.title);})
  .then(()=>message('وضعیتِ انتشارِ «'+p.title+'» ذخیره شد.'))
  .catch(e=>{checkbox.checked=!checkbox.checked;message(e.message);})
  .finally(()=>{checkbox.disabled=false;});
}
function render(list){el('catalog-body').replaceChildren();list.forEach(p=>{const tr=document.createElement('tr'),photo=td(''),img=document.createElement('img');img.src=storeImgSrc(p.image);img.alt=p.title;img.width=50;img.height=55;img.style.objectFit='contain';photo.append(img);tr.append(photo);[p.code,p.title,p.brand,number(p.pack),number(p.stock)].forEach(x=>tr.append(td(x)));const activeCell=td(''),activeCheckbox=document.createElement('input');activeCheckbox.type='checkbox';activeCheckbox.checked=Boolean(p.active);activeCheckbox.onchange=()=>toggleActive(p,activeCheckbox);activeCell.append(activeCheckbox);tr.append(activeCell);el('catalog-body').append(tr);});}
el('logout').textContent='بازگشت به ERP';el('logout').onclick=()=>{window.top.location.href='/erp/home.html';};
el('catalog-search').oninput=e=>render(catalog.filter(p=>(p.code+' '+p.title+' '+p.brand).toLowerCase().includes(e.target.value.toLowerCase())));
el('export-data').onclick=async()=>{const data=await request('/api/admin'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='STLP-online-warehouse-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);};
// این صفحه دیگر لاگین جدا ندارد — دقیقاً مثل هر صفحه‌ی دیگر ERP،
// فقط بر اساس نشستِ ERP (که سرور فروشگاه هم آن را از طریق پل
// start.py می‌شناسد) کار می‌کند. اگر نشست معتبر نبود، مستقیم به
// صفحه‌ی ورود ERP می‌رویم — نه یک پیام و دکمه‌ی جداگانه داخل همین صفحه.
request('/api/session').then(async s=>{if(s.authenticated){csrf=s.csrf;await load();loadOnlineTreasurySettings();}else{location.href='/erp/login.html';}}).catch(()=>message('اتصال به سرور فروشگاه برقرار نشد؛ چند لحظه دیگر دوباره امتحان کنید.'));

let seenPending=null,alertBusy=false;
async function checkOrderAlerts(){
 if(document.hidden||el('admin-panel').hidden||alertBusy)return;
 alertBusy=true;
 try{const data=await request('/api/order-alerts'),ids=new Set(data.pending.map(o=>o.id)),fresh=seenPending?data.pending.filter(o=>!seenPending.has(o.id)):[];
 el('order-alert').textContent=fresh.length?number(fresh.length)+' سفارش جدید رسیده؛ فهرست سفارش‌ها را به‌روز کنید.':number(ids.size)+' سفارش در انتظار بررسی';
 el('count-orders').textContent=number(ids.size);seenPending=ids;
 }catch(e){el('order-alert').textContent='اعلان سفارش‌ها متصل نیست؛ اتصال یا ورود مدیر را بررسی کنید.';}finally{alertBusy=false;}
}
const refreshOrders=document.createElement('button');refreshOrders.type='button';refreshOrders.className='btn btn-outline';refreshOrders.textContent='به‌روزرسانی سفارش‌ها';refreshOrders.onclick=()=>load().then(checkOrderAlerts).catch(e=>message(e.message));document.querySelector('.admin-actions').append(refreshOrders);
setInterval(checkOrderAlerts,30000);document.addEventListener('visibilitychange',checkOrderAlerts);checkOrderAlerts();

/* =====================================================
 * اتصال به ERP: تبدیل سفارش تأییدشده به فاکتور رسمی +
 * ثبت در خزانه/حسابداری. این بخش مستقیماً با API عمومیِ
 * key-value سرور ERP کار می‌کند (همان چیزی که storage-sync.js
 * در صفحات ERP استفاده می‌کند) چون این صفحه در یک سند جدا از
 * app.js اجرا می‌شود و به توابع آن دسترسی مستقیم ندارد.
 * هویت واقعی کاربر همچنان از روی کوکیِ نشستِ ERP بررسی می‌شود؛
 * سرور برای هر خواندن/نوشتنی دوباره دسترسی را چک می‌کند.
 * ===================================================== */

async function erpFetch(path,options){
 const res=await fetch(path,Object.assign({credentials:'same-origin'},options||{}));
 if(!res.ok){let err={};try{err=await res.json();}catch(e){}throw new Error(err.error||('خطای ERP: '+res.status));}
 return res.json();
}
// این صفحه مستقیماً از app.js لود نمی‌شود، پس stlpLogActivity در
// دسترس نیست — همان اندپوینتِ اختصاصی/غیرقابل‌جعلِ لاگِ فعالیت را
// (که آن تابع هم استفاده می‌کند) مستقیم صدا می‌زند. قبلاً کل این
// بخش از مدیریتِ فروشگاه آنلاین (محصول، گردشِ انبار، تأیید/لغو
// سفارش) هیچ ردی در لاگِ فعالیت نداشت.
async function storeLogActivity(moduleName,action,details){
 try{ await erpFetch('/api/activity-log/append',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:moduleName,action:action,details:details})}); }
 catch(error){ console.error('⚠️ ثبت لاگ فعالیت ناموفق بود:',error); }
}
async function erpGetValue(key){const r=await erpFetch('/api/store/'+encodeURIComponent(key));return r.value;}
async function erpGetJSON(key,fallback){const raw=await erpGetValue(key);if(raw===null||raw===undefined)return fallback;try{const parsed=JSON.parse(raw);return parsed===null?fallback:parsed;}catch(e){return fallback;}}
// افزودنِ اتمیکِ یک آیتم به آرایه‌ای که سمت سرور ذخیره شده (نه
// GET همین‌جا + تغییر در مرورگر + PUT جداگانه) — چون آن الگوی قدیم
// وقتی دو تأیید سفارش آنلاین تقریباً هم‌زمان اتفاق می‌افتاد (یا این
// دکمه با دکمه‌ی «ثبت و پرداخت حقوق»ی که هم به stlp_treasury
// می‌نویسد هم‌زمان می‌شد)، می‌توانست فاکتور/تراکنش/سندِ یکی از آن
// دو را بی‌سروصدا از دست بدهد: هر دو یک نسخه‌ی قدیمی از آرایه را
// می‌خواندند، هرکدام آیتم خودش را اضافه می‌کرد، و PUT دومی آرایه‌ی
// اولی را کامل بازنویسی می‌کرد. dedupeField/dedupeValue هم همان
// بررسیِ «قبلاً ثبت نشده» را سمت سرور و اتمیک انجام می‌دهد.
async function erpAppendJSON(key,item,dedupeField,dedupeValue){
 const body={item:item};
 if(dedupeField!==undefined){body.dedupeField=dedupeField;body.dedupeValue=dedupeValue;}
 return erpFetch('/api/store/'+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
async function erpPutValue(key,value){await erpFetch('/api/store/'+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:value})});}
async function erpPutJSON(key,obj){await erpPutValue(key,JSON.stringify(obj));}
function erpGenId(prefix){return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}

const ERP_DEFAULT_TREASURY_ACCOUNTS=[
 {id:'cash',name:'صندوق',type:'cash',icon:'💵',sheba:''},
 {id:'bank',name:'بانک کشاورزی',type:'bank',icon:'🏦',sheba:'IR200160000000001113622621'},
 {id:'pos',name:'کارت‌خوان',type:'pos',icon:'💳',sheba:''},
 {id:'other',name:'سایر',type:'other',icon:'📦',sheba:''}
];

// همان سرفصلِ پیش‌فرض حساب‌ها که app.js هم اگر خالی باشد می‌سازد
// (اینجا هم عیناً تکرار شده چون این صفحه به app.js دسترسی ندارد)
function erpDefaultChartDefs(){
 return [
  {code:'1000',name:'دارایی‌ها',type:'asset',parentCode:null},
  {code:'1100',name:'نقد و بانک',type:'asset',parentCode:'1000'},
  {code:'1200',name:'چک‌های دریافتنی',type:'asset',parentCode:'1000'},
  {code:'1300',name:'بدهکاران (اشخاص)',type:'asset',parentCode:'1000'},
  {code:'1400',name:'موجودی کالا',type:'asset',parentCode:'1000'},
  {code:'2000',name:'بدهی‌ها',type:'liability',parentCode:null},
  {code:'2100',name:'بستانکاران (اشخاص)',type:'liability',parentCode:'2000'},
  {code:'2200',name:'چک‌های پرداختنی',type:'liability',parentCode:'2000'},
  {code:'3000',name:'حقوق صاحبان سهام',type:'equity',parentCode:null},
  {code:'3100',name:'سرمایه',type:'equity',parentCode:'3000'},
  {code:'3200',name:'سود (زیان) انباشته',type:'equity',parentCode:'3000'},
  {code:'4000',name:'درآمدها',type:'revenue',parentCode:null},
  {code:'4100',name:'درآمد فروش',type:'revenue',parentCode:'4000'},
  {code:'4200',name:'سایر درآمدها',type:'revenue',parentCode:'4000'},
  {code:'5000',name:'هزینه‌ها',type:'expense',parentCode:null},
  {code:'5100',name:'بهای خرید کالا',type:'expense',parentCode:'5000'},
  {code:'5200',name:'سایر هزینه‌ها',type:'expense',parentCode:'5000'}
 ];
}

// حساب‌های خزانه‌ی ERP را می‌گیرد؛ اگر اصلاً وجود نداشت، همان
// پیش‌فرضِ خودِ ERP را می‌سازد (فقط می‌خواند/می‌سازد، چیزی حذف نمی‌کند)
async function erpLoadTreasuryAccounts(){
 let accounts=await erpGetJSON('stlp_treasury_accounts',null);
 if(!Array.isArray(accounts)||accounts.length===0)accounts=ERP_DEFAULT_TREASURY_ACCOUNTS.slice();
 return accounts;
}

// سرفصل حساب‌ها را می‌گیرد و مطمئن می‌شود هر حساب خزانه یک
// زیرحساب متناظر زیر «۱۱۰۰ نقد و بانک» دارد (دقیقاً همان منطق
// stlpSyncTreasuryLedgerAccounts در app.js)
async function erpEnsureLedgerAccounts(treasuryAccounts){
 let chart=await erpGetJSON('stlp_chart_of_accounts',null);
 let changed=false;
 if(!Array.isArray(chart)||chart.length===0){
  const idByCode={};chart=[];
  erpDefaultChartDefs().forEach(d=>{const id=erpGenId('acct');idByCode[d.code]=id;chart.push({id,code:d.code,name:d.name,type:d.type,parentId:d.parentCode?idByCode[d.parentCode]:null,system:true});});
  changed=true;
 }
 let parent=chart.find(a=>a.code==='1100');
 if(!parent){parent={id:erpGenId('acct'),code:'1100',name:'نقد و بانک',type:'asset',parentId:null,system:true};chart.push(parent);changed=true;}
 treasuryAccounts.forEach((acc,idx)=>{
  let exist=chart.find(a=>a.treasuryAccountId===acc.id);
  if(!exist){chart.push({id:erpGenId('acct'),code:'11'+String(idx+1).padStart(2,'0'),name:acc.name,type:'asset',parentId:parent.id,system:true,treasuryAccountId:acc.id});changed=true;}
  else if(exist.name!==acc.name){exist.name=acc.name;changed=true;}
 });
 if(changed)await erpPutJSON('stlp_chart_of_accounts',chart);
 return chart;
}

// حسابی که پول سفارش‌های آنلاین به آن می‌نشیند؛ باید از میان
// حساب‌های واقعیِ خزانه انتخاب شده باشد (از همین صفحه، بخش
// «تنظیمات حسابداری فروش آنلاین»). اگر هنوز انتخاب نشده یا حسابِ
// انتخاب‌شده دیگر وجود نداشت، پیش‌فرض صندوق است تا تأیید سفارش
// هیچ‌وقت به‌خاطر این تنظیم متوقف نشود — بدون اینکه یک حساب
// ساختگیِ جدید در فهرستِ خزانه بسازد.
async function erpEnsureOnlineTreasuryAccount(){
 const settings=await erpGetJSON('stlp_online_store_settings',{});
 const accounts=await erpLoadTreasuryAccounts();
 let account=settings.treasuryAccountId?accounts.find(a=>a.id===settings.treasuryAccountId):null;
 if(!account)account=accounts.find(a=>a.id==='cash')||accounts[0];
 return {account,accounts};
}

// پاک‌سازیِ یک‌باره: نسخه‌های قدیمی‌ترِ این صفحه، اگر هیچ حسابی
// برای فروش آنلاین انتخاب نشده بود، یک حساب ساختگیِ «فروش آنلاین
// (تنظیم‌نشده)» در فهرستِ خزانه می‌ساختند. اگر چنین حسابی هست و
// هیچ تراکنشی به آن ثبت نشده (یعنی واقعاً هیچ‌وقت استفاده نشده)،
// همین‌جا حذفش می‌کنیم تا فهرستِ حساب‌های خزانه شلوغ نماند.
async function erpCleanupPhantomOnlineAccount(){
 const accounts=await erpLoadTreasuryAccounts();
 const idx=accounts.findIndex(a=>a.id==='online_store');
 if(idx===-1)return;
 const treasury=await erpGetJSON('stlp_treasury',[]);
 const inUse=Array.isArray(treasury)&&treasury.some(t=>t.account==='online_store');
 if(inUse)return;
 accounts.splice(idx,1);
 await erpPutJSON('stlp_treasury_accounts',accounts);
 const settings=await erpGetJSON('stlp_online_store_settings',{});
 if(settings.treasuryAccountId==='online_store'){
  settings.treasuryAccountId='cash';
  await erpPutJSON('stlp_online_store_settings',settings);
 }
}

// مشتریِ سفارش را در فهرست مشتریانِ ERP پیدا می‌کند (بر اساس
// شماره تلفن) یا اگر نبود، اضافه‌اش می‌کند
async function erpFindOrCreateCustomer(customer){
 let customers=await erpGetJSON('customers',[]);
 if(!Array.isArray(customers))customers=[];
 const phone=(customer.phone||'').trim();
 let existing=phone?customers.find(c=>(c.phone||'').trim()===phone):null;
 if(existing)return existing;
 const isCompany=customer.customerType==='company';
 const newCustomer={
  name:(isCompany?(customer.companyName||customer.name):customer.name)||'-',
  nationalId:isCompany?'':(customer.nationalId||''),
  econCode:isCompany?(customer.econCode||''):'',
  regNo:isCompany?(customer.regNo||''):'',
  province:'',city:'',
  address:customer.address||'',phone:phone,postalCode:'',
  source:'فروشگاه آنلاین'
 };
 customers.push(newCustomer);
 await erpPutJSON('customers',customers);
 return newCustomer;
}

// فاکتورِ رسمی + سند خزانه/حسابداریِ یک سفارش تأییدشده را در ERP
// ثبت می‌کند. اگر قبلاً برای همین شماره فاکتور ثبت شده باشد،
// دوباره چیزی اضافه نمی‌کند (برای دکمه‌ی «ثبت در حسابداری» که
// می‌تواند بی‌خطر چند بار زده شود)
async function postOnlineSaleToErp(order,invoiceNo){

 const customer=JSON.parse(order.customer);
 const items=JSON.parse(order.items);
 const amount=Number(order.total||0);

 // ۱. فاکتور (سرور اتمیک بررسی می‌کند قبلاً با همین شماره ثبت نشده باشد)
 const erpCustomer=await erpFindOrCreateCustomer(customer);

 const invoiceItems=items.map(i=>({row:0,code:i.code,name:i.title,unit:'بسته',qty:i.qty,price:i.price,total:i.qty*i.price,discount:0,afterDiscount:i.qty*i.price,tax:0,final:i.qty*i.price}));

 await erpAppendJSON('invoices',{
  invoiceNo:invoiceNo,
  date:new Date().toLocaleDateString('fa-IR'),
  taxRate:0,
  customer:erpCustomer.name||customer.name||'-',
  customerObj:erpCustomer,
  purchaseType:'cash',
  items:invoiceItems,
  total:amount,
  source:'online_store',
  sourceOrderId:order.id,
  createdAt:new Date().toISOString()
 },'invoiceNo',invoiceNo);

 // ۲. تراکنش خزانه (سرور اتمیک بررسی می‌کند قبلاً با همین شماره فاکتور ثبت نشده باشد)
 let treasury=await erpGetJSON('stlp_treasury',[]);
 if(!Array.isArray(treasury))treasury=[];
 const alreadyPosted=treasury.some(t=>String(t.invoiceNo||'')===String(invoiceNo));

 if(!alreadyPosted){

  if(amount<=0)throw new Error('مبلغ سفارش معتبر نیست.');

  const {account}=await erpEnsureOnlineTreasuryAccount();
  const accounts=await erpLoadTreasuryAccounts();
  const chart=await erpEnsureLedgerAccounts(accounts);

  const transaction={
   id:erpGenId('tr'),
   type:'in',
   account:account.id,
   transferFrom:'',
   transferTo:'',
   amount:amount,
   date:new Date().toLocaleDateString('fa-IR'),
   party:customer.name||'',
   method:'online',
   tracking:order.id,
   invoiceNo:invoiceNo,
   description:'دریافت آنلاین بابت فاکتور فروش شماره '+invoiceNo,
   checkNo:'',checkBank:'',checkDueDate:'',
   createdAt:new Date().toISOString(),
   updatedAt:new Date().toISOString(),
   source:'invoice'
  };

  await erpAppendJSON('stlp_treasury',transaction,'invoiceNo',invoiceNo);

  // سند حسابداری دوطرفه (بدهکار حساب بانک/آنلاین، بستانکار درآمد فروش)
  const cashAcc=chart.find(a=>a.treasuryAccountId===account.id);
  const revenueAcc=chart.find(a=>a.code==='4100');

  if(cashAcc&&revenueAcc){

   const counterResult=await erpFetch('/api/counter/next-journal-number',{method:'POST'});
   const counter=counterResult.number;

   await erpAppendJSON('stlp_journal_entries',{
    id:erpGenId('je'),
    number:counter,
    date:new Date().toLocaleDateString('fa-IR'),
    dateTs:Date.now(),
    description:'دریافت آنلاین بابت فروش — فاکتور '+invoiceNo,
    lines:[
     {accountId:cashAcc.id,debit:amount,credit:0},
     {accountId:revenueAcc.id,debit:0,credit:amount}
    ],
    sourceType:'invoice',
    sourceId:invoiceNo,
    createdAt:new Date().toISOString()
   });

  }

 }

}

// دکمه‌ی «تأیید فیش و صدور فاکتور»: شماره فاکتور رسمی می‌گیرد،
// سفارش را به مرحله‌ی «در انتظار بارگیری» می‌برد (این مرحله جلوی
// تأیید دوباره را هم می‌گیرد چون فقط از under_review قابل‌دسترس
// است) و بعد فاکتور/حسابداری را در ERP ثبت می‌کند — یعنی «تأیید
// مالی» دقیقاً همین لحظه‌ی تأییدِ فیش بانکی است.
async function approveOnlineOrderReceipt(order){

 const counterResult=await erpFetch('/api/counter/next-invoice-number',{method:'POST'});
 const invoiceNo=counterResult.number;
 const invoiceDate=new Date().toLocaleDateString('fa-IR');

 await request('/api/order-status',{id:order.id,status:'awaiting_shipment',invoice_number:invoiceNo,invoice_date:invoiceDate});

 await storeLogActivity('فروشگاه آنلاین','تأیید فیش و صدور فاکتور','سفارش '+order.id+' — فاکتور '+invoiceNo);

 try{
  await postOnlineSaleToErp(order,invoiceNo);
 }catch(error){
  throw new Error('سفارش با شماره فاکتور '+invoiceNo+' تأیید شد، ولی ثبت در حسابداری ناموفق بود («'+error.message+'»). از دکمه‌ی «ثبت در حسابداری» کنار همین سفارش دوباره امتحان کنید.');
 }

}

/* -----------------------------------------------------
 * تنظیمات: کدام حساب خزانه، پول سفارش‌های آنلاین را می‌گیرد
 * ----------------------------------------------------- */

async function loadOnlineTreasurySettings(){
 try{
  await erpCleanupPhantomOnlineAccount();
  const settings=await erpGetJSON('stlp_online_store_settings',{});
  const accounts=await erpLoadTreasuryAccounts();
  const select=el('online-treasury-account');
  select.replaceChildren();
  accounts.forEach(acc=>{const opt=document.createElement('option');opt.value=acc.id;opt.textContent=acc.name;select.append(opt);});
  select.value=settings.treasuryAccountId||'cash';
 }catch(error){
  // اگر این حساب ERP دسترسی خزانه نداشته باشد، این بخش را ساکت پنهان کن
  const section=el('online-treasury-account')?.closest('section');
  if(section)section.hidden=true;
 }
}

const onlineTreasuryForm=el('online-treasury-form');
if(onlineTreasuryForm)onlineTreasuryForm.onsubmit=async e=>{
 e.preventDefault();
 try{
  const accountId=el('online-treasury-account').value||'cash';
  const settings=await erpGetJSON('stlp_online_store_settings',{});
  settings.treasuryAccountId=accountId;
  await erpPutJSON('stlp_online_store_settings',settings);
  await loadOnlineTreasurySettings();
  message('تنظیمات حسابداری فروش آنلاین ذخیره شد.');
 }catch(error){message(error.message);}
};
