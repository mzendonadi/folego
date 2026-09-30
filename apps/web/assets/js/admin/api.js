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

const qs = (o = {}) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  requestCode: (email) => call('POST', '/login-code', { email }),
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
  assinaturasResumo: (dias) => call('GET', `/assinaturas/resumo${qs({ dias })}`),
  assinante: (id) => call('GET', `/assinaturas/${id}`),
  assinanteAcao: (id, body) => call('POST', `/assinaturas/${id}/acao`, body),
  parcerias: (dias) => call('GET', `/parcerias${qs({ dias })}`),
  contatos: (o) => call('GET', `/parcerias/contatos${qs(o)}`),
  produtos: () => call('GET', '/produtos'),
  salvarProduto: (code, body) => call('PUT', `/produtos/${code}`, body),
  config: () => call('GET', '/config'),
  salvarConfig: (body) => call('PUT', '/config', body),
  usuarios: () => call('GET', '/usuarios'),
  criarUsuario: (body) => call('POST', '/usuarios', body),
  salvarUsuario: (id, body) => call('PUT', `/usuarios/${id}`, body),
  auditoria: (o) => call('GET', `/auditoria${qs(o)}`),
  insights: (dias) => call('GET', `/marketing/insights${qs({ dias })}`),
  planos: () => call('GET', '/marketing/planos'),
  criarPlano: (body) => call('POST', '/marketing/planos', body),
  salvarPlano: (id, body) => call('PUT', `/marketing/planos/${id}`, body),
  apagarPlano: (id) => call('DELETE', `/marketing/planos/${id}`),
};
