const STLP_TRACK_STAGES=['awaiting_receipt','under_review','awaiting_shipment','delivered'];
const STLP_TRACK_STAGE_LABELS={awaiting_receipt:'آپلود فیش',under_review:'بررسی فیش',awaiting_shipment:'بارگیری',delivered:'تحویل'};

function stlpTrackNumber(v){return Number(v||0).toLocaleString('fa-IR');}

function stlpRenderTimeline(status){
 const box=document.getElementById('track-timeline');
 box.replaceChildren();
 if(status==='cancelled'){
  const banner=document.createElement('div');banner.className='stlp-cancelled-banner';banner.textContent='❌ این سفارش لغو شده است.';
  box.append(banner);return;
 }
 // «pending»/«confirmed» وضعیت‌های قدیمیِ سیستمِ قبلی‌اند — برای
 // سفارش‌های خیلی قدیمی که هنوز روی این وضعیت‌ها مانده‌اند، معادلِ
 // نزدیک‌ترین مرحله‌ی جدید نمایش می‌دهیم تا گیج‌کننده نباشد
 const effectiveStatus=status==='confirmed'?'awaiting_shipment':(status==='pending'?'awaiting_receipt':status);
 const currentIndex=STLP_TRACK_STAGES.indexOf(effectiveStatus);
 const row=document.createElement('div');row.className='stlp-timeline';
 STLP_TRACK_STAGES.forEach(function(stage,index){
  const step=document.createElement('div');
  step.className='step '+(index<currentIndex?'done':(index===currentIndex?'active':'pending'));
  const dot=document.createElement('div');dot.className='dot';dot.textContent=index<currentIndex?'✓':String(index+1);
  const label=document.createElement('div');label.textContent=STLP_TRACK_STAGE_LABELS[stage];
  step.append(dot,label);row.append(step);
 });
 box.append(row);
}

function stlpRenderSummary(order){
 const box=document.getElementById('track-summary');
 const itemsText=order.items.map(function(i){return i.title+' × '+stlpTrackNumber(i.qty)+' بسته';}).join('\n');
 box.textContent='کد سفارش: '+order.id+'\nتاریخ ثبت: '+order.created+'\n\n'+itemsText+'\n\nمبلغ نهایی: '+stlpTrackNumber(order.total)+' ریال'+(order.invoice_number?'\nشماره فاکتور: '+order.invoice_number:'');
}

async function stlpUploadReceipt(orderId,file,messageBox){
 if(!file)return;
 if(file.size>2_000_000||!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)){
  messageBox.textContent='فیشِ بانکی باید PNG، JPEG، WebP یا PDF و کمتر از ۲ مگابایت باشد.';
  return;
 }
 messageBox.textContent='در حال آپلود...';
 const reader=new FileReader();
 reader.onload=async function(){
  try{
   const r=await fetch('/api/track/'+encodeURIComponent(orderId)+'/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:reader.result})});
   const result=await r.json();
   if(!r.ok)throw Error(result.error||'آپلود فیش انجام نشد');
   messageBox.textContent='';
   stlpLoadOrder(orderId);
  }catch(error){messageBox.textContent=error.message;}
 };
 reader.readAsDataURL(file);
}

