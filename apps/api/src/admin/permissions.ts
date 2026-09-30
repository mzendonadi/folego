// Seções do backoffice e o que cada papel enxerga por padrão. O dono (owner) sempre tem tudo; para os demais,
// vale a lista de permissões gravada no usuário (o papel só sugere o conjunto inicial ao criar).
export const SECTIONS = ['dashboard', 'clientes', 'clientes_pii', 'assinaturas', 'jornada', 'parcerias', 'precos', 'marketing', 'config_site', 'config_usuarios', 'auditoria'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  dashboard: 'Dashboard e indicadores',
  clientes: 'Clientes (cadastro e compras)',
  clientes_pii: 'Ver dados pessoais de contatos (nome, telefone, e-mail)',
  assinaturas: 'Assinaturas (em dia, vencendo, em débito) e ações',
  jornada: 'Jornada e funil',
  parcerias: 'Parcerias e leads',
  precos: 'Produtos e preços',
  marketing: 'Marketing e relacionamento',
  config_site: 'Configurações do site e das assinaturas',
  config_usuarios: 'Usuários e permissões do backoffice',
  auditoria: 'Registro de auditoria',
};

export const ROLES = ['owner', 'gestor', 'financeiro', 'marketing', 'suporte'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { owner: 'Dono', gestor: 'Gestor', financeiro: 'Financeiro', marketing: 'Marketing', suporte: 'Suporte' };

export const ROLE_PRESETS: Record<Role, Section[]> = {
  owner: [...SECTIONS],
  gestor: ['dashboard', 'clientes', 'assinaturas', 'jornada', 'parcerias', 'precos', 'marketing', 'config_site', 'auditoria'],
  financeiro: ['dashboard', 'clientes', 'assinaturas', 'precos', 'auditoria'],
  marketing: ['dashboard', 'jornada', 'parcerias', 'marketing'],
  suporte: ['clientes', 'assinaturas', 'jornada'],
};

export const isSection = (v: unknown): v is Section => typeof v === 'string' && (SECTIONS as readonly string[]).includes(v);
