function escapeStore(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadStoreCatalog(){
 try{const r=await fetch('/api/products');if(!r.ok)throw Error();const data=await r.json();PRODUCTS=data.products;initShop();}
 catch(e){document.getElementById('resultInfo').textContent='ارتباط با انبار فروشگاه برقرار نشد. سایت را از سرور فروشگاه باز کنید.';document.getElementById('products-grid').replaceChildren();}
}
function safeStoreCart(){const items=getCart();return Array.isArray(items)?items:[];}