async function stlpSubmitDelivery(orderId,method,fields,messageBox){
 try{
  const r=await fetch('/api/track/'+encodeURIComponent(orderId)+'/delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({method:method},fields))});
  const result=await r.json();
  if(!r.ok)throw Error(result.error||'ثبت اطلاعات تحویل انجام نشد');
  stlpLoadOrder(orderId);
 }catch(error){messageBox.textContent=error.message;}
}

async function stlpDownloadFinalInvoice(order,button){
 if(typeof stlpGenerateInvoicePDF!=='function'){
  alert('موتور PDF لود نشده است؛ اتصال اینترنت را بررسی کنید.');
  return;
 }
 const original=button.textContent;
 button.disabled=true;button.textContent='در حال ساخت PDF...';
 try{
  const customer=order.customer||{};
  const isCompany=customer.customerType==='company';
  const opts={
   code:order.invoice_number,
   dateFa:order.invoice_date||order.created,
   buyerName:isCompany?(customer.companyName||customer.name||''):(customer.name||''),
   buyerEconCode:customer.econCode||'',
   buyerRegNo:customer.regNo||'',
   buyerNationalId:customer.nationalId||'',
   buyerPostalCode:customer.postalCode||'',
   buyerAddress:customer.address||'',
   buyerPhone:customer.phone||'',
   onlineTrackingCode:order.id,
   purchaseType:'cash',
   items:(function(){
     // دیتابیسِ سفارش‌ها فقط total (مبلغِ نهاییِ بعد از تخفیف) را
     // نگه می‌دارد، نه درصدِ تخفیف را جداگانه — پس درصدِ واقعاً
     // اعمال‌شده را از روی همان subtotal (جمعِ qty×price با قیمتِ
     // بدونِ تخفیف که در items ذخیره شده) و total واقعی حساب
     // می‌کنیم. قبلاً این فاکتورِ نهایی هم مثلِ پیش‌فاکتور، همیشه
     // discPercent صفر می‌فرستاد و جمعِ نمایش‌داده‌شده با مبلغِ
     // واقعاً رزرو/فروخته‌شده فرق داشت.
     const subtotal=(order.items||[]).reduce(function(sum,i){return sum+Number(i.qty||0)*Number(i.price||0);},0);
     const discPercent=subtotal>0?Math.round((1-Number(order.total||0)/subtotal)*10000)/100:0;
     return order.items.map(function(i){return {code:i.code,desc:i.title,qty:i.qty,unitPrice:i.price,unit:'بسته',discPercent:discPercent};});
   })()
  };
  await stlpGenerateInvoicePDF(opts);
 }catch(error){
  alert('ساخت PDF فاکتور انجام نشد: '+error.message);
 }finally{
  button.disabled=false;button.textContent=original;
 }
}

function stlpRenderDeliverySummary(delivery,postalTrackingCode){
 const box=document.createElement('div');box.className='stlp-delivery-summary';
 const lines=[];
 lines.push('روش تحویل: '+({courier:'پیک شرکت',post:'پست',representative:'تحویل به نماینده'}[delivery.method]||delivery.method));
 if(delivery.method==='courier'||delivery.method==='post'){
  lines.push('آدرس: '+delivery.address);
  if(delivery.postalCode)lines.push('کدپستی: '+delivery.postalCode);
 }else if(delivery.method==='representative'){
  lines.push('نام نماینده: '+delivery.repName);
  lines.push('کد ملی نماینده: '+delivery.repNationalId);
  lines.push('تلفن نماینده: '+delivery.repPhone);
 }
 if(delivery.method==='post'&&postalTrackingCode)lines.push('بارکد پستی: '+postalTrackingCode);
 box.style.whiteSpace='pre-wrap';box.textContent=lines.join('\n');
 return box;
}

function stlpRenderStagePanel(order){
 const panel=document.getElementById('track-stage-panel');
 panel.replaceChildren();
 // «pending» وضعیتِ قدیمیِ سیستمِ قبلی است؛ همان فرمِ آپلودِ فیش را نشان می‌دهیم
 const status=order.status==='pending'?'awaiting_receipt':order.status;

 // سفارشِ لغوشده حتی اگر قبلاً شماره‌فاکتور گرفته بود، دیگر نباید
 // بشود برایش فاکتورِ رسمیِ ممهور دانلود کرد — کالا هرگز ارسال نشده
 // و به انبار برگشته (store_server.py سهمِ رزروشده را restock می‌کند)
 if(order.invoice_number&&order.status!=='cancelled'){
  const invBtn=document.createElement('button');invBtn.type='button';invBtn.className='btn btn-outline';invBtn.textContent='دانلود فاکتور (شماره '+order.invoice_number+')';invBtn.style.marginBottom='14px';
  invBtn.onclick=function(){stlpDownloadFinalInvoice(order,invBtn);};
  panel.append(invBtn);
 }

 if(status==='awaiting_receipt'){

  if(order.receipt_rejection_note){
   const warn=document.createElement('div');warn.className='stlp-rejection-note';
   warn.textContent='فیشِ قبلی رد شد. علت: '+order.receipt_rejection_note+'\nلطفاً دوباره آپلود کنید.';
   panel.append(warn);
  }

  const label=document.createElement('label');label.textContent='فیش واریز (PNG، JPEG، WebP یا PDF — حداکثر ۲ مگابایت)';
  const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,application/pdf';
  const msg=document.createElement('div');msg.className='small';
  const btn=document.createElement('button');btn.type='button';btn.className='btn btn-primary';btn.textContent='آپلود فیش';btn.style.marginTop='10px';
  btn.onclick=function(){stlpUploadReceipt(order.id,input.files[0],msg);};
  panel.append(label,input,btn,msg);

 }else if(status==='under_review'){

  const info=document.createElement('div');info.className='small';
  info.textContent='فیش شما آپلود شد و در دست بررسیِ واحد فروش است. لطفاً بعداً دوباره پیگیری کنید.';
  panel.append(info);

 }else if(status==='awaiting_shipment'){

  if(order.delivery){

   const info=document.createElement('div');info.className='small';info.style.marginBottom='10px';
   info.textContent='اطلاعات ارسال ثبت شد؛ سفارش شما در انتظار بارگیری است.';
   panel.append(info,stlpRenderDeliverySummary(order.delivery,order.postal_tracking_code));

  }else{

   const msg=document.createElement('div');msg.className='small';

   const methodRow=document.createElement('div');methodRow.className='stlp-radio-row';
   [['courier','پیک شرکت'],['post','پست'],['representative','تحویل به نماینده']].forEach(function(pair){
    const lbl=document.createElement('label');lbl.className='pay-option';
    const radio=document.createElement('input');radio.type='radio';radio.name='deliveryMethod';radio.value=pair[0];
    lbl.append(radio,document.createTextNode(' '+pair[1]));
    methodRow.append(lbl);
   });

   const addressFields=document.createElement('div');addressFields.hidden=true;
   addressFields.innerHTML='<label>آدرس تحویل</label><textarea id="deliveryAddress"></textarea><label>کدپستی</label><input id="deliveryPostalCode" dir="ltr">';

   const repFields=document.createElement('div');repFields.hidden=true;
   repFields.innerHTML='<label>نام نماینده</label><input id="deliveryRepName"><label>کد ملی نماینده</label><input id="deliveryRepNationalId" dir="ltr"><label>تلفن نماینده</label><input id="deliveryRepPhone" dir="ltr">';

   methodRow.querySelectorAll('input[name=deliveryMethod]').forEach(function(r){
    r.addEventListener('change',function(){
     const isRep=r.value==='representative';
     addressFields.hidden=isRep;
     repFields.hidden=!isRep;
    });
   });

   const submitBtn=document.createElement('button');submitBtn.type='button';submitBtn.className='btn btn-primary';submitBtn.textContent='ثبت اطلاعات ارسال';submitBtn.style.marginTop='10px';
   submitBtn.onclick=function(){
    const selected=methodRow.querySelector('input[name=deliveryMethod]:checked');
    if(!selected){msg.textContent='لطفاً روش تحویل را انتخاب کنید.';return;}
    if(selected.value==='representative'){
     stlpSubmitDelivery(order.id,'representative',{
      repName:document.getElementById('deliveryRepName').value.trim(),
      repNationalId:document.getElementById('deliveryRepNationalId').value.trim(),
      repPhone:document.getElementById('deliveryRepPhone').value.trim()
     },msg);
    }else{
     stlpSubmitDelivery(order.id,selected.value,{
      address:document.getElementById('deliveryAddress').value.trim(),
      postalCode:document.getElementById('deliveryPostalCode').value.trim()
     },msg);
    }
   };

   panel.append(methodRow,addressFields,repFields,submitBtn,msg);

  }

 }else if(status==='delivered'){

  const info=document.createElement('div');info.className='small';info.textContent='✅ این سفارش تحویل داده شده است.';
  panel.append(info);
  if(order.delivery)panel.append(stlpRenderDeliverySummary(order.delivery,order.postal_tracking_code));

 }

}

async function stlpLoadOrder(id){
 const messageBox=document.getElementById('track-message'),resultBox=document.getElementById('track-result');
 try{
  const r=await fetch('/api/track/'+encodeURIComponent(id));
  const data=await r.json();
  if(!r.ok){messageBox.textContent=data.error||'سفارش یافت نشد';resultBox.hidden=true;return;}
  messageBox.textContent='';
  resultBox.hidden=false;
  stlpRenderTimeline(data.status);
  stlpRenderSummary(data);
  stlpRenderStagePanel(data);
 }catch(error){
  messageBox.textContent='اتصال به سرور برقرار نشد؛ دوباره تلاش کنید.';
  resultBox.hidden=true;
 }
}

const trackForm=document.getElementById('track-form');
if(trackForm){
 trackForm.addEventListener('submit',function(e){
  e.preventDefault();
  const id=document.getElementById('track-code').value.trim().toUpperCase();
  if(id)stlpLoadOrder(id);
 });
 const params=new URLSearchParams(location.search);
 const initialId=params.get('id');
 if(initialId){
  document.getElementById('track-code').value=initialId.toUpperCase();
  stlpLoadOrder(initialId.toUpperCase());
 }
}
