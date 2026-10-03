const B='http://localhost:3100';
const mk=()=>{let k='';return async(m,u,b,h={})=>{const r=await fetch(B+u,{method:m,headers:{'x-folego':'1',...(b?{'content-type':'application/json'}:{}),...(k?{cookie:k}:{}),...h},body:b?JSON.stringify(b):undefined});const s=r.headers.get('set-cookie');if(s)k=s.split(';')[0];const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return {s:r.status,j,t}}};
const a=mk();
const c=await a('POST','/api/cases',{profile:{employmentType:'clt',ageBand:'35-44',uf:'SP',netIncomeCents:320000,fixedExpensesCents:170000},debts:[{creditorName:'A',kind:'rent',balanceCents:150000,monthlyRateBps:100,daysOverdue:25}],acceptTerms:true});
// pedidos simultâneos com a MESMA chave
const key='race-'+Date.now()+'-xxxxxxxx';
const rs=await Promise.all(Array.from({length:8},()=>a('POST','/api/orders',{caseId:c.j.caseId,products:['recovery_map']},{'idempotency-key':key})));
const ids=new Set(rs.map(r=>r.j?.orderId));
console.log('8 pedidos paralelos, mesma chave -> status',[...new Set(rs.map(r=>r.s))].join(','),'| pedidos distintos:',ids.size);
// pagamentos simultâneos do mesmo pedido
const oid=[...ids][0];
const ps=await Promise.all(Array.from({length:6},()=>a('POST','/api/dev/pay/'+oid,{})));
console.log('6 pagamentos paralelos -> status',ps.map(p=>p.s).join(','));
await new Promise(r=>setTimeout(r,800));
const d=await a('GET','/api/orders/'+oid);
console.log('pedido final',d.s,JSON.stringify(d.j).slice(0,160));
// pedidos paralelos com chaves diferentes para o mesmo caso
const rs2=await Promise.all(Array.from({length:5},(_,i)=>a('POST','/api/orders',{caseId:c.j.caseId,products:['recovery_map']},{'idempotency-key':'diff-'+i+'-'+Date.now()+'xxxx'})));
console.log('5 pedidos com chaves diferentes ->',rs2.map(r=>r.s).join(','),'| distintos:',new Set(rs2.map(r=>r.j?.orderId)).size);
