// Liga os 4 guias no servidor LOCAL (para testar a venda): entra como dono e ativa os produtos. Uso: node qa/ativar-guias.mjs
const B = process.env.QA_BASE ?? 'http://localhost:3100';
let ck = '';
const call = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'x-folego': '1', 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) ck = s.split(';')[0]; return r.status; };
console.log('login', await call('POST', '/api/gestao/login-password', { email: 'qa@exemplo.com', password: 'QaLocalAdmin2026x' }));
for (const c of ['guide_financing', 'guide_housebills', 'guide_forgotten', 'guide_resume']) console.log(c, await call('PUT', `/api/gestao/produtos/${c}`, { active: true }));
