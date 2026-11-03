const P=new URLSearchParams(location.search);let cc=COUNTRIES[P.get("c")]?P.get("c"):"us";let step=0,paid=false,started=false;
const csel=document.getElementById("csel");for(const k in COUNTRIES)csel.add(new Option(COUNTRIES[k].name,k));csel.value=cc;
csel.onchange=()=>{location.search="?c="+csel.value};
const C=COUNTRIES[cc];const r=document.documentElement.style;r.setProperty("--c1",C.c1);r.setProperty("--c2",C.c2);r.setProperty("--soft",C.soft);
const S=C.sample;
const ICON_MUSIC=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c1}"/><path d="M26 44a6 6 0 1 1-4-5.6V18l20-5v24a6 6 0 1 1-4-5.6V20l-12 3z" fill="#fff"/></svg>`;
const ICON_ACAD=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c2}"/><path d="M10 27l22-10 22 10-22 10z" fill="#fff"/><path d="M19 32v9c0 4 26 4 26 0v-9l-13 6z" fill="#fff"/><path d="M50 29v12" stroke="#fff" stroke-width="2"/></svg>`;
const ICON_SIGN=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c1}"/><rect x="18" y="14" width="28" height="36" rx="3" fill="#fff"/><path d="M23 24h18M23 30h18M23 36h10" stroke="${C.c1}" stroke-width="2"/><path d="M34 44l4 4 8-10" stroke="${C.c2}" stroke-width="3" fill="none"/></svg>`;
const R=`<span style="color:#b42318"> *</span>`;
const HERO=`<div class="illus"><svg viewBox="0 0 520 150" width="100%" role="img" aria-label="Illustration of a trumpet, a guitar, music notes, a book and a trophy">
<rect width="520" height="150" rx="12" fill="${C.soft}"/>
<g transform="translate(30,30)"><rect x="40" y="10" width="14" height="80" rx="4" fill="#8a5a2b"/><ellipse cx="47" cy="100" rx="34" ry="30" fill="#c27a3a"/><ellipse cx="47" cy="78" rx="26" ry="22" fill="#c27a3a"/><circle cx="47" cy="92" r="9" fill="#5a3410"/><path d="M41 0h12v14H41z" fill="#5a3410"/></g>
<g transform="translate(135,55)" fill="${C.c2}"><rect x="0" y="22" width="90" height="10" rx="5"/><path d="M88 10 L130 -8 L130 62 L88 44 Z"/><rect x="30" y="8" width="7" height="18"/><rect x="44" y="8" width="7" height="18"/><rect x="58" y="8" width="7" height="18"/><circle cx="-4" cy="27" r="8"/></g>
<g fill="${C.c1}"><path d="M300 40v40a10 10 0 1 1-6-9V44l26-8v36a10 10 0 1 1-6-9V44z"/><path d="M340 90v26a8 8 0 1 1-5-7V90z"/></g>
<g transform="translate(375,70)"><rect x="0" y="20" width="56" height="44" rx="4" fill="#fff" stroke="${C.c1}" stroke-width="3"/><path d="M28 22v40M8 32h14M8 42h14M34 32h14M34 42h14" stroke="${C.c1}" stroke-width="2.5"/></g>
<g transform="translate(445,28)"><path d="M10 0h40v28a20 20 0 0 1-40 0z" fill="#e9b308"/><path d="M10 8H0a12 12 0 0 0 12 16M50 8h10a12 12 0 0 1-12 16" stroke="#e9b308" stroke-width="4" fill="none"/><rect x="25" y="47" width="10" height="16" fill="#c99400"/><rect x="12" y="63" width="36" height="10" rx="2" fill="${C.c1}"/><path d="M30 10l3 7 7 .6-5.4 4.6 1.7 7L30 25.5 23.7 29l1.7-7L20 17.6l7-.6z" fill="#fff"/></g>
</svg></div>`;
const CR=g=>`<span class="cr" data-g="${g}" style="color:#b42318;display:none"> *</span>`;
const opts=a=>`<option value="">Choose one</option>`+a.map(x=>`<option>${esc(x)}</option>`).join("");
const F=(id,lab,req,type="text",ex="")=>`<label class="f">${lab}${req?R:""}<input id="${id}" type="${type}" ${ex}></label>`;
const SEL=(id,lab,arr,req=1)=>`<label class="f">${lab}${req?R:""}<select id="${id}">${opts(arr)}</select></label>`;
const TA=(id,lab,req=1)=>`<label class="f">${lab}${req?R:""}<textarea id="${id}"></textarea></label>`;
const CK=(id,t)=>`<label class="chk"><input type="checkbox" id="${id}"><span>${t}</span></label>`;
const year=new Date().getFullYear();
const head=(n,t)=>`<div class="hdr"><img src="${C.logo}" alt="NISMCAA ${esc(C.name)} logo"><div><h1>NISMCAA</h1><div class="sub">Music Competition &amp; Academic Award</div></div><div class="ctry"><b>${esc(C.name)}</b><br>Official entry form</div></div><div class="ptitle"><span class="stepno" data-n="${n}">Step</span>&nbsp; ${t}</div><div class="prog noprint"><div class="bar"></div></div>`;
const foot=n=>`<div class="ftr"><span>Authorized by NISMCAA Secretariat | ${esc(C.name)} online entry | <a href="mailto:info@nismcaa.com">info@nismcaa.com</a> | <a href="tel:+14707390021">(470) 739-0021</a></span><span class="pgno" data-n="${n}"></span></div>`;
const intro0=`<div class="kick">Online entry form – complete the blue fields</div><p class="note">Music and academic awards welcome children with special needs. Your progress saves automatically on this device. Fields marked <span style="color:#b42318">*</span> are required.</p>`;const intro="";
const feeBox=`<div class="fee"><b>${cc==="ng"?"Commitment fee":"Entry fee"}:</b> ${esc(C.feeText)}</div>`;
const pages=[
`${head(1,"School / Institution &amp; Entrant")}<div class="body">${HERO}${intro0}<div class="err"></div>
${SEL("cat","Entry category – one registration per school, per category, per year",CATS.map(c=>c[1]))}${feeBox}
<div class="row">${F("country","Country",1,"text","readonly value='"+esc(C.name)+"'")}${SEL("edition","Edition / event year",[String(year+1)+" edition – next competition (most schools choose this)",String(year)+" edition – current season, only if your country is still taking "+year+" entries"])}</div><p class="note" style="margin-top:-6px">The edition is the competition year your school will perform in. If you are not sure, choose the ${year+1} edition.</p>
<div class="sec">School / institution information</div>
${F("school","School / institution name (e.g. "+S.school+")",1)}${F("addr","School address",1)}
<div class="row">${F("city","City",1)}${SEL("region",C.regionLabel,C.regions)}</div>
<div class="row">${F("post",C.postLabel+" ("+C.postHint+")",1)}${SEL("level","School / institution level",C.levels)}</div>
<div class="row">${F("sphone","School telephone",1,"tel")}${F("ssite","School website (optional)",0,"url")}</div>
${C.idField?F("nces",C.idField,0):""}
<div class="sec">Entrant / nominee</div>
${F("entrant","Student / teacher / institution / group name (e.g. "+S.student+")",1)}
<div class="row">${F("grade","Class / year level (students only)",0)}${F("rep","Nominating school representative",1)}</div>
${CK("enrol","The students named in this registration are enrolled at this school, and the school can verify it.")}
<p class="note">Every student represents the school where they are enrolled. There is no competition age limit.</p></div>`,
`${head(2,"Music Entries Only")}<div class="body">${intro}<div class="hero">${ICON_MUSIC}<div class="note">Performance and qualifying video. Only for the music categories.</div></div><div class="err"></div>
<div class="sec">Performance and qualifying video</div>
${F("song","Song / performance title",1)}${F("theme","Assigned qualifying theme – school group music only"+CR("grp"),0)}
<div class="row">${F("pupils","Total pupils on stage – group maximum 30"+CR("grp"),0,"number","min=1")}${SEL("live","What is performed live?",["Singing and instruments – both performed live","Singing only – live voices, no instruments","Instruments only – live instruments, no singing"])}</div>
<div id="w30" class="warn" style="display:none">NISMCAA groups may have no more than 30 students on stage in total. Please check your number.</div>
<div class="row">${F("mins","Video duration – maximum 10 minutes",1,"number","min=1 max=10")}${F("yt","YouTube video link (unlisted)",1,"url")}</div>
<div class="row">${F("pg","Parent / guardian phone – individual student"+CR("ind"),0,"tel")}${F("mteacher","Music / supervising teacher name",1)}</div>
${SEL("orig","Original song or cover song",["Original song","Cover song"])}
${TA("desc","Performance description / group summary (roles and instruments, no children's names)")}
<div class="sec">Category requirements</div>
<p class="note"><b>School group:</b> original student composition, live singing and instrumentation, no copyright songs, loops, prerecorded beats, backing tracks or external performance aids. Maximum 30 pupils in total, including singers, instrumentalists and dancers; maximum 10 minutes.</p>
<p class="note"><b>Individual:</b> originality is encouraged. Cover songs may be performed under the entrant's responsibility for permissions and rights. A qualifying music video is required.</p>
${CK("mreq","I have read the requirements for the selected music category.")}</div>`,
`${head(3,"Academic Awards Only")}<div class="body">${intro}<div class="hero">${ICON_ACAD}<div class="note">The Academic Award is free to enter.</div></div><div class="err"></div>
<div class="sec">Nomination details</div>
${SEL("subj","Best Student subject – student nominations only"+CR("bs"),["Mathematics","Music","Science & Technology","English"],0)}
<div class="row">${SEL("elevel","Education level",C.levels)}${F("course","Course / program – tertiary nominations",0)}</div>
${F("area","Best Teacher subject / Best School achievement area"+CR("bt"),0)}${F("atitle","Award title",1)}
${TA("summary","Achievement summary – what, when and nominee contribution")}${TA("evidence","Evidence / verification – list records, projects or endorsements")}
<p class="note">Academic awards have no music theme, song, stage headcount or performance-time requirement. Student nominees complete a subject task after submitting.</p>
${CK("verify","The stated achievements and evidence can be verified by the school / institution.")}</div>`,
`${head(4,"Authorization &amp; Submit")}<div class="body">${intro}<div class="hero">${ICON_SIGN}<div class="note">Review, sign by typing your name, and submit. Questions: <a href="mailto:info@nismcaa.com">info@nismcaa.com</a> | <a href="tel:+14707390021">(470) 739-0021</a>. Want lessons for your students? Write to the NISMCAA Academy at <a href="mailto:academy@nismcaa.com">academy@nismcaa.com</a>.</div></div><div class="err"></div>
${CK("support","Optional: contact our school privately to discuss participation support.")}
<div class="sec">Authorized school contacts</div>
<div class="row">${F("remail","School representative email",1,"email")}${F("rphone","School representative telephone",1,"tel")}</div>
<div class="row">${F("tname","Supervising teacher / lecturer name",1)}${F("temail","Teacher / lecturer email",1,"email")}</div>
<div class="row">${F("head","Head teacher / authorizing official",1)}${F("hemail","Authorizing official email",1,"email")}</div>
<div class="sec">${esc(C.name)} terms</div><ul class="note">${C.terms.map(t=>"<li>"+esc(t)+"</li>").join("")}</ul>
<div class="sec">Declarations</div>
${CK("d1","The entry / nomination information is accurate and can be verified.")}${CK("d2","I am authorized to represent the school / institution for this entry.")}
${CK("d3","Required student and parent / guardian permissions have been obtained, where applicable.")}${CK("d4",`I have read the current <a href="https://nismcaa.com/terms" target="_blank">NISMCAA Terms &amp; Conditions</a>.`)}
<div class="row">${F("sig","Authorized representative – typed full name",1)}${F("sdate","Date completed",1,"date")}</div>
<div id="feeline"></div></div>`];
const pg=document.getElementById("pages");
pg.innerHTML=pages.map((h,i)=>`<div class="sheet pg" id="pg${i}" style="display:none">${h}<div class="nav noprint"><button class="btn alt" data-prev>${i?"Back":"Clear form"}</button><button class="btn" data-next>${i==3?"Submit entry":"Continue"}</button></div>${foot(i+1)}</div>`).join("")+`<div class="sheet" id="done" style="display:none"></div>`;
document.getElementById("sdate").value=new Date().toISOString().slice(0,10);
const $=id=>document.getElementById(id);
const kind=()=>{const c=CATS.find(x=>x[1]===$("cat").value);return c?c[2]:null};
const catId=()=>{const c=CATS.find(x=>x[1]===$("cat").value);return c?c[0]:null};
const fee=()=>catId()?feeFor(cc,catId()):0;
const flow=()=>[0,kind()==="acad"?2:1,3];
const DRAFT="nis_draft_"+cc;
function save(){const d={};pg.querySelectorAll("input,select,textarea").forEach(e=>{if(e.id)d[e.id]=e.type==="checkbox"?e.checked:e.value});LS.set(DRAFT,d)}
function load(){const d=LS.get(DRAFT,null);if(!d)return;for(const k in d){const e=$(k);if(!e||k==="country")continue;e.type==="checkbox"?e.checked=d[k]:e.value=d[k]}}
pg.addEventListener("input",e=>{if(!started){started=true;logAct("form_started",C.name+" entry form started",cc)}e.target.classList.remove("bad");save();upd()});
pg.addEventListener("change",()=>{save();upd()});
function upd(){const g=catId()||"";const grp=g=="grp"||g=="sgrp",ind=g=="ind"||g=="sind";document.querySelectorAll(".cr").forEach(x=>{const k=x.dataset.g;x.style.display=(k=="grp"&&grp)||(k=="ind"&&ind)||(k=="bs"&&(g=="bs"||g=="sacad"))||(k=="bt"&&(g=="bt"||g=="bsc"))?"inline":"none"});$("w30").style.display=(+$("pupils").value>30)?"block":"none";
 const f=fee();$("feeline").innerHTML=f>0?`<div class="fee"><b>Commitment fee due: ${money(cc,f)}</b> (non-refundable). ${paid?"<span class='pill p-app'>Paid (test)</span>":`<button class="btn sm" id="paybtn" type="button">Pay ${money(cc,f)} now</button><div class="err" id="payerr" style="margin-top:8px">Please pay the commitment fee here before you submit.</div>`}</div>`:`<div class="fee"><b>Amount due: ${cc==="us"?"$0 – sponsored by the NISMCAA Foundation":(C.sym?C.sym+"0":"$0")+" – free entry"}</b></div>`;
 const pb=$("paybtn");if(pb)pb.onclick=()=>{$("pamt").value=money(cc,f);$("perr").style.display="none";$("paym").style.display="flex"};
 drawSteps()}
