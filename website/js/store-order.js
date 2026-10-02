async function stlpDownloadOrderReceiptPDF(order, customer, cart, button){

  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined' || typeof stlpGenerateInvoicePDF === 'undefined') {
    alert('کتابخانه‌های ساخت PDF هنوز لود نشده‌اند؛ چند لحظه صبر کنید و دوباره امتحان کنید.');
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'در حال ساخت PDF…';

  try {

    // این خروجی فقط برای نمایش به مشتری است، نه سند رسمی — به همین
    // دلیل به‌جای شماره‌ی فاکتور واقعی (که فقط بعد از تأیید سفارش
    // توسط واحد فروش صادر می‌شود)، همان‌جای شماره، عبارت «پیش‌فاکتور»
    // نوشته می‌شود. موتور PDF دقیقاً همان stlpGenerateInvoicePDF ERP است.
    const opts = {

      code: 'پیش‌فاکتور',
      dateFa: new Date().toLocaleDateString('fa-IR'),
      settlementNote: 'مهلت تسویه 48 ساعت می‌باشد',

      buyerName: (customer.customerType === 'company' ? (customer.companyName || customer.name) : customer.name) || '',
      buyerAddress: customer.address || '',
      buyerPhone: customer.phone || '',
      buyerEconCode: customer.econCode || '',
      buyerRegNo: customer.regNo || '',
      buyerProvince: '',
      buyerCity: '',
      buyerPostalCode: customer.postalCode || '',
      buyerNationalId: customer.nationalId || '',

      isCash: true,

      items: (function(){
        // درصد تخفیفِ واقعاً اعمال‌شده روی این سفارش را از روی همان
        // subtotal/discount که خودِ سرور برگردانده حساب می‌کنیم (نه از
        // روی چیزی که صفحه‌ی سبد خرید نمایش داده بود) تا این پیش‌فاکتور
        // دقیقاً همان مبلغی را نشان دهد که واقعاً رزرو/محاسبه شده —
        // قبلاً این تخفیف اصلاً به موتور PDF منتقل نمی‌شد و جمعِ فاکتور
        // همیشه برابر با قیمتِ بدونِ تخفیف نشان داده می‌شد.
        const discPercent =
          order && order.subtotal > 0
            ? Math.round((Number(order.discount || 0) / Number(order.subtotal)) * 10000) / 100
            : 0;

        return cart.map(function(item){
          return {
            code: item.code,
            desc: item.title || item.code,
            unit: 'بسته',
            qty: Number(item.qty || 0),
            unitPrice: Number(item.packPrice || 0),
            discPercent: discPercent
          };
        });
      })()

    };

    await stlpGenerateInvoicePDF(opts);

  } catch (error) {
    alert('ساخت PDF ناموفق بود: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }

}

const individualFieldsBox=document.getElementById('individual-fields'),companyFieldsBox=document.getElementById('company-fields');
function applyCustomerTypeVisibility(){
 const isCompany=document.getElementById('customerType-company').checked;
 if(individualFieldsBox)individualFieldsBox.hidden=isCompany;
 if(companyFieldsBox)companyFieldsBox.hidden=!isCompany;
 const nationalIdInput=document.getElementById('nationalId');
 if(nationalIdInput)nationalIdInput.required=!isCompany;
 // سرور برای مشتریِ حقوقی، شماره ثبت و کد اقتصادی را الزامی می‌داند
 // (store_server.py) ولی این دو فیلد required نداشتند، یعنی فرم با
 // خالی‌بودنشان رد می‌شد و کاربر فقط بعد از یک رفت‌وبرگشتِ کاملِ
 // شبکه با پیغامِ سرور متوجه می‌شد.
 const regNoInput=document.getElementById('regNo');
 const econCodeInput=document.getElementById('econCode');
 if(regNoInput)regNoInput.required=isCompany;
 if(econCodeInput)econCodeInput.required=isCompany;
}
document.querySelectorAll('input[name=customerType]').forEach(r=>r.addEventListener('change',applyCustomerTypeVisibility));
applyCustomerTypeVisibility();

const orderForm=document.getElementById('order-form');
if(orderForm){orderForm.removeAttribute('onsubmit');orderForm.addEventListener('submit',async event=>{
 event.preventDefault();if(!orderForm.reportValidity())return;
 const button=orderForm.querySelector('button[type=submit]'),box=document.getElementById('after-submit');button.disabled=true;box.style.display='block';box.textContent='در حال بررسی موجودی و ثبت سفارش…';
 let key=sessionStorage.getItem('stlpOrderKey');if(!key){key=crypto.randomUUID();sessionStorage.setItem('stlpOrderKey',key);}
 const customer={};for(const id of ['name','lab','phone','email','address','note'])customer[id]=document.getElementById(id).value.trim();
 const isCompanyCustomer=document.getElementById('customerType-company').checked;
 customer.customerType=isCompanyCustomer?'company':'individual';
 customer.nationalId=(isCompanyCustomer?document.getElementById('companyNationalId').value:document.getElementById('nationalId').value).trim();
 customer.companyName=document.getElementById('companyName').value.trim();
 customer.regNo=document.getElementById('regNo').value.trim();
 customer.econCode=document.getElementById('econCode').value.trim();
 customer.postalCode=document.getElementById('postalCode').value.trim();
 try{const cart=JSON.parse(localStorage.getItem('stlpCart')||'[]');const r=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer,items:cart.map(p=>({code:p.code,qty:p.qty})),coupon:localStorage.getItem('stlpCouponCode')||'',key})});const result=await r.json();if(!r.ok)throw Error(result.error||'ثبت سفارش انجام نشد');
 box.replaceChildren();const heading=document.createElement('h2');heading.textContent='سفارش '+result.id+' ثبت شد';box.append(heading);const detail=document.createElement('p');detail.textContent=customer.name+' · '+customer.phone+'\n'+customer.address+'\n'+cart.map(i=>i.code+' × '+i.qty+' بسته').join('\n')+'\nمبلغ نهایی: '+result.total.toLocaleString('fa-IR')+' ریال\nموجودی رزرو شد. سفارش در انتظار تأیید واحد فروش است؛ پرداختی انجام نشده است.';detail.style.whiteSpace='pre-wrap';box.append(detail);
 const trackBox=document.createElement('p');trackBox.innerHTML='<strong>کد پیگیری سفارش شما: '+result.id+'</strong>';box.append(trackBox);
 const trackLink=document.createElement('a');trackLink.className='btn btn-primary';trackLink.href='track.html?id='+encodeURIComponent(result.id);trackLink.textContent='پیگیری سفارش و آپلود فیش پرداخت';box.append(trackLink);
 const print=document.createElement('button');print.className='btn btn-outline';print.textContent='دانلود پیش‌فاکتور PDF';print.onclick=()=>stlpDownloadOrderReceiptPDF(result,customer,cart,print);box.append(print);const link=document.createElement('a');link.className='btn btn-outline';link.href='shop.html';link.textContent='بازگشت به فروشگاه';box.append(link);orderForm.hidden=true;localStorage.removeItem('stlpCart');localStorage.removeItem('stlpCouponCode');localStorage.removeItem('stlpDiscountPercent');sessionStorage.removeItem('stlpOrderKey');updateCartBadge();document.getElementById('cart-summary').hidden=true;}
 catch(e){box.textContent=e.message;button.disabled=false;}
 });orderForm.querySelector('button[type=submit]').textContent='ثبت سفارش و رزرو موجودی';}
