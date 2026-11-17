/* IQtraining team layer: Supabase login + shared data, used by iqtraining.html and sessione.html */
(function(){
'use strict';
const URL='https://vvqiauehmctktnkppgnc.supabase.co';
const KEY='sb_publishable_VaIbtpmKP-DCsIp9vqmTrw_szjjnpNs';
const IQ=window.IQ={sb:null,user:null,profile:null,role:null,db:null,ok:false};let booted=false;
let resolveReady;IQ.ready=new Promise(r=>resolveReady=r);

function init(){
  if(!window.supabase||!window.supabase.createClient){resolveReady(IQ);return;}
  const sb=IQ.sb=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  sb.auth.getSession().then(async({data})=>{await setUser(data&&data.session&&data.session.user);booted=true;resolveReady(IQ);}).catch(()=>{booted=true;resolveReady(IQ);});
  sb.auth.onAuthStateChange((ev,session)=>{if(!booted)return;const id=session&&session.user&&session.user.id;if((ev==='SIGNED_IN'||ev==='SIGNED_OUT')&&id!==(IQ.user&&IQ.user.id))location.reload();});
}
async function setUser(u){IQ.user=u||null;IQ.profile=null;IQ.role=null;IQ.ok=false;IQ.db=null;if(!u)return;
  let p=null;for(let i=0;i<3&&!p;i++){const {data}=await IQ.sb.from('profiles').select('*').eq('id',u.id).maybeSingle();p=data;if(!p)await new Promise(r=>setTimeout(r,600));}
  IQ.profile=p;IQ.role=p?p.role:null;IQ.ok=!!p&&p.role!=='blocked';if(IQ.ok)IQ.db=makeDb(IQ.sb);}

/* small document store on table "docs" (coll,id,data) with the shape the pages already use */
function makeDb(sb){
  const snapDoc=(id,data)=>({id,exists:data!=null,data:()=>data==null?undefined:data,metadata:{fromCache:false,hasPendingWrites:false}});
  const listeners={};
  function watch(coll,fn){
    if(!listeners[coll]){listeners[coll]=new Set();
      sb.channel('docs-'+coll).on('postgres_changes',{event:'*',schema:'public',table:'docs',filter:'coll=eq.'+coll},()=>{listeners[coll].forEach(f=>f());}).subscribe();}
    listeners[coll].add(fn);return ()=>listeners[coll].delete(fn);}
  function debounce(f,ms){let t=null;return ()=>{clearTimeout(t);t=setTimeout(f,ms);};}
  function D(coll,id){return {id,path:coll+'/'+id,
    async get(){const {data,error}=await sb.from('docs').select('data').eq('coll',coll).eq('id',id).maybeSingle();if(error)throw {code:'unavailable',message:error.message};return snapDoc(id,data?data.data:null);},
    async set(obj){const {error}=await sb.from('docs').upsert({coll,id,data:obj},{onConflict:'coll,id'});if(error)throw {code:/row-level|permission|policy/i.test(error.message)?'invalid_argument':'unavailable',message:error.message};},
    async update(patch){const cur=await this.get();if(!cur.exists)throw {code:'invalid_argument',message:'missing'};await this.set(Object.assign({},cur.data(),patch));},
    async delete(){const {error}=await sb.from('docs').delete().eq('coll',coll).eq('id',id);if(error)throw {code:'invalid_argument',message:error.message};},
    onSnapshot(next,err){const load=async()=>{try{next(await this.get());}catch(e){err&&err(e);}};load();const un=watch(coll,debounce(load,400));const iv=setInterval(load,60000);return ()=>{un();clearInterval(iv);};}};}
  function Q(coll){return {path:coll,orderBy(){return this;},limit(){return this;},where(){return this;},
    doc(id){return D(coll,id||((crypto.randomUUID&&crypto.randomUUID())||(Date.now().toString(36)+Math.random().toString(36).slice(2))));},
    async add(obj){const d=this.doc();await d.set(obj);return d;},
    async get(){const {data,error}=await sb.from('docs').select('id,data').eq('coll',coll);if(error)throw {code:'unavailable',message:error.message};const docs=(data||[]).map(r=>snapDoc(r.id,r.data));return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false}};},
    onSnapshot(next,err){const load=async()=>{try{next(await this.get());}catch(e){err&&err(e);}};load();const un=watch(coll,debounce(load,500));const iv=setInterval(load,60000);return ()=>{un();clearInterval(iv);};}};}
  return {collection:Q,doc(path){const a=path.split('/');return D(a[0],a.slice(1).join('/'));}};
}

IQ.signIn=async(email,password)=>{const {error}=await IQ.sb.auth.signInWithPassword({email,password});if(error)throw error;};
IQ.signUp=async(email,password,name)=>{const {data,error}=await IQ.sb.auth.signUp({email,password,options:{data:{name}}});if(error)throw error;return !!(data&&data.session);};
IQ.signOut=async()=>{await IQ.sb.auth.signOut();location.reload();};
IQ.isStaff=()=>IQ.role==='admin'||IQ.role==='coach';
IQ.profiles=async ids=>{const out={};if(!ids.length)return out;const {data}=await IQ.sb.from('profiles').select('id,name').in('id',ids);(data||[]).forEach(p=>out[p.id]={name:p.name||''});return out;};
IQ.team=async()=>{const {data}=await IQ.sb.from('profiles').select('*').order('created_at');return data||[];};
IQ.setRole=async(id,role)=>{const {error}=await IQ.sb.from('profiles').update({role}).eq('id',id);if(error)throw error;};
IQ.setName=async name=>{const {error}=await IQ.sb.from('profiles').update({name}).eq('id',IQ.user.id);if(error)throw error;};

