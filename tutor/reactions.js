/* NISMCAA reactions bar (preview). Syncs between tabs on the SAME device via BroadcastChannel only. Cross-device sync needs a server later. Jitsi also has its own built-in raise hand. */
(function(){
const R=[['hand','✋','Raise hand'],['up','👍','Like'],['clap','👏','Clap'],['love','❤️','Love'],['lol','😂','Funny'],['wow','😮','Wow'],['yes','✅','Yes'],['no','❌','No'],['q','❓',"I don't understand"],['slow','🐢','Slow down'],['fast','⏩','Speed up'],['brk','☕','Need a break']];
const room=(new URLSearchParams(location.search).get('room')||'demo').replace(/[^\w-]/g,''),K='nr_'+room;
let S=JSON.parse(localStorage.getItem(K)||'{"c":{},"q":[]}');const me=sessionStorage.nrMe||(sessionStorage.nrMe='Guest '+Math.floor(100+Math.random()*900));
const bc='BroadcastChannel'in window?new BroadcastChannel('nr-'+room):null;
const st=document.createElement('style');st.textContent=`#nrBar{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#182947;padding:8px;display:flex;gap:6px;overflow-x:auto;box-shadow:0 -4px 16px #0004}#nrBar button{flex:0 0 auto;min-width:64px;min-height:64px;border-radius:16px;border:2px solid #ffdb67;background:#22365e;color:#fff;font-size:1.7rem;position:relative;padding:4px 8px}#nrBar button small{display:block;font-size:.6rem;font-weight:700;max-width:72px;white-space:normal;line-height:1.1}#nrBar button.on{background:#ffdb67;color:#182947}#nrBar i{position:absolute;top:-6px;right:-6px;background:#ff6b4a;color:#fff;font-style:normal;font-size:.7rem;border-radius:10px;padding:1px 6px}#nrQ{position:fixed;right:10px;bottom:96px;z-index:51;background:#fff;color:#182947;border:2px solid #ffdb67;border-radius:16px;padding:10px;max-width:260px;font:14px 'DM Sans',Arial;box-shadow:0 6px 20px #0003}#nrQ button{min-height:40px;margin:2px}.nrF{position:fixed;bottom:90px;font-size:2.6rem;z-index:52;pointer-events:none;animation:nrUp 2.6s ease-out forwards}@keyframes nrUp{to{transform:translateY(-60vh) scale(1.4);opacity:0}}body{padding-bottom:180px!important}@media(max-width:760px){#nrQ{position:static;margin:10px;max-width:none}}`;document.head.appendChild(st);
const bar=document.createElement('div');bar.id='nrBar';bar.setAttribute('aria-label','Reactions');
bar.innerHTML=R.map(([k,e,l])=>`<button data-k="${k}" title="${l}" aria-label="${l}">${e}<small>${l}</small><i id="nrc-${k}">0</i></button>`).join('');
const qb=document.createElement('div');qb.id='nrQ';
document.body.append(bar,qb);
function save(){localStorage.setItem(K,JSON.stringify(S))}
function float(e){const f=document.createElement('div');f.className='nrF';f.textContent=e;f.style.left=(10+Math.random()*80)+'vw';document.body.appendChild(f);setTimeout(()=>f.remove(),2700)}
function draw(){R.forEach(([k])=>{const n=k=='hand'?S.q.length:(S.c[k]||0);document.getElementById('nrc-'+k).textContent=n});
bar.querySelector('[data-k=hand]').classList.toggle('on',S.q.includes(me));
qb.innerHTML=`<b>✋ Hand queue (host view)</b> <span style="font-size:.75rem">You are ${me}</span><ol id="nrList">${S.q.map((p,i)=>`<li>✋ ${p} <button data-l="${i}">Lower</button></li>`).join('')||'<li style="list-style:none">No hands raised</li>'}</ol><button id="nrClear">Host: clear all</button><div style="font-size:.7rem;margin-top:4px">Preview: syncs between tabs on this device only. Cross-device needs a server later. Jitsi also has its own raise hand.</div>`;
qb.querySelectorAll('[data-l]').forEach(b=>b.onclick=()=>{S.q.splice(+b.dataset.l,1);push()});
document.getElementById('nrClear').onclick=()=>{S={c:{},q:[]};push()}}
function push(e){save();draw();bc&&bc.postMessage({S,e})}
bar.querySelectorAll('button').forEach(b=>b.onclick=()=>{const k=b.dataset.k,e=R.find(r=>r[0]==k)[1];
if(k=='hand'){const i=S.q.indexOf(me);i<0?S.q.push(me):S.q.splice(i,1)}else S.c[k]=(S.c[k]||0)+1;float(e);push(e)});
if(bc)bc.onmessage=({data})=>{S=data.S;save();draw();if(data.e)float(data.e)};
draw();window.NR={get:()=>S};
})();
