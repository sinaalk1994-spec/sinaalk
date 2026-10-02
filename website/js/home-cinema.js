const cinema=document.querySelector('.cinema');
const cinemaPause=document.querySelector('.cinema-pause');
cinemaPause?.addEventListener('click',()=>{const paused=cinema.classList.toggle('paused');cinemaPause.setAttribute('aria-pressed',String(paused));cinemaPause.setAttribute('aria-label',paused?'ادامه حرکت':'توقف حرکت');cinemaPause.textContent=paused?'▷':'Ⅱ';});