const REQ={0:["cat","edition","school","addr","city","region","post","level","sphone","entrant","rep","enrol"],1:["song","live","mins","yt","mteacher","orig","desc","mreq"],2:["elevel","atitle","summary","evidence","verify"],3:["remail","rphone","tname","temail","head","hemail","d1","d2","d3","d4","sig","sdate"]};
function check(i){const bad=[];let req=[...REQ[i]];const id=catId();
 if(i==1&&(id=="grp"||id=="sgrp"))req.push("pupils","theme");if(i==1&&(id=="ind"||id=="sind"))req.push("pg");if(i==2&&(id=="bs"||id=="sacad"))req.push("subj");if(i==2&&(id=="bt"||id=="bsc"))req.push("area");
 req.forEach(k=>{const e=$(k);const ok=e.type==="checkbox"?e.checked:e.value.trim()&&e.checkValidity();if(!ok){bad.push(k);e.classList.add("bad")}});
 if(i==1&&$("yt").value&&!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test($("yt").value)){bad.push("yt");$("yt").classList.add("bad")}
 const er=$("pg"+i).querySelector(".err");let msg=bad.length?"Please complete the fields marked in red ("+bad.length+").":"";
 er.textContent=msg;er.style.display=msg?"block":"none";if(msg)er.scrollIntoView({block:"center"});
 if(i==3&&!bad.length&&fee()>0&&!paid){const pe=$("payerr");pe.style.display="block";pe.scrollIntoView({block:"center",behavior:"smooth"});return false}return !msg}
