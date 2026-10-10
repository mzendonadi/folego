// Prumo: aba "Contas conectadas" (Open Finance, plano Desbravador). Só leitura de saldos, extrato e cartões; o Fôlego não movimenta dinheiro.
// O login no banco acontece dentro do widget do agregador regulado: a senha nunca passa pelo Fôlego.
import { el, icon, toast } from './dom.js';
import { confirmDialog } from './confirm.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'ainda não sincronizou');
const fmtDay = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const RENEW_WINDOW_DAYS = 30;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = el('script', { src, async: true });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('widget'));
    document.head.append(s);
  });
}

/** Banco de teste (só aparece com OPENFINANCE_FAKE ligado no servidor, fora de produção): no lugar do widget do agregador. */
function pickFakeBank(title) {
  return new Promise((resolve) => {
    const banks = [['fake-azul', 'Banco Azul (teste)'], ['fake-verde', 'Banco Verde (teste)']];
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    let answered = false;
    const dialog = el('dialog', { class: 'dialog dialog-sm', 'aria-labelledby': 'of-fake-title' });
    const done = (value) => {
      if (answered) return;
      answered = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const buttons = banks.map(([id, name]) => {
      const b = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('bank'), name);
      b.addEventListener('click', () => done(id));
      return b;
    });
    dialog.append(el('div', { class: 'dialog-inner' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'of-fake-title' }, title)),
      el('div', { class: 'dialog-body prose' }, el('p', {}, 'Ambiente de testes: estes bancos são de mentira e trazem dados de exemplo. Nada é lido de um banco de verdade.'), el('div', { class: 'button-row' }, ...buttons)),
      el('footer', { class: 'dialog-foot' }, cancel)));
    cancel.addEventListener('click', () => done(null));
    dialog.addEventListener('close', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Abre o widget do agregador (ou o banco de teste) e devolve o id do item conectado, ou null se a pessoa desistiu. */
async function openConnect(of, { accessToken, itemId = null }) {
  if (of.fake) return pickFakeBank(itemId ? 'Reconectar (teste)' : 'Conectar um banco (teste)');
  await loadScript(of.widgetUrl);
  return new Promise((resolve, reject) => {
    const widget = new window.PluggyConnect({
      connectToken: accessToken,
      ...(itemId ? { updateItem: itemId } : {}),
      onSuccess: ({ item }) => resolve(item.id),
      onError: () => reject(new Error('conexão não concluída')),
      onClose: () => resolve(null),
    });
    widget.init();
  });
}

export function viewContas(ctx) {
  const of = ctx.of;
  if (!of?.enabled) {
    return el('div', { class: 'acc-stack' }, card(
      el('h2', {}, 'Contas conectadas (Open Finance)'),
      el('p', { class: 'muted' }, 'Em breve: estamos ativando a conexão com bancos por meio de um parceiro autorizado pelo Banco Central. Quando estiver no ar, você poderá trazer saldo, extrato e cartões de crédito das suas contas para o Prumo sem digitar nada, só para leitura.'),
      el('p', { class: 'fine' }, 'Enquanto isso, você pode lançar à mão ou importar o extrato (CSV, OFX ou PDF) na aba Lançamentos, e cadastrar seus cartões na aba Cartões.'),
    ));
  }

  const consent = el('input', { type: 'checkbox', id: 'of-aceite' });
  const connect = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, icon('lock'), 'Conectar uma conta');
  consent.addEventListener('change', () => {
    connect.disabled = !consent.checked;
  });
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    try {
      const { accessToken } = await ctx.api.ofConnectToken();
      const itemId = await openConnect(of, { accessToken });
      if (itemId) {
        try {
          const r = await ctx.api.ofAddConnection(itemId);
          toast(`Conta conectada. ${r.imported} ${r.imported === 1 ? 'lançamento trazido' : 'lançamentos trazidos'}.`);
          return ctx.refresh();
        } catch (error) {
          toast(error?.status === 409 ? 'Esta conexão já pertence a outra conta.' : 'Não consegui concluir a conexão agora.');
        }
      }
    } catch (error) {
      toast(error?.status === 403 ? 'Contas conectadas são do plano Desbravador.' : 'Não consegui abrir a conexão agora. Tente de novo em instantes.');
    }
    connect.disabled = !consent.checked;
  });

  const rows = of.connections.map((c) => {
    const soon = c.expiresInDays !== null && c.expiresInDays <= RENEW_WINDOW_DAYS;
    const sync = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('refresh'), 'Atualizar agora');
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      try {
        const r = await ctx.api.ofSync(c.id);
        toast(`${r.imported} ${r.imported === 1 ? 'lançamento novo' : 'lançamentos novos'}.`);
        ctx.refresh();
      } catch {
        sync.disabled = false;
        toast('Não consegui atualizar agora.');
      }
    });
    const reconnect = el('button', { class: `btn ${c.needsAction ? 'btn-primary' : 'btn-secondary'} btn-sm`, type: 'button' }, icon('lock'), c.needsAction ? 'Reconectar' : 'Renovar autorização');
    reconnect.addEventListener('click', async () => {
      reconnect.disabled = true;
      try {
        const t = await ctx.api.ofReconnectToken(c.id);
        const itemId = await openConnect(of, { accessToken: t.accessToken, itemId: t.itemId });
        if (itemId) {
          const r = await ctx.api.ofRefresh(c.id);
          toast(r.needsAction ? 'O banco ainda não aceitou. Tente de novo em instantes.' : `Conexão renovada. ${r.imported} ${r.imported === 1 ? 'lançamento trazido' : 'lançamentos trazidos'}.`);
          return ctx.refresh();
        }
      } catch {
        toast('Não consegui reconectar agora. Tente de novo em instantes.');
      }
      reconnect.disabled = false;
    });
    const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('trash'), 'Desconectar');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Desconectar ${c.institution || 'esta conta'}?`, text: 'O acesso do Prumo ao banco é cortado na hora. Os lançamentos que já vieram ficam na sua conta (você pode apagá-los na aba Lançamentos).', confirmLabel: 'Desconectar' }))) return;
      try {
        await ctx.api.ofRevoke(c.id);
        toast('Conta desconectada.');
        ctx.refresh();
      } catch {
        toast('Não consegui desconectar agora.');
      }
    });
    const notes = [];
    if (c.needsAction) notes.push(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, c.lastError === 'Consentimento vencido' ? 'A autorização venceu (o Open Finance limita a 12 meses). Renove para voltar a atualizar sozinho.' : 'O banco pediu para você entrar de novo. Enquanto isso, o Prumo não consegue atualizar esta conta.')));
    else if (soon) notes.push(el('p', { class: 'note note-amber' }, icon('clock'), el('span', {}, `A autorização vence em ${c.expiresInDays} ${c.expiresInDays === 1 ? 'dia' : 'dias'} (${fmtDay(c.consentExpiresAt)}). Renove agora para não parar de atualizar.`)));
    else if (c.lastError) notes.push(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'A última atualização falhou. Tente de novo ou reconecte a conta.')));
    const parts = [`${c.accounts} ${c.accounts === 1 ? 'conta' : 'contas'}`];
    if (c.cards) parts.push(`${c.cards} ${c.cards === 1 ? 'cartão' : 'cartões'}`);
    return el('li', { class: 'wallet-row of-row' },
      el('div', {}, el('strong', {}, c.institution || 'Conta conectada'), el('p', { class: 'muted fine' }, `${parts.join(' · ')} · última atualização: ${fmt(c.lastSyncAt)}${c.consentExpiresAt && !soon && !c.needsAction ? ` · autorização até ${fmtDay(c.consentExpiresAt)}` : ''}`), ...notes),
      el('div', { class: 'button-row of-actions' }, c.needsAction ? null : sync, c.needsAction || soon ? reconnect : null, del));
  });

  return el('div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Contas conectadas'),
      of.fake ? el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, 'Ambiente de testes: os bancos são de mentira e trazem dados de exemplo.')) : null,
      el('p', { class: 'muted' }, 'Traga o saldo, o extrato e os cartões de crédito das suas contas para o Prumo sem digitar. Cada conta vira uma carteira, cada cartão aparece na aba Cartões, e se uma conta estiver no cheque especial, o Prumo mostra o custo e coloca na sua lista de dívidas.'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'Só leitura: lemos saldo e extrato de contas correntes e de poupança, e limite, compras e pagamentos dos cartões. Não movimentamos dinheiro e não pedimos senha: o login é feito no banco, dentro do parceiro autorizado.'),
        el('li', {}, 'Você escolhe o banco e pode desconectar quando quiser, aqui mesmo. Ao desconectar, cortamos o acesso na hora.'),
        el('li', {}, 'A autorização dura até 12 meses, regra do Open Finance. Avisamos por e-mail antes de vencer e você renova com um clique.'),
        el('li', {}, 'Usamos os dados só para montar as suas carteiras, cartões e lançamentos. Não vendemos nem compartilhamos com terceiros.')),
      el('div', { class: 'check' }, consent, el('label', { for: 'of-aceite' }, 'Entendi e autorizo o Fôlego a ler os dados da conta que eu escolher conectar, até eu desconectar ou a autorização vencer.')),
      el('div', { class: 'button-row' }, connect),
      el('p', { class: 'fine' }, `Versão do termo de consentimento: ${of.consentVersion}.`)),
    rows.length ? card(el('h2', {}, 'Suas conexões'), el('ul', { class: 'entries' }, ...rows)) : null,
  );
}
