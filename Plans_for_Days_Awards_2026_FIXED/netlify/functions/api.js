const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (status, body) => ({ statusCode: status, headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"}, body: JSON.stringify(body) });
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
const tokenSecret = () => process.env.ADMIN_TOKEN_SECRET || "change-this-secret";

function adminTokenValid(t){ if(!t) return false; try{const [p,h]=t.split(".");return crypto.timingSafeEqual(Buffer.from(h),Buffer.from(hash(p+"."+tokenSecret())) ) && JSON.parse(Buffer.from(p,"base64url").toString()).exp>Date.now()}catch(e){return false}}
function makeToken(){const p=Buffer.from(JSON.stringify({exp:Date.now()+1000*60*60*6})).toString("base64url");return p+"."+hash(p+"."+tokenSecret())}

async function event(){
 const {data:settings,error}=await db.from("event_settings").select("*").eq("id",1).single(); if(error)throw error;
 const {data:people}=await db.from("people").select("*").order("created_at");
 const {data:awards}=await db.from("awards").select("*").order("sort_order");
 const {data:voters}=await db.from("voters").select("person_id,submitted");
 const now=Date.now(), open=settings.opening_at?new Date(settings.opening_at).getTime():0, close=settings.closing_at?new Date(settings.closing_at).getTime():0;
 return {event_name:settings.event_name,opening_at:settings.opening_at,closing_at:settings.closing_at,closed:!!close&&now>=close,not_open:!!open&&now<open,people:people.map(p=>({...p,voted:!!voters?.find(v=>v.person_id===p.id)?.submitted})),awards,voted_count:voters?.filter(v=>v.submitted).length||0};
}
exports.handler=async e=>{
 try{
  const path=e.path.split("/").pop(), b=e.body?JSON.parse(e.body):{};
  if(path==="event")return json(200,await event());
  if(path==="voter"){
   const p=(await db.from("people").select("*").eq("name",b.name).single()).data;if(!p)return json(404,{error:"Person not found"});
   const v=(await db.from("voters").select("*").eq("person_id",p.id).maybeSingle()).data;
   if(b.create){if(v)return json(409,{error:"Already created"});await db.from("voters").insert({person_id:p.id,password_hash:hash(b.password)});return json(200,{ok:true})}
   if(b.login){if(!v||v.password_hash!==hash(b.password))return json(401,{error:"Incorrect password"});const vs=(await db.from("votes").select("award_id,answer").eq("voter_id",v.id)).data||{};return json(200,{answers:Object.fromEntries(vs.map(x=>[x.award_id,x.answer]))})}
   return json(200,{exists:!!v});
  }
  if(path==="questions"){
   const {data:settings}=await db.from("event_settings").select("*").eq("id",1).single(); if(settings.closing_at&&Date.now()>=new Date(settings.closing_at).getTime())return json(403,{error:"Voting is closed"});
   const p=(await db.from("people").select("id").eq("name",b.voter).single()).data;const v=(await db.from("voters").select("id,password_hash").eq("person_id",p.id).single()).data;if(!v||v.password_hash!==hash(b.password))return json(401,{error:"Incorrect password"});
   const qs=(await db.from("awards").select("*").order("sort_order")).data;const vs=(await db.from("votes").select("award_id,answer").eq("voter_id",v.id)).data||[];
   return json(200,{questions:qs,answers:Object.fromEntries(vs.map(x=>[x.award_id,x.answer]))});
  }
  if(path==="save"){
   const {data:settings}=await db.from("event_settings").select("*").eq("id",1).single();if(settings.closing_at&&Date.now()>=new Date(settings.closing_at).getTime())return json(403,{error:"Voting is closed"});
   const p=(await db.from("people").select("id").eq("name",b.voter).single()).data;const v=(await db.from("voters").select("id,password_hash").eq("person_id",p.id).single()).data;if(!v||v.password_hash!==hash(b.password))return json(401,{error:"Incorrect password"});
   for(const [award_id,answer] of Object.entries(b.answers||{})){if(!answer)continue;await db.from("votes").upsert({voter_id:v.id,award_id,answer,updated_at:new Date().toISOString()},{onConflict:"voter_id,award_id"})}
   await db.from("voters").update({submitted:!!b.submitted,updated_at:new Date().toISOString()}).eq("id",v.id);return json(200,{ok:true});
  }
  if(path==="admin"){const s=(await db.from("event_settings").select("admin_password_hash").eq("id",1).single()).data;if(!s||s.admin_password_hash!==hash(b.password))return json(401,{error:"Incorrect admin password"});return json(200,{token:makeToken()})}
  if(path==="admin-data"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});return json(200,{event:await event()})}
  if(path==="admin-save"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});let upd={};if(b.event_name!==undefined)upd.event_name=b.event_name;if(b.opening_at!==undefined)upd.opening_at=b.opening_at;if(b.closing_at!==undefined)upd.closing_at=b.closing_at;if(b.close_now)upd.closing_at=new Date(Date.now()-1000).toISOString();await db.from("event_settings").update(upd).eq("id",1);return json(200,{ok:true})}
  if(path==="award-add"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});const n=(await db.from("awards").select("sort_order").order("sort_order",{ascending:false}).limit(1)).data?.[0]?.sort_order||0;await db.from("awards").insert({sort_order:n+1,category:b.category,title:b.title,type:b.type});return json(200,{ok:true})}
  if(path==="award-delete"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});await db.from("awards").delete().eq("id",b.id);return json(200,{ok:true})}
  if(path==="person-photo"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});await db.from("people").update({photo:b.photo}).eq("name",b.name);return json(200,{ok:true})}
  if(path==="results"){if(!adminTokenValid(b.token))return json(401,{error:"Admin session expired"});const s=(await db.from("event_settings").select("closing_at").eq("id",1).single()).data;if(!s.closing_at||Date.now()<new Date(s.closing_at).getTime())return json(403,{error:"Close voting before viewing results"});const awards=(await db.from("awards").select("*").order("sort_order")).data;const people=(await db.from("people").select("*")).data;const votes=(await db.from("votes").select("award_id,answer")).data||[];const out=awards.map(a=>{const m={};votes.filter(v=>v.award_id===a.id).forEach(v=>m[v.answer]=(m[v.answer]||0)+1);let arr=Object.entries(m).filter(x=>x[1]>0).sort((x,y)=>y[1]-x[1]).slice(0,3);return {category:a.category,title:a.title,type:a.type,nominees:arr.map(([name,n])=>{let p=people.find(x=>x.name===name);return {name, votes:n,color:p?.color||"#fff",photo:p?.photo||""}})}});return json(200,{results:out})}
  return json(404,{error:"Not found"});
 }catch(err){console.error(err);return json(500,{error:err.message||"Server error"})}
};