function drawSteps(){const names=["School & entrant",kind()==="acad"?"Academic award":"Music entry","Authorize & submit"];const f=flow();
 $("steps").innerHTML=f.map((p,i)=>`<button class="${p===step?"on":""} ${f.indexOf(step)>i?"done":""}" data-go="${p}">${i+1}. ${names[i]}</button>`).join("")}
function show(i){step=i;const f=flow(),pos=f.indexOf(i);document.querySelectorAll(".stepno").forEach(x=>x.textContent="Step "+(f.indexOf(+x.dataset.n-1)+1)+" of 3");document.querySelectorAll(".pgno").forEach(x=>x.textContent="Page "+(f.indexOf(+x.dataset.n-1)+1)+" / 3");document.querySelectorAll(".prog .bar").forEach(b=>b.style.width=((pos+1)/3*100)+"%");document.querySelectorAll(".pg").forEach((e,k)=>e.style.display=k===i?"flex":"none");$("done").style.display="none";drawSteps();scrollTo(0,0)}
$("steps").onclick=e=>{const g=e.target.dataset.go;if(g===undefined)return;const f=flow(),t=+g;if(f.indexOf(t)>f.indexOf(step)){for(const p of f){if(p===t)break;if(!check(p)){show(p);return}}}show(t)};
pg.addEventListener("click",e=>{const f=flow(),pos=f.indexOf(step);
 if(e.target.hasAttribute("data-next")){if(!kind()){check(0);return}if(!check(step))return;if(step===3)return submit();show(f[pos+1])}
 if(e.target.hasAttribute("data-prev")){if(pos>0)show(f[pos-1]);else if(confirm("Clear everything on this form?")){localStorage.removeItem(DRAFT);location.reload()}}});
