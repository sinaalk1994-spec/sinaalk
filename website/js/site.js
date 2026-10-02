// STLP — shared site behavior (nav + cart badge)

function getCart(){
  try{ return JSON.parse(localStorage.getItem("stlpCart") || "[]"); }
  catch(e){ return []; }
}
function cartCount(){
  return getCart().reduce(function(n,i){ return n + (i.qty||0); }, 0);
}
function updateCartBadge(){
  var el = document.getElementById("cart-badge");
  if(!el) return;
  var c = cartCount();
  if(c > 0){ el.style.display = "flex"; el.textContent = c > 99 ? "99+" : c; }
  else { el.style.display = "none"; }
}
function openMenu(){
  var m = document.getElementById("mobile-menu");
  if(m) m.classList.add("open");
}
function closeMenu(){
  var m = document.getElementById("mobile-menu");
  if(m) m.classList.remove("open");
}
document.addEventListener("DOMContentLoaded", updateCartBadge);
