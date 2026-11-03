const P=new URLSearchParams(location.search);let cc=COUNTRIES[P.get("c")]?P.get("c"):"us";let step=0,paid=false,started=false;
const csel=document.getElementById("csel");for(const k in COUNTRIES)csel.add(new Option(COUNTRIES[k].name,k));csel.value=cc;
csel.onchange=()=>{location.search="?c="+csel.value};
const C=COUNTRIES[cc];const r=document.documentElement.style;r.setProperty("--c1",C.c1);r.setProperty("--c2",C.c2);r.setProperty("--soft",C.soft);
const S=C.sample;
const ICON_MUSIC=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c1}"/><path d="M26 44a6 6 0 1 1-4-5.6V18l20-5v24a6 6 0 1 1-4-5.6V20l-12 3z" fill="#fff"/></svg>`;
const ICON_ACAD=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c2}"/><path d="M10 27l22-10 22 10-22 10z" fill="#fff"/><path d="M19 32v9c0 4 26 4 26 0v-9l-13 6z" fill="#fff"/><path d="M50 29v12" stroke="#fff" stroke-width="2"/></svg>`;
const ICON_SIGN=`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.c1}"/><rect x="18" y="14" width="28" height="36" rx="3" fill="#fff"/><path d="M23 24h18M23 30h18M23 36h10" stroke="${C.c1}" stroke-width="2"/><path d="M34 44l4 4 8-10" stroke="${C.c2}" stroke-width="3" fill="none"/></svg>`;
const R=`<span style="color:#b42318"> *</span>`;
const opts=a=>`<option value="">Choose one</option>`+a.map(x=>`<option>${esc(x)}</option>`).join("");
const F=(id,lab,req,type="text",ex="")=>`<label class="f">${lab}${req?R:""}<input id="${id}" type="${type}" ${ex}></label>`;
const SEL=(id,lab,arr,req=1)=>`<label class="f">${lab}${req?R:""}<select id="${id}">${opts(arr)}</select></label>`;
const TA=(id,lab,req=1)=>`<label class="f">${lab}${req?R:""}<textarea id="${id}"></textarea></label>`;
const CK=(id,t)=>`<label class="chk"><input type="checkbox" id="${id}"><span>${t}</span></label>`;
const year=new Date().getFullYear();
const head=(n,t)=>`<div class="hdr"><img src="${C.logo}" alt="NISMCAA ${esc(C.name)} logo"><div><h1>NISMCAA</h1><div class="sub">Music Competition &amp; Academic Award</div></div><div class="ctry"><b>${esc(C.name)}</b><br>Official entry form</div></div><div class="ptitle">0${n}&nbsp; ${t}</div>`;
const foot=n=>`<div class="ftr"><span>Authorized by NISMCAA Secretariat | ${esc(C.name)} online entry</span><span>${n} / 4</span></div>`;
const intro=`<div class="kick">Online entry form – complete the blue fields</div><p class="note">Music and academic awards welcome children with special needs. Your progress saves automatically on this device.</p>`;
const feeBox=`<div class="fee"><b>${cc==="ng"?"Commitment fee":"Entry fee"}:</b> ${esc(C.feeText)}</div>`;
const pages=[
`${head(1,"School / Institution &amp; Entrant")}<div class="body">${intro}<div class="err"></div>
${SEL("cat","Entry category – one registration per school, per category, per year",CATS.map(c=>c[1]))}${feeBox}
<div class="row">${F("country","Country",1,"text","readonly value='"+esc(C.name)+"'")}${SEL("edition","Edition / event year",[String(year+1)+" edition",String(year)+" edition"])}</div>
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
${F("song","Song / performance title",1)}${F("theme","Assigned qualifying theme – school group music only",0)}
<div class="row">${F("pupils","Total pupils on stage – group maximum 30",0,"number","min=1")}${SEL("live","Live instruments / vocal performance",["Yes – all live","Vocals live, instruments live"])}</div>
<div id="w30" class="warn" style="display:none">NISMCAA groups may have no more than 30 students on stage in total. Please check your number.</div>
<div class="row">${F("mins","Video duration – maximum 10 minutes",1,"number","min=1 max=10")}${F("yt","YouTube video link (unlisted)",1,"url")}</div>
<div class="row">${F("pg","Parent / guardian phone – individual student",0,"tel")}${F("mteacher","Music / supervising teacher name",1)}</div>
${SEL("orig","Original song or cover song",["Original song","Cover song"])}
${TA("desc","Performance description / group summary (roles and instruments, no children's names)")}
<div class="sec">Category requirements</div>
<p class="note"><b>School group:</b> original student composition, live singing and instrumentation, no copyright songs, loops, prerecorded beats, backing tracks or external performance aids. Maximum 30 pupils in total, including singers, instrumentalists and dancers; maximum 10 minutes.</p>
<p class="note"><b>Individual:</b> originality is encouraged. Cover songs may be performed under the entrant's responsibility for permissions and rights. A qualifying music video is required.</p>
${CK("mreq","I have read the requirements for the selected music category.")}</div>`,
`${head(3,"Academic Awards Only")}<div class="body">${intro}<div class="hero">${ICON_ACAD}<div class="note">The Academic Award is free to enter.</div></div><div class="err"></div>
<div class="sec">Nomination details</div>
${SEL("subj","Best Student subject – student nominations only",["Mathematics","Music","Science & Technology","English"],0)}
<div class="row">${SEL("elevel","Education level",C.levels)}${F("course","Course / program – tertiary nominations",0)}</div>
${F("area","Best Teacher subject / Best School achievement area",0)}${F("atitle","Award title",1)}
${TA("summary","Achievement summary – what, when and nominee contribution")}${TA("evidence","Evidence / verification – list records, projects or endorsements")}
<p class="note">Academic awards have no music theme, song, stage headcount or performance-time requirement. Student nominees complete a subject task after submitting.</p>
${CK("verify","The stated achievements and evidence can be verified by the school / institution.")}</div>`,
`${head(4,"Authorization &amp; Submit")}<div class="body">${intro}<div class="hero">${ICON_SIGN}<div class="note">Review, sign by typing your name, and submit. Questions: <a href="mailto:info@nismcaa.com">info@nismcaa.com</a>. Want lessons for your students? Write to the NISMCAA Academy at <a href="mailto:academy@nismcaa.com">academy@nismcaa.com</a>.</div></div><div class="err"></div>
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
function upd(){$("w30").style.display=(+$("pupils").value>30)?"block":"none";
 const f=fee();$("feeline").innerHTML=f>0?`<div class="fee"><b>Commitment fee due: ${money(cc,f)}</b> (non-refundable). ${paid?"<span class='pill p-app'>Paid (test)</span>":`<button class="btn sm" id="paybtn" type="button">Pay ${money(cc,f)} now</button>`}</div>`:`<div class="fee"><b>Amount due: ${cc==="us"?"$0 – sponsored by the NISMCAA Foundation":(C.sym?C.sym+"0":"$0")+" – free entry"}</b></div>`;
 const pb=$("paybtn");if(pb)pb.onclick=()=>{$("pamt").value=money(cc,f);$("perr").style.display="none";$("paym").style.display="flex"};
 drawSteps()}
const REQ={0:["cat","edition","school","addr","city","region","post","level","sphone","entrant","rep","enrol"],1:["song","live","mins","yt","mteacher","orig","desc","mreq"],2:["elevel","atitle","summary","evidence","verify"],3:["remail","rphone","tname","temail","head","hemail","d1","d2","d3","d4","sig","sdate"]};
function check(i){const bad=[];let req=[...REQ[i]];const id=catId();
 if(i==1&&(id=="grp"||id=="sgrp"))req.push("pupils","theme");if(i==1&&(id=="ind"||id=="sind"))req.push("pg");if(i==2&&(id=="bs"||id=="sacad"))req.push("subj");if(i==2&&(id=="bt"||id=="bsc"))req.push("area");
 req.forEach(k=>{const e=$(k);const ok=e.type==="checkbox"?e.checked:e.value.trim()&&e.checkValidity();if(!ok){bad.push(k);e.classList.add("bad")}});
 if(i==1&&$("yt").value&&!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test($("yt").value)){bad.push("yt");$("yt").classList.add("bad")}
 const er=$("pg"+i).querySelector(".err");let msg=bad.length?"Please complete the fields marked in red ("+bad.length+").":"";
 if(i==3&&!bad.length&&fee()>0&&!paid)msg="Please pay the commitment fee before submitting.";
 er.textContent=msg;er.style.display=msg?"block":"none";return !msg}
function drawSteps(){const names=["School & entrant",kind()==="acad"?"Academic award":"Music entry","Authorize & submit"];const f=flow();
 $("steps").innerHTML=f.map((p,i)=>`<button class="${p===step?"on":""} ${f.indexOf(step)>i?"done":""}" data-go="${p}">${i+1}. ${names[i]}</button>`).join("")}
function show(i){step=i;document.querySelectorAll(".pg").forEach((e,k)=>e.style.display=k===i?"flex":"none");$("done").style.display="none";drawSteps();scrollTo(0,0)}
$("steps").onclick=e=>{const g=e.target.dataset.go;if(g===undefined)return;const f=flow(),t=+g;if(f.indexOf(t)>f.indexOf(step)){for(const p of f){if(p===t)break;if(!check(p)){show(p);return}}}show(t)};
pg.addEventListener("click",e=>{const f=flow(),pos=f.indexOf(step);
 if(e.target.hasAttribute("data-next")){if(!kind()){check(0);return}if(!check(step))return;if(step===3)return submit();show(f[pos+1])}
 if(e.target.hasAttribute("data-prev")){if(pos>0)show(f[pos-1]);else if(confirm("Clear everything on this form?")){localStorage.removeItem(DRAFT);location.reload()}}});
$("pcancel").onclick=()=>$("paym").style.display="none";
$("pgo").onclick=()=>{const n=$("pcard").value.replace(/\s/g,"");if(n!=="4242424242424242"||!/^\d\d\/\d\d$/.test($("pexp").value)||!/^\d{3,4}$/.test($("pcvc").value)){$("perr").textContent="Card declined. In test mode, use 4242 4242 4242 4242.";$("perr").style.display="block";return}
 paid=true;$("paym").style.display="none";logAct("payment",`Commitment fee ${money(cc,fee())} paid (test) – ${$("school").value}`,cc);upd();check(3)};
function submit(){const id="NIS-"+cc.toUpperCase()+"-"+String(Date.now()).slice(-6);const d=LS.get(DRAFT,{});
 const e={id,country:cc,cat:$("cat").value,school:$("school").value,entrant:$("entrant").value,city:$("city").value,region:$("region").value,rep:$("rep").value,email:$("remail").value,fee:fee(),paid:fee()>0?paid:null,status:"Submitted",t:new Date().toISOString(),data:d};
 const all=LS.get("nis_entries",[]);all.unshift(e);LS.set("nis_entries",all);logAct("form_submitted",`${id} submitted – ${e.school} (${e.cat})`,cc);localStorage.removeItem(DRAFT);
 document.querySelectorAll(".pg").forEach(x=>x.style.display="none");$("steps").innerHTML="";
 $("done").innerHTML=`${head(4,"Entry received")}<div class="body"><div class="hero">${ICON_SIGN}<div><h2 style="margin:0 0 4px">Thank you, ${esc(e.rep)}.</h2><div class="note">Your entry is in for review. Reference: <b>${id}</b></div></div></div>
 <table><tr><th>School</th><td>${esc(e.school)}</td></tr><tr><th>Category</th><td>${esc(e.cat)}</td></tr><tr><th>Entrant</th><td>${esc(e.entrant)}</td></tr><tr><th>Amount</th><td>${e.fee>0?money(cc,e.fee)+" paid (test)":cc==="us"?"$0 – sponsored by the NISMCAA Foundation":"Free"}</td></tr><tr><th>Confirmation email</th><td>${esc(e.email)} (sent from info@nismcaa.com once email is connected)</td></tr></table>
 <p class="note">To enter another category, start a new entry.</p><div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="?c=${cc}">Start another entry</a><button class="btn alt" onclick="print()">Save as PDF</button><a class="btn alt" href="admin.html">Open admin view</a></div></div>${foot(4)}`;
 $("done").style.display="flex";scrollTo(0,0)}
$("print").onclick=()=>{logAct("pdf_saved",C.name+" form printed / saved as PDF",cc);print()};
$("sample").onclick=()=>{const v={cat:CATS[cc==="ng"?0:1][1],edition:$("edition").options[1].value,school:S.school,addr:S.addr,city:S.city,region:C.regions[cc==="us"?10:cc==="ng"?24:0],post:C.postHint.replace("e.g. ",""),level:C.levels[cc==="ng"?3:1],sphone:S.phone,ssite:"https://"+S.site,entrant:cc==="ng"?S.school+" Choir":S.student,grade:cc==="ng"?"":"Grade 7",rep:S.rep,enrol:true,song:cc==="ng"?"Rise Up, Naija":"Hometown Lights",theme:"Unity through music",pupils:cc==="ng"?24:"",live:"Yes – all live",mins:6,yt:"https://youtu.be/nismcaaTest1",pg:S.phone,mteacher:S.teacher,orig:"Original song",desc:cc==="ng"?"24 students: 14 singers, 6 drummers, 4 dancers.":"Solo vocal with acoustic guitar, written by the student.",mreq:true,remail:S.email,rphone:S.phone,tname:S.teacher,temail:"teacher@"+S.site,head:cc==="ng"?"Dr. Adebayo Ogunleye":"Dr. Linda Davis",hemail:"principal@"+S.site,d1:true,d2:true,d3:true,d4:true,sig:S.rep};
 for(const k in v){const e=$(k);e.type==="checkbox"?e.checked=v[k]:e.value=v[k]}save();upd();logAct("sample_filled","Sample entry filled ("+C.name+")",cc)};
load();upd();show(0);
const vk="nis_v_"+cc;if(!sessionStorage.getItem(vk)){sessionStorage.setItem(vk,1);logAct("page_view",C.name+" entry form viewed",cc)}
