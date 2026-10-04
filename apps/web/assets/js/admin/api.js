// Cliente da API do backoffice (/api/gestao). Sempre same-origin, com o cabeçalho anti-CSRF do projeto.
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  const res = await fetch(`/api/gestao${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.message ?? 'Erro na requisição', res.status, json?.error);
  return json;
}

async function uploadPdf(method, path, file) {
  const res = await fetch(`/api/gestao${path}`, { method, credentials: 'same-origin', headers: { 'x-folego': '1', 'content-type': 'application/pdf' }, body: file });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.message ?? (res.status === 413 ? 'O PDF passa de 15 MB.' : 'Não foi possível enviar o arquivo'), res.status, json?.error);
  return json;
}

const qs = (o = {}) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  loginPassword: (email, password) => call('POST', '/login-password', { email, password }),
  setupCode: (email) => call('POST', '/setup-code', { email }),
  setup: (email, code, password) => call('POST', '/setup', { email, code, password }),
  changePassword: (current, next) => call('POST', '/password', { current, next }),
  login: (email, code) => call('POST', '/login', { email, code }),
  logout: () => call('POST', '/logout', {}),
  me: () => call('GET', '/me'),
  dashboard: (dias) => call('GET', `/dashboard${qs({ dias })}`),
  jornadaResumo: (dias) => call('GET', `/jornada/resumo${qs({ dias })}`),
  jornadaCaso: (id) => call('GET', `/jornada/caso/${id}`),
  jornadaAssinante: (id) => call('GET', `/jornada/assinante/${id}`),
  avulsos: (o) => call('GET', `/clientes/avulsos${qs(o)}`),
  avulso: (id) => call('GET', `/clientes/avulsos/${id}`),
  contato: (caseId) => call('POST', `/contato/${caseId}`, {}),
  assinaturas: (o) => call('GET', `/assinaturas${qs(o)}`),
  cancelados: () => call('GET', '/assinaturas/cancelados'),
  ebooks: () => call('GET', '/ebooks'),
  editarEbook: (id, body) => call('PATCH', `/ebooks/${id}`, body),
  apagarEbook: (id) => call('DELETE', `/ebooks/${id}`),
  testarEbook: (id) => call('POST', `/ebooks/${id}/teste`, {}),
  async baixarEbook(id) {
    const res = await fetch(`/api/gestao/ebooks/${id}/arquivo`, { credentials: 'same-origin', headers: { 'x-folego': '1' } });
    if (!res.ok) throw new ApiError('Não foi possível baixar', res.status);
    const cd = res.headers.get('content-disposition') ?? '';
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? 'ebook.pdf' };
  },
  subirEbook: ({ file, title, activate }) => uploadPdf('POST', `/ebooks?titulo=${encodeURIComponent(title)}&arquivo=${encodeURIComponent(file.name)}&ativar=${activate ? 1 : 0}`, file),
  atualizarEbook: (id, file) => uploadPdf('PUT', `/ebooks/${id}/arquivo?arquivo=${encodeURIComponent(file.name)}`, file),
  indicacoes: () => call('GET', '/indicacoes'),
  saude: () => call('GET', '/saude'),
  mercado: () => call('GET', '/mercado'),
  atualizarMercado: () => call('POST', '/mercado/atualizar', {}),
  ajustarCreditos: (body) => call('POST', '/indicacoes/creditos', body),
  excluirDados: (id, confirmEmail) => call('DELETE', `/assinaturas/cancelados/${id}`, { confirmEmail }),
  async baixarDados(id) {
    const res = await fetch(`/api/gestao/assinaturas/cancelados/${id}/dados.zip`, { credentials: 'same-origin', headers: { 'x-folego': '1' } });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new ApiError(j?.message ?? 'Não foi possível baixar', res.status, j?.error);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? `dados-${id}.zip` };
  },
  assinaturasResumo: (dias) => call('GET', `/assinaturas/resumo${qs({ dias })}`),
  assinante: (id) => call('GET', `/assinaturas/${id}`),
  assinanteAcao: (id, body) => call('POST', `/assinaturas/${id}/acao`, body),
  parcerias: (dias) => call('GET', `/parcerias${qs({ dias })}`),
  contatos: (o) => call('GET', `/parcerias/contatos${qs(o)}`),
  destinosParceiros: () => call('GET', '/parcerias/destinos'),
  enviarParceiro: (body) => call('POST', '/parcerias/enviar', body),
  enviosParceiros: (o) => call('GET', `/parcerias/envios${qs(o)}`),
  acessos: (o) => call('GET', `/acessos${qs(o)}`),
  prorrogarAcesso: (id, days) => call('POST', `/acessos/${id}/prorrogar`, { days }),
  encerrarAcesso: (id) => call('POST', `/acessos/${id}/encerrar`, {}),
  parceiros: () => call('GET', '/parcerias/parceiros'),
  criarParceiro: (b) => call('POST', '/parcerias/parceiros', b),
  editarParceiro: (id, b) => call('PATCH', `/parcerias/parceiros/${id}`, b),
  excluirParceiro: (id) => call('DELETE', `/parcerias/parceiros/${id}`),
  senhaParceiro: (id) => call('POST', `/parcerias/parceiros/${id}/senha`, {}),
  criarCampanha: (id, b) => call('POST', `/parcerias/parceiros/${id}/campanhas`, b),
  editarCampanha: (id, b) => call('PATCH', `/parcerias/campanhas/${id}`, b),
  segredoCampanha: (id) => call('POST', `/parcerias/campanhas/${id}/segredo`, {}),
  excluirCampanha: (id) => call('DELETE', `/parcerias/campanhas/${id}`),
  acaoEnvio: (id, action) => call('POST', `/parcerias/envios/${id}/acao`, { action }),
  produtos: () => call('GET', '/produtos'),
  salvarProduto: (code, body) => call('PUT', `/produtos/${code}`, body),
  config: () => call('GET', '/config'),
  salvarConfig: (body) => call('PUT', '/config', body),
  usuarios: () => call('GET', '/usuarios'),
  criarUsuario: (body) => call('POST', '/usuarios', body),
  salvarUsuario: (id, body) => call('PUT', `/usuarios/${id}`, body),
  auditoria: (o) => call('GET', `/auditoria${qs(o)}`),
  insights: (dias) => call('GET', `/marketing/insights${qs({ dias })}`),
  emails: () => call('GET', '/marketing/emails'),
  email: (id) => call('GET', `/marketing/emails/${id}`),
  criarEmail: (body) => call('POST', '/marketing/emails', body),
  salvarEmail: (id, body) => call('PUT', `/marketing/emails/${id}`, body),
  apagarEmail: (id) => call('DELETE', `/marketing/emails/${id}`),
  testarEmail: (id) => call('POST', `/marketing/emails/${id}/teste`, {}),
  enviarEmail: (id, recipients) => call('POST', `/marketing/emails/${id}/enviar`, { recipients }),
  pararEmail: (id) => call('POST', `/marketing/emails/${id}/parar`, {}),
  planos: () => call('GET', '/marketing/planos'),
  criarPlano: (body) => call('POST', '/marketing/planos', body),
  salvarPlano: (id, body) => call('PUT', `/marketing/planos/${id}`, body),
  apagarPlano: (id) => call('DELETE', `/marketing/planos/${id}`),
};