$("pcancel").onclick=()=>$("paym").style.display="none";
$("pgo").onclick=()=>{const n=$("pcard").value.replace(/\s/g,"");if(n!=="4242424242424242"||!/^\d\d\/\d\d$/.test($("pexp").value)||!/^\d{3,4}$/.test($("pcvc").value)){$("perr").textContent="Card declined. In test mode, use 4242 4242 4242 4242.";$("perr").style.display="block";return}
 paid=true;$("paym").style.display="none";logAct("payment",`Commitment fee ${money(cc,fee())} paid (test) – ${$("school").value}`,cc);upd();check(3)};
async function submit(){const id="";const d=LS.get(DRAFT,{});
 const e={id,country:cc,cat:$("cat").value,school:$("school").value,entrant:$("entrant").value,city:$("city").value,region:$("region").value,rep:$("rep").value,email:$("remail").value,fee:fee(),paid:fee()>0?paid:null,status:"Submitted",t:new Date().toISOString(),data:d};
 const sb=document.querySelector("#pg3 [data-next]");sb.disabled=true;sb.textContent="Sending…";let rid;try{const r=await fetch(API+"/entry/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entry:e})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Server error");rid=j.id}catch(err){sb.disabled=false;sb.textContent="Submit entry";const er=$("pg3").querySelector(".err");er.textContent="We could not send your entry ("+err.message+"). Your answers are saved. Please try again.";er.style.display="block";er.scrollIntoView({block:"center"});return}
 e.id=rid;const id2=rid;localStorage.removeItem(DRAFT);
 document.querySelectorAll(".pg").forEach(x=>x.style.display="none");$("steps").innerHTML="";
 $("done").innerHTML=`${head(4,"Entry received").replace(/<span class="stepno"[^<]*<\/span>/,"Done").replace(/<div class="prog[^>]*><div class="bar"><\/div><\/div>/,"")}<div class="body"><div class="hero">${ICON_SIGN}<div><h2 style="margin:0 0 4px">Thank you, ${esc(e.rep)}.</h2><div class="note">Your entry is in for review. Reference: <b>${id2}</b></div></div></div>
 <table><tr><th>School</th><td>${esc(e.school)}</td></tr><tr><th>Category</th><td>${esc(e.cat)}</td></tr><tr><th>Entrant</th><td>${esc(e.entrant)}</td></tr><tr><th>Amount</th><td>${e.fee>0?money(cc,e.fee)+" paid (test)":cc==="us"?"$0 – sponsored by the NISMCAA Foundation":"Free"}</td></tr><tr><th>Confirmation email</th><td>${esc(e.email)} (sent from info@nismcaa.com once email is connected)</td></tr><tr><th>Questions</th><td><a href="mailto:info@nismcaa.com">info@nismcaa.com</a> | <a href="tel:+14707390021">(470) 739-0021</a></td></tr></table>
 <p class="note">To enter another category, start a new entry.</p><div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="?c=${cc}">Start another entry</a><button class="btn alt" onclick="print()">Save as PDF</button><a class="btn alt test-only" href="admin.html">Open admin view</a></div></div><div class="ftr"><span>Authorized by NISMCAA Secretariat | <a href="mailto:info@nismcaa.com">info@nismcaa.com</a> | <a href="tel:+14707390021">(470) 739-0021</a></span><span>Done</span></div>`;
 $("done").style.display="flex";scrollTo(0,0)}
