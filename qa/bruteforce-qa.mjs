import fs from 'node:fs';
const B='http://localhost:3100',LOG=process.env.QA_LOG;
const post=async(u,b)=>{const r=await fetch(B+u,{method:'POST',headers:{'x-folego':'1','content-type':'application/json'},body:JSON.stringify(b)});return {s:r.status,t:await r.text()}};
const em='brute'+Date.now()+'@exemplo.com';
await post('/api/account/login-code',{email:em});await new Promise(r=>setTimeout(r,500));
const code=[...fs.readFileSync(LOG,'utf8').matchAll(/\b(\d{6})\b/g)].at(-1)[1];
const wrong=code==='000001'?'000002':'000001';
const codes=[];
for(let i=0;i<12;i++){const r=await post('/api/account/login',{email:em,code:String(100000+i)});codes.push(r.s);}
console.log('12 tentativas erradas ->',codes.join(','));
const ok=await post('/api/account/login',{email:em,code});
console.log('código CERTO depois das erradas ->',ok.s,ok.t.slice(0,80));
// pedidos de código repetidos
const r=[];for(let i=0;i<5;i++){r.push((await post('/api/account/login-code',{email:'grief'+Date.now()+'@exemplo.com'})).s);}
console.log('5 pedidos para e-mails distintos ->',r.join(','));
const e2='victim'+Date.now()+'@exemplo.com';const s=[];for(let i=0;i<5;i++){s.push((await post('/api/account/login-code',{email:e2})).s);}
console.log('5 pedidos para o MESMO e-mail ->',s.join(','));
