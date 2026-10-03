import fs from 'node:fs';
const B='http://localhost:3100',LOG=process.env.QA_LOG;
const post=async(u,b)=>{const r=await fetch(B+u,{method:'POST',headers:{'x-folego':'1','content-type':'application/json'},body:JSON.stringify(b)});return r.status};
console.log(await post('/api/gestao/setup-code',{email:'qa@exemplo.com'}));
await new Promise(r=>setTimeout(r,600));
const all=[...fs.readFileSync(LOG,'utf8').matchAll(/\b(\d{6})\b/g)];
console.log(await post('/api/gestao/setup',{email:'qa@exemplo.com',code:all.at(-1)[1],password:'QaLocalAdmin2026x'}));
