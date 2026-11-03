document.querySelectorAll('.share').forEach(function(s){var u=s.dataset.url,t=s.dataset.title,st=s.querySelector('.st'),ws=s.querySelector('.ws');
if(!navigator.share){ws.hidden=true}else ws.addEventListener('click',function(){navigator.share({title:t,text:t,url:u}).catch(function(){})});
s.querySelector('.cp').addEventListener('click',function(){(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){st.textContent='Link copied!'},function(){window.prompt('Copy this link:',u)})});});
