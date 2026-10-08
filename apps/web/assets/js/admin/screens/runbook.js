// Runbook de incidentes: o que fazer, em ordem, quando algo dá errado. Mesmo conteúdo de deploy/RUNBOOK-INCIDENTES.md.
import { el, card } from '../ui.js';

const INCIDENTES = [
  ['Site fora do ar ou com erro', [
    'Confirme no Painel (card "Sistema saudável") e no e-mail do Monitor (GitHub) o que falhou.',
    'GitHub → Actions → Operações → ação "status": mostra containers, disco e backups.',
    'Se algum container caiu: Actions → "Publicar em produção" (refaz o deploy sem perder dados).',
    'Se continuar fora: veja o status do Cloudflare e da hospedagem (VPS). Avise quem está comprando pelo aviso no topo do site (Configurações → Aviso no site).',
  ]],
  ['Cliente pagou o Pix e o Mapa não liberou', [
    'Painel → "Eventos de pagamento": se houver evento sem processar, o webhook do Asaas está falhando.',
    'Actions → Operações → "pagamentos": lista os últimos pedidos e avisos do provedor, sem dados pessoais.',
    'Painel do Asaas → Integrações → Webhooks: reenvie o aviso daquela cobrança e confira o token e a URL (folego.online/webhooks/pix).',
    'Se for urgente, libere na mão: Assinaturas ou Clientes → estender/cortesia, com o motivo (fica na auditoria).',
  ]],
  ['Cartão recusado ou assinatura em débito', [
    'O cliente recebe e-mail automático e a assinatura aparece como "Em débito" (acesso segue até o fim do período pago + 2 dias).',
    'Se o cliente pedir ajuda, responda pelo suporte@folego.online orientando a trocar o cartão na página do Asaas.',
    'Não ofereça reembolso do mês em andamento: a regra publicada é "sem devolução do mês em andamento" (exceções por decisão do dono).',
  ]],
  ['Contestação (chargeback) ou suspeita de fraude', [
    'Painel do Asaas → Cobranças: abra a contestação e anexe as provas: aceite dos termos (data e versão), e-mail de entrega e acesso ao Mapa.',
    'Se for fraude, cancele a assinatura em Assinaturas e registre o motivo. Guarde tudo: a auditoria do backoffice é o histórico.',
  ]],
  ['Vazamento de dados ou acesso indevido', [
    'Pause as vendas agora: Configurações → "Pausar as vendas". Isso impede novos cadastros e pagamentos.',
    'Faça um backup (Operações → "backup_agora") e preserve os registros antes de mexer em qualquer coisa.',
    'Troque as chaves no GitHub (Settings → Secrets): ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, META_CAPI_TOKEN, TURNSTILE_SECRET, RESEND_API_KEY; depois publique. Não troque APP_SECRET sem falar com o suporte técnico: ele protege dados já gravados.',
    'Avalie o risco aos titulares e comunique a ANPD e as pessoas afetadas em prazo razoável (LGPD, art. 48; a ANPD orienta 3 dias úteis). Procure o advogado da empresa.',
  ]],
  ['IA fora do ar ou custo subindo', [
    'Configurações → desligue "IA nas entregas": as entregas saem pelos modelos fixos, sem custo de IA, e o cliente recebe do mesmo jeito.',
    'Ajuste o teto diário e o teto mensal em "Custos e limites" e acompanhe o card "Custos e limites" no Painel.',
  ]],
  ['E-mails não chegam', [
    'Painel do Resend: veja entregas e bloqueios (domínio folego.online, SPF e DKIM verificados).',
    'Enquanto isso, o cliente pode abrir o acesso pelo próprio site (código na tela de login). Se o limite diário estiver perto (card "Custos e limites"), aumente o plano do Resend.',
  ]],
  ['Meta (anúncios) sem registrar eventos', [
    'Actions → Operações → "logs_api": procure "meta_capi_erro". Isso nunca afeta as vendas: o evento só deixa de ser enviado.',
    'Token vencido ou errado: cadastre de novo o segredo META_CAPI_TOKEN no GitHub e rode "Publicar em produção".',
  ]],
  ['Banco ou disco com problema; precisa restaurar', [
    'Actions → Operações → "status" (disco, backups) e "testar_restauracao" (prova que o último backup restaura).',
    'Restauração de verdade é feita pelo suporte técnico a partir do último backup em ~/backups (diário às 03:15 UTC, guarda 14 dias; a cópia criptografada fica nos artefatos do GitHub).',
  ]],
  ['Conta de teste ligada por engano', [
    'Contas de teste → desligue. Ligada, ela libera produtos sem cobrança. Troque a senha antes de ligar de novo.',
  ]],
];

export function runbookCard() {
  return card(
    'Runbook de incidentes',
    el('p', { class: 'muted' }, 'O que fazer, em ordem, quando algo dá errado. Dúvida? suporte@folego.online. Quem decide: o dono; quem executa as ações técnicas: o suporte técnico, pelos botões da aba Operações do GitHub.'),
    ...INCIDENTES.map(([titulo, passos]) => el('details', { class: 'bo-runbook' }, el('summary', {}, titulo), el('ol', {}, ...passos.map((p) => el('li', {}, p))))),
  );
}
