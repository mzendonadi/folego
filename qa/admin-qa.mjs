// QA do backoffice (/api/gestao) contra servidor local. Cria o dono (ADMIN_EMAILS=qa@exemplo.com), entra com senha+código,
// percorre todas as rotas GET, confere permissões por papel e valida entradas. Senhas aqui são só de teste local.
import fs from 'node:fs';
const BASE = process.env.QA_BASE ?? 'http://localhost:3100';
const LOG = process.env.QA_LOG ?? '/tmp/qa-server.log';
const P = '/api/gestao';
const results = [];
const rec = (area, nome, ok, detalhe = '') => {
  results.push({ area, nome, ok, detalhe: String(detalhe).slice(0, 400) });
  console.log(`${ok === 'info' ? 'INFO' : ok ? 'PASS' : 'FAIL'} [${area}] ${nome}${ok !== true && detalhe ? ' :: ' + String(detalhe).slice(0, 220) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* texto */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return call;
}
const lastCode = () => {
  const all = [...fs.readFileSync(LOG, 'utf8').matchAll(/\b(\d{6})\b/g)];
  return all.length ? all.at(-1)[1] : null;
};
const PW = 'QaLocal' + Math.floor(Math.random() * 1e6) + 'xyz';

// 1. sem login, todas as rotas bloqueadas
const GETS = ['/dashboard', '/jornada/resumo', '/clientes/avulsos', '/assinaturas', '/assinaturas/resumo', '/assinaturas/cancelados', '/ebooks', '/saude', '/mercado', '/indicacoes', '/parcerias', '/parcerias/contatos', '/produtos', '/config', '/usuarios', '/auditoria', '/marketing/insights', '/marketing/emails', '/marketing/planos', '/me'];
{
  const c = client();
  for (const g of GETS) {
    const r = await c('GET', P + g);
    rec('seguranca', `GET ${g} sem login = 401`, r.status === 401, r.status);
  }
  for (const [m, p] of [['POST', '/mercado/atualizar'], ['POST', '/usuarios'], ['PUT', '/config'], ['POST', '/marketing/emails']]) {
    const r = await c(m, P + p, {});
    rec('seguranca', `${m} ${p} sem login = 401`, r.status === 401, r.status);
  }
}

// 2. primeiro acesso do dono + login em duas etapas
const owner = client();
const OWNER = 'qa@exemplo.com';
{
  const bad = await owner('POST', P + '/login-password', { email: OWNER, password: 'qualquer' });
  rec('seguranca', 'login com conta sem senha definida é recusado (mensagem genérica)', bad.status === 401 || bad.status === 400 || bad.status === 403, bad.status + ' ' + bad.text.slice(0, 100));
  const sc = await owner('POST', P + '/setup-code', { email: OWNER });
  rec('admin', 'pede código de primeiro acesso', sc.status < 300, sc.status + ' ' + sc.text.slice(0, 100));
  await sleep(500);
  const code = lastCode();
  const weak = await owner('POST', P + '/setup', { email: OWNER, code, password: 'curta1' });
  rec('seguranca', 'senha curta recusada no cadastro', weak.status >= 400 && weak.status < 500, weak.status + ' ' + weak.text.slice(0, 100));
  const weak2 = await owner('POST', P + '/setup', { email: OWNER, code, password: 'somenteletrasaqui' });
  rec('seguranca', 'senha sem número recusada', weak2.status >= 400 && weak2.status < 500, weak2.status);
  const weak3 = await owner('POST', P + '/setup', { email: OWNER, code, password: '123456789012' });
  rec('seguranca', 'senha comum recusada', weak3.status >= 400 && weak3.status < 500, weak3.status);
  const wrongCode = await owner('POST', P + '/setup', { email: OWNER, code: '000000', password: PW });
  rec('seguranca', 'setup com código errado recusado', wrongCode.status >= 400 && wrongCode.status < 500, wrongCode.status);
  const ok = await owner('POST', P + '/setup', { email: OWNER, code: lastCode(), password: PW });
  rec('admin', 'define a senha do dono', ok.status < 300, ok.status + ' ' + ok.text.slice(0, 100));
  const pl = await owner('POST', P + '/login-password', { email: OWNER, password: PW });
  rec('admin', 'login com e-mail e senha ok', pl.status < 300, pl.status + ' ' + pl.text.slice(0, 160));
  // D-070: o login é só e-mail + senha (o código vale no primeiro acesso e na redefinição)
  const me = await owner('GET', P + '/me');
  rec('admin', '/me traz usuário e seções', me.status === 200 && Array.isArray(me.json?.sections), me.text.slice(0, 160));
  const wrongPw = await client()('POST', P + '/login-password', { email: OWNER, password: 'errada-errada-1' });
  rec('seguranca', 'senha errada = 401 genérico', wrongPw.status === 401, wrongPw.status);
  // bloqueio por tentativas
  const brute = client();
  let locked = false;
  for (let i = 0; i < 7; i++) {
    const r = await brute('POST', P + '/login-password', { email: OWNER, password: 'errada-' + i + 'aaaaaa' });
    if (r.status === 429 || /bloque/i.test(r.text) && i >= 5) locked = true;
  }
  const right = await brute('POST', P + '/login-password', { email: OWNER, password: PW });
  rec('seguranca', 'depois de várias tentativas erradas a senha CERTA também é barrada (bloqueio de 15 min)', right.status !== 200 && right.status !== 204 || locked, `status senha certa após brute: ${right.status}`);
}

// 3. todas as rotas GET como dono
// (o bloqueio acima pode ter travado a conta; se travou, destrava pelo banco não é possível aqui — a sessão `owner` já está logada)
const saved = {};
for (const g of GETS) {
  const r = await owner('GET', P + g);
  rec('admin', `GET ${g} como dono = 200`, r.status === 200, r.status + ' ' + r.text.slice(0, 120));
  if (r.status === 200) saved[g] = r.json;
}
for (const d of [1, 7, 30, 365, 3650]) {
  const r = await owner('GET', P + '/dashboard?dias=' + d);
  rec('admin', `dashboard ?dias=${d}`, r.status === 200, r.status);
}
for (const d of ['0', '-5', 'abc', '99999999', '1; DROP TABLE app.cases']) {
  const r = await owner('GET', P + '/dashboard?dias=' + encodeURIComponent(d));
  rec('validacao', `dashboard ?dias=${d} não gera 5xx`, r.status < 500, r.status);
}
for (const p of ['/clientes/avulsos?pagina=-1', '/clientes/avulsos?pagina=abc', '/assinaturas?pagina=999999', '/clientes/avulsos?busca=' + encodeURIComponent("' OR 1=1 --"), '/assinaturas?busca=%25', '/clientes/avulsos/nao-uuid', '/assinaturas/nao-uuid', '/jornada/caso/nao-uuid']) {
  const r = await owner('GET', P + p);
  rec('validacao', `GET ${p} não gera 5xx`, r.status < 500, r.status + ' ' + r.text.slice(0, 100));
}
const saude = saved['/saude'];
rec('admin', 'saúde: todos os checks ok', saude?.ok === true, JSON.stringify(saude?.checks ?? {}).slice(0, 300));

// 4. configurações, produtos, preço
{
  const cfg = saved['/config'];
  rec('admin', 'config lista chaves', Boolean(cfg), JSON.stringify(cfg).slice(0, 200));
  const put = await owner('PUT', P + '/config', { ...(cfg?.config ?? cfg ?? {}) });
  rec('admin', 'PUT config com o mesmo conteúdo não quebra', put.status < 500, put.status + ' ' + put.text.slice(0, 160));
  const putBad = await owner('PUT', P + '/config', { aiMaxCallsPerDay: -1, aiModel: '' });
  rec('validacao', 'PUT config inválido = 4xx', putBad.status >= 400 && putBad.status < 500, putBad.status + ' ' + putBad.text.slice(0, 100));
  const prods = saved['/produtos'];
  const list = prods?.products ?? prods ?? [];
  rec('admin', 'produtos listados', Array.isArray(list) && list.length >= 3, JSON.stringify(list).slice(0, 150));
  const p0 = list[0];
  if (p0) {
    const neg = await owner('PUT', `${P}/produtos/${p0.code}`, { priceCents: -100 });
    rec('validacao', 'preço negativo recusado', neg.status >= 400 && neg.status < 500, neg.status + ' ' + neg.text.slice(0, 100));
    const huge = await owner('PUT', `${P}/produtos/${p0.code}`, { priceCents: 99999999999 });
    rec('validacao', 'preço absurdo recusado', huge.status >= 400 && huge.status < 500, huge.status);
    const nf = await owner('PUT', `${P}/produtos/inexistente`, { priceCents: 1000 });
    rec('validacao', 'produto inexistente = 404', nf.status === 404 || nf.status === 400, nf.status);
  }
}

// 5. usuários e permissões por papel
const limited = client();
{
  const LU = `suporte${Date.now()}@exemplo.com`;
  const cr = await owner('POST', P + '/usuarios', { email: LU, name: 'Suporte QA', role: 'suporte' });
  rec('admin', 'dono cria usuário Suporte', cr.status === 201, cr.status + ' ' + cr.text.slice(0, 100));
  const dup = await owner('POST', P + '/usuarios', { email: LU, name: 'Dup', role: 'suporte' });
  rec('validacao', 'e-mail duplicado de usuário = 4xx', dup.status >= 400 && dup.status < 500, dup.status);
  const badRole = await owner('POST', P + '/usuarios', { email: 'x' + LU, role: 'deus' });
  rec('validacao', 'papel inexistente recusado', badRole.status >= 400 && badRole.status < 500, badRole.status);
  const badPerm = await owner('POST', P + '/usuarios', { email: 'y' + LU, role: 'suporte', permissions: ['hackear'] });
  rec('validacao', 'permissão inexistente recusada (ou ignorada sem 5xx)', badPerm.status < 500, badPerm.status);
  await limited('POST', P + '/setup-code', { email: LU });
  await sleep(500);
  const PW2 = 'QaSuporte' + Math.floor(Math.random() * 1e6) + 'abc';
  const st = await limited('POST', P + '/setup', { email: LU, code: lastCode(), password: PW2 });
  rec('admin', 'usuário Suporte define senha', st.status < 300, st.status + ' ' + st.text.slice(0, 100));
  const lg = await limited('POST', P + '/login-password', { email: LU, password: PW2 });
  rec('admin', 'usuário Suporte entra', lg.status < 300, lg.status + ' ' + lg.text.slice(0, 100));
  const allowed = ['/clientes/avulsos', '/assinaturas', '/jornada/resumo'];
  const denied = ['/dashboard', '/config', '/usuarios', '/produtos', '/auditoria', '/marketing/emails', '/marketing/planos', '/ebooks', '/mercado', '/saude', '/parcerias'];
  for (const a of allowed) {
    const r = await limited('GET', P + a);
    rec('permissao', `Suporte acessa ${a}`, r.status === 200, r.status);
  }
  for (const d of denied) {
    const r = await limited('GET', P + d);
    rec('permissao', `Suporte NÃO acessa ${d} (403)`, r.status === 403, r.status + ' ' + r.text.slice(0, 80));
  }
  for (const [m, p, b] of [['POST', '/usuarios', { email: 'z@exemplo.com', role: 'owner' }], ['PUT', '/config', {}], ['POST', '/mercado/atualizar', {}], ['POST', '/marketing/emails', {}]]) {
    const r = await limited(m, P + p, b);
    rec('permissao', `Suporte NÃO executa ${m} ${p}`, r.status === 403, r.status);
  }
  // escalonamento de privilégio: o suporte tenta virar dono
  const users = (await owner('GET', P + '/usuarios')).json?.users ?? [];
  const me = users.find((u) => u.email === LU);
  if (me) {
    const esc = await limited('PUT', `${P}/usuarios/${me.id}`, { role: 'owner' });
    rec('seguranca', 'escalonamento: Suporte não promove a si mesmo a dono', esc.status === 403, esc.status);
    const dis = await owner('PUT', `${P}/usuarios/${me.id}`, { active: false });
    rec('admin', 'dono desativa usuário', dis.status < 300, dis.status);
    const after = await limited('GET', P + '/clientes/avulsos');
    rec('seguranca', 'usuário desativado perde acesso na hora', after.status === 401 || after.status === 403, after.status);
  }
  const meOwner = users.find((u) => u.email === OWNER);
  if (meOwner) {
    const self = await owner('PUT', `${P}/usuarios/${meOwner.id}`, { active: false });
    rec('seguranca', 'dono não consegue desativar a si mesmo (ficaria sem dono)', self.status >= 400 && self.status < 500, self.status);
    const demote = await owner('PUT', `${P}/usuarios/${meOwner.id}`, { role: 'suporte' });
    rec('seguranca', 'dono único não pode se rebaixar', demote.status >= 400 && demote.status < 500, demote.status);
  }
}

// 6. mercado, ebooks, marketing
{
  const r = await owner('POST', P + '/mercado/atualizar', {});
  rec('integracao', 'atualizar indicadores (BCB/IBGE/etc.) não gera 5xx', r.status < 500, r.status + ' ' + r.text.slice(0, 200));
  const m = await owner('GET', P + '/mercado');
  rec('integracao', 'mercado traz Selic/IPCA após atualizar', m.status === 200 && /selic/i.test(m.text), m.text.slice(0, 200));
  const eb = saved['/ebooks'];
  rec('admin', 'repositório de eBooks tem um ativo', JSON.stringify(eb).length > 10, JSON.stringify(eb).slice(0, 200));
  const camp = await owner('POST', P + '/marketing/emails', { subject: 'Teste QA', body: 'Olá' });
  rec('marketing', 'criar campanha rascunho', camp.status < 500, camp.status + ' ' + camp.text.slice(0, 200));
  const plan = await owner('POST', P + '/marketing/planos', { title: 'Plano QA', goal: 'testar' });
  rec('marketing', 'criar plano de marketing', plan.status < 300, plan.status + ' ' + plan.text.slice(0, 150));
  const planBad = await owner('POST', P + '/marketing/planos', { title: 'x' });
  rec('validacao', 'plano com título curto recusado', planBad.status >= 400 && planBad.status < 500, planBad.status);
  const aud = await owner('GET', P + '/auditoria');
  rec('admin', 'auditoria registra as ações acima', aud.status === 200 && JSON.stringify(aud.json).length > 50, aud.text.slice(0, 200));
}

// 7. logout
{
  const out = await owner('POST', P + '/logout', {});
  rec('admin', 'logout', out.status < 300, out.status);
  const after = await owner('GET', P + '/me');
  rec('seguranca', 'após logout /me = 401', after.status === 401, after.status);
}

fs.writeFileSync(new URL('./resultado-admin.json', import.meta.url), JSON.stringify(results, null, 2));
const fails = results.filter((r) => r.ok === false);
console.log(`\n== ${results.length} verificações · ${results.length - fails.length} ok · ${fails.length} falhas`);