$("print").onclick=()=>{logAct("pdf_saved",C.name+" form printed / saved as PDF",cc);print()};
$("sample").onclick=()=>{const v={cat:CATS[cc==="ng"?0:1][1],edition:$("edition").options[1].value,school:S.school,addr:S.addr,city:S.city,region:C.regions[cc==="us"?10:cc==="ng"?24:0],post:C.postHint.replace("e.g. ",""),level:C.levels[cc==="ng"?3:1],sphone:S.phone,ssite:"https://"+S.site,entrant:cc==="ng"?S.school+" Choir":S.student,grade:cc==="ng"?"":"Grade 7",rep:S.rep,enrol:true,song:cc==="ng"?"Rise Up, Naija":"Hometown Lights",theme:"Unity through music",pupils:cc==="ng"?24:"",live:"Singing and instruments – both performed live",mins:6,yt:"https://youtu.be/nismcaaTest1",pg:S.phone,mteacher:S.teacher,orig:"Original song",desc:cc==="ng"?"24 students: 14 singers, 6 drummers, 4 dancers.":"Solo vocal with acoustic guitar, written by the student.",mreq:true,remail:S.email,rphone:S.phone,tname:S.teacher,temail:"teacher@"+S.site,head:cc==="ng"?"Dr. Adebayo Ogunleye":"Dr. Linda Davis",hemail:"principal@"+S.site,d1:true,d2:true,d3:true,d4:true,sig:S.rep};
 for(const k in v){const e=$(k);e.type==="checkbox"?e.checked=v[k]:e.value=v[k]}save();upd();logAct("sample_filled","Sample entry filled ("+C.name+")",cc)};
load();upd();show(0);
const vk="nis_v_"+cc;if(!sessionStorage.getItem(vk)){sessionStorage.setItem(vk,1);logAct("page_view",C.name+" entry form viewed",cc)}
