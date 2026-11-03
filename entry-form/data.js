const COUNTRIES={
 us:{name:"United States",logo:"img/us.png",c1:"#0b2a5b",c2:"#b31942",soft:"#eef3fb",cur:"USD",
  regionLabel:"State",postLabel:"ZIP code",postHint:"e.g. 30303",
  levels:["Elementary School","Middle School","High School","More than one level","College / university (academic awards only)"],
  regions:["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"],
  feeGroup:0,feeInd:0,feeText:"Entry fee sponsored by the NISMCAA Foundation. There is nothing to pay for the Music Competition or the Academic Award.",
  sample:{school:"Lincoln Middle School",addr:"1200 Peachtree St NE",city:"Atlanta",student:"Emily Johnson",teacher:"Michael Brown",rep:"Sarah Williams",phone:"(404) 555-0142",email:"swilliams@lincolnms.org",site:"lincolnms.org"},
  idField:"NCES school ID (optional)",
  terms:["Entry is sponsored by the NISMCAA Foundation, so US schools pay no entry fee.","Schools register online only, through this form.","Typed signatures are accepted as the school's electronic agreement."]},
 ng:{name:"Nigeria",logo:"img/ng.png",c1:"#006b3f",c2:"#0a8f55",soft:"#eaf6ef",cur:"NGN",sym:"₦",
  regionLabel:"State",postLabel:"Local government area",postHint:"e.g. Ikeja",
  levels:["Primary","Junior Secondary (JSS)","Senior Secondary (SSS)","Primary and Secondary","Tertiary (academic awards only)"],
  regions:["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"],
  feeGroup:50000,feeInd:10000,feeText:"Music Competition commitment fee: school group music ₦50,000; individual student music ₦10,000. Academic Award nominations are free (₦0). Fees are non-refundable. They cover entry processing and confirm your school's commitment to attend on event day.",
  sample:{school:"Kings College Lagos",addr:"1 Catholic Mission Street",city:"Lagos Island",student:"Chidinma Okafor",teacher:"Tunde Adeyemi",rep:"Ngozi Eze",phone:"0803 555 0142",email:"ngozi.eze@kingscollege.ng",site:"kingscollege.ng"},
  idField:"",
  terms:["The Music Competition commitment fee is paid online before the entry is reviewed.","Commitment fees are non-refundable.","Academic Award nominations are free.","Schools register online only, through this form."]},
 ca:{name:"Canada",logo:"img/ca.png",c1:"#8b0f14",c2:"#d52b1e",soft:"#fbefef",cur:"CAD",regionLabel:"Province / territory",postLabel:"Postal code",postHint:"e.g. M5V 2T6",
  levels:["Elementary School","Middle School","High School","More than one level","College / university (academic awards only)"],
  regions:["Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador","Nova Scotia","Ontario","Prince Edward Island","Quebec","Saskatchewan","Northwest Territories","Nunavut","Yukon"],
  feeGroup:0,feeInd:0,feeText:"Entry to the Music Competition and the Academic Award is free.",
  sample:{school:"Maple Grove Middle School",addr:"200 King St W",city:"Toronto",student:"Emily Johnson",teacher:"Michael Brown",rep:"Sarah Williams",phone:"(416) 555-0142",email:"swilliams@maplegrove.ca",site:"maplegrove.ca"},idField:"",
  terms:["Entry is free.","Schools register online only, through this form."]},
 uk:{name:"United Kingdom",logo:"img/uk.png",c1:"#012169",c2:"#c8102e",soft:"#eef1f9",cur:"GBP",regionLabel:"Nation / county",postLabel:"Postcode",postHint:"e.g. SW1A 1AA",
  levels:["Primary","Secondary","Sixth form","More than one level","University (academic awards only)"],
  regions:["England","Scotland","Wales","Northern Ireland"],
  feeGroup:0,feeInd:0,feeText:"Entry to the Music Competition and the Academic Award is free.",
  sample:{school:"Riverside Academy",addr:"10 High Street",city:"London",student:"Emily Johnson",teacher:"Michael Brown",rep:"Sarah Williams",phone:"020 7946 0142",email:"swilliams@riverside.sch.uk",site:"riverside.sch.uk"},idField:"",
  terms:["Entry is free.","Schools register online only, through this form."]},
 ae:{name:"United Arab Emirates",logo:"img/ae.png",c1:"#00732f",c2:"#b8860b",soft:"#f3f7ee",cur:"AED",regionLabel:"Emirate",postLabel:"Area",postHint:"e.g. Al Barsha",
  levels:["Primary","Middle","Secondary","More than one level","University (academic awards only)"],
  regions:["Abu Dhabi","Dubai","Sharjah","Ajman","Umm Al Quwain","Ras Al Khaimah","Fujairah"],
  feeGroup:0,feeInd:0,feeText:"Entry to the Music Competition and the Academic Award is free.",
  sample:{school:"Gulf International School",addr:"Street 12",city:"Dubai",student:"Emily Johnson",teacher:"Michael Brown",rep:"Sarah Williams",phone:"+971 4 555 0142",email:"swilliams@gulfintl.ae",site:"gulfintl.ae"},idField:"",
  terms:["Entry is free.","Schools register online only, through this form."]},
 gh:{name:"Ghana",logo:"img/gh.png",c1:"#7a5a00",c2:"#ce1126",soft:"#fdf7e6",cur:"GHS",regionLabel:"Region",postLabel:"District",postHint:"e.g. Accra Metro",
  levels:["Primary","Junior High (JHS)","Senior High (SHS)","More than one level","Tertiary (academic awards only)"],
  regions:["Greater Accra","Ashanti","Central","Eastern","Western","Volta","Northern","Upper East","Upper West","Bono","Ahafo","Bono East","Oti","Savannah","North East","Western North"],
  feeGroup:0,feeInd:0,feeText:"Entry to the Music Competition and the Academic Award is free.",
  sample:{school:"Accra Academy",addr:"Bubuashie Road",city:"Accra",student:"Emily Johnson",teacher:"Michael Brown",rep:"Sarah Williams",phone:"030 255 0142",email:"swilliams@accraacademy.edu.gh",site:"accraacademy.edu.gh"},idField:"",
  terms:["Entry is free.","Schools register online only, through this form."]}
};
const CATS=[["grp","School group music","music"],["ind","Individual student music","music"],["bs","Academic award: Best Student","acad"],["bt","Academic award: Best Teacher / Lecturer","acad"],["bsc","Academic award: Best School / Institution","acad"],["sgrp","Special needs: School group music","music"],["sind","Special needs: Individual student music","music"],["sacad","Special needs: Academic student award","acad"]];
function feeFor(c,cat){const C=COUNTRIES[c];if(cat==="grp"||cat==="sgrp")return C.feeGroup;if(cat==="ind"||cat==="sind")return C.feeInd;return 0}
function money(c,n){const C=COUNTRIES[c];return C.sym?C.sym+n.toLocaleString("en-US"):"$"+n}
const LS={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set(k,v){localStorage.setItem(k,JSON.stringify(v))}};
// Launch switch: set TEST_MODE=false to remove the TEST tag, "Fill sample entry" and other test-only items.
const TEST_MODE=true;
const API=new URLSearchParams(location.search).get("api")||"https://nismcaa-payments.onrender.com";
function logAct(type,detail,country){try{fetch(API+"/entry/api/act",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,detail,country:country||""}),keepalive:true}).catch(()=>{})}catch(e){}}
if(!TEST_MODE)document.addEventListener("DOMContentLoaded",()=>document.querySelectorAll(".test-only").forEach(e=>e.remove()));
function esc(s){return String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
