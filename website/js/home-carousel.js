const filmCards=[...document.querySelectorAll('.film-card')];
function selectFilm(index){
 const selected=filmCards[index];
 filmCards.forEach(card=>card.setAttribute('aria-pressed',String(card===selected)));
 document.getElementById('film-title').textContent=selected.dataset.title;
 document.getElementById('film-link').href='shop.html?type='+encodeURIComponent(selected.dataset.title);
 document.querySelector('.hero').style.setProperty('--slide-wash',selected.dataset.wash);
}
filmCards.forEach((card,index)=>card.addEventListener('click',()=>selectFilm(index)));
document.querySelectorAll('[data-film-step]').forEach(button=>button.addEventListener('click',()=>{
 const current=filmCards.findIndex(card=>card.getAttribute('aria-pressed')==='true');
 selectFilm((current+Number(button.dataset.filmStep)+filmCards.length)%filmCards.length);
}));
document.querySelector('.filmstrip').addEventListener('keydown',event=>{
 if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
 event.preventDefault();const current=filmCards.indexOf(document.activeElement);
 const next=(Math.max(current,0)+(event.key==='ArrowRight'?1:-1)+filmCards.length)%filmCards.length;
 selectFilm(next);filmCards[next].focus();
});
