/* Interaction layer for the refreshed HTML storefront. */
let toastTimer;
function toggleAdvancedFilters(button) {
  const collapsed = button.closest('.filters').classList.toggle('mobile-collapsed');
  button.setAttribute('aria-expanded', String(!collapsed));
}
function showToast(message) {
  let toast = document.getElementById('shop-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'shop-toast'; toast.className = 'shop-toast';
    toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}
function resetFilters() {
  ['searchInput','filterType','filterSize','minPrice','maxPrice','filterSort'].forEach(id => document.getElementById(id).value = '');
  applyFilters(); syncChips();
}
function syncChips() {
  const selected = document.getElementById('filterType').value;
  document.querySelectorAll('.type-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === selected)));
}
function initShop() {
  const bar = document.querySelector('.type-chips');
  ['', ...new Set(PRODUCTS.map(p=>p.type))].forEach(type => {
    const button = document.createElement('button'); button.type='button'; button.className='type-chip';
    button.dataset.type=type; button.textContent=type || 'همهٔ محصولات';
    button.addEventListener('click',()=>{document.getElementById('filterType').value=type;applyFilters();syncChips();});
    bar.appendChild(button);
  });
  const typeSelect = document.getElementById('filterType');
  typeSelect.replaceChildren(); ['', ...new Set(PRODUCTS.map(p=>p.type))].forEach(type=>{const o=document.createElement('option');o.value=type;o.textContent=type||'همه';typeSelect.append(o);});
  const sizeSelect = document.getElementById('filterSize');
  sizeSelect.replaceChildren(); ['', ...new Set(PRODUCTS.map(p=>p.size).filter(Boolean))].forEach(size=>{const o=document.createElement('option');o.value=size;o.textContent=size||'همه';sizeSelect.append(o);});
  const requested = new URLSearchParams(location.search).get('type');
  if ([...document.getElementById('filterType').options].some(o=>o.value===requested)) document.getElementById('filterType').value=requested;
  ['filterType','filterSize','minPrice','maxPrice','filterSort'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{applyFilters();syncChips();}));
  applyFilters(); syncChips();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
document.addEventListener('DOMContentLoaded',()=>{
  const menu=document.getElementById('mobile-menu');
  if(menu)menu.addEventListener('click',e=>{if(e.target===menu)closeMenu();});
});