/* sign-in box: IQ.mountAuth(container, lang) */
IQ.mountAuth=function(el,lang){const it=lang==='it';const T=(en,i)=>it?i:en;
  const css=`.iqa{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.iqa button{font:inherit;cursor:pointer}
.iqa-dlg{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.iqa-box{width:100%;max-width:380px;background:var(--panel,#0E2130);color:var(--fg,#E9F3F9);border:1px solid var(--line,#1F3A4E);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:10px;font-family:inherit}
.iqa-box h3{margin:0;font-size:20px}.iqa-box input{font:inherit;color:inherit;background:var(--bg2,#0A1A26);border:1px solid var(--line,#1F3A4E);border-radius:10px;padding:10px 12px;width:100%;box-sizing:border-box}
.iqa-box .row{display:flex;gap:8px}.iqa-box .row button{flex:1;min-height:44px;border-radius:12px;border:1px solid var(--line,#1F3A4E);background:var(--bg2,#0A1A26);color:inherit}
.iqa-box .row button.p{background:linear-gradient(135deg,#3DD6F5,#7C5CFF);color:#04121B;border:0;font-weight:700}
.iqa-box .m{font-size:13px;min-height:18px;color:var(--warn,#F7B740)}.iqa-box .n{font-size:12px;opacity:.75;line-height:1.4}
.iqa .who{font-size:13px}.iqa .who b{font-weight:700}.iqa .rl{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(61,214,245,.18);color:#3DD6F5}`;
  if(!document.getElementById('iqa-css')){const s=document.createElement('style');s.id='iqa-css';s.textContent=css;document.head.appendChild(s);}
  el.classList.add('iqa');
  if(!IQ.sb){el.innerHTML='';return;}
  if(IQ.user){const nm=(IQ.profile&&IQ.profile.name)||IQ.user.email;
    el.innerHTML=`<span class="who">👤 <b></b></span><span class="rl">${IQ.role||'?'}</span><button class="coachhd" type="button">${T('Sign out','Esci')}</button>`;
    el.querySelector('b').textContent=nm;el.querySelector('button').onclick=()=>IQ.signOut();
    if(IQ.role==='blocked'){const s=document.createElement('span');s.className='who';s.textContent=T('Access blocked by the admin','Accesso bloccato dall’amministratore');el.appendChild(s);}
    return;}
  el.innerHTML=`<button class="coachhd" type="button" style="border-color:#3DD6F5">🔐 ${T('Sign in','Accedi')}</button>`;
  el.querySelector('button').onclick=()=>{
    const d=document.createElement('div');d.className='iqa-dlg';
    d.innerHTML=`<form class="iqa-box"><h3>${T('Sign in to IQtraining','Accedi a IQtraining')}</h3>
      <input type="email" name="e" placeholder="Email" autocomplete="email" required>
      <input type="password" name="p" placeholder="${T('Password (min. 6 characters)','Password (min. 6 caratteri)')}" autocomplete="current-password" minlength="6" required>
      <input type="text" name="n" placeholder="${T('Your name (only for a new account)','Il tuo nome (solo per un account nuovo)')}" autocomplete="name">
      <div class="m"></div>
      <div class="row"><button class="p" type="submit" name="in">${T('Sign in','Accedi')}</button><button type="button" name="up">${T('Create account','Crea account')}</button></div>
      <div class="row"><button type="button" name="x">${T('Cancel','Annulla')}</button></div>
      <div class="n">${T('Your password stays with Supabase, the team’s secure login service. The team admin decides each person’s role.','La password resta su Supabase, il servizio di login del team. L’amministratore decide il ruolo di ciascuno.')}</div></form>`;
    document.body.appendChild(d);const f=d.querySelector('form'),m=d.querySelector('.m');
    const busy=b=>f.querySelectorAll('button').forEach(x=>x.disabled=b);
    f.onsubmit=async ev=>{ev.preventDefault();busy(true);m.textContent='';try{await IQ.signIn(f.e.value.trim(),f.p.value);}catch(e){m.textContent=T('Sign-in failed: ','Accesso non riuscito: ')+(e.message||e);busy(false);}};
    f.querySelector('[name=up]').onclick=async()=>{if(!f.reportValidity())return;busy(true);m.textContent='';
      try{const ok=await IQ.signUp(f.e.value.trim(),f.p.value,f.n.value.trim());if(!ok){m.textContent=T('Account created: confirm it from the email you received, then sign in.','Account creato: confermalo dalla mail che hai ricevuto, poi accedi.');busy(false);}}
      catch(e){m.textContent=T('Could not create the account: ','Account non creato: ')+(e.message||e);busy(false);}};
    f.querySelector('[name=x]').onclick=()=>d.remove();f.e.focus();};
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
