// Prumo: aba "Contas conectadas" (Open Finance, plano Desbravador). Só leitura de saldos e extrato; o Fôlego não movimenta dinheiro.
// O login no banco acontece dentro do widget do agregador regulado: a senha nunca passa pelo Fôlego.
import { el, icon, toast } from './dom.js';
import { confirmDialog } from './confirm.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'ainda não sincronizou');

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = el('script', { src, async: true });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('widget'));
    document.head.append(s);
  });
}

export function viewContas(ctx) {
  const of = ctx.of;
  if (!of?.enabled) {
    return el('div', { class: 'acc-stack' }, card(
      el('h2', {}, 'Contas conectadas (Open Finance)'),
      el('p', { class: 'muted' }, 'Em breve: estamos ativando a conexão com bancos por meio de um parceiro autorizado pelo Banco Central. Quando estiver no ar, você poderá trazer saldo e extrato das suas contas para o Prumo sem digitar nada, só para leitura.'),
      el('p', { class: 'fine' }, 'Enquanto isso, você pode lançar à mão ou importar o extrato (CSV ou OFX) na aba Lançamentos.'),
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
      await loadScript(of.widgetUrl);
      const widget = new window.PluggyConnect({
        connectToken: accessToken,
        onSuccess: async ({ item }) => {
          try {
            const r = await ctx.api.ofAddConnection(item.id);
            toast(`Conta conectada. ${r.imported} ${r.imported === 1 ? 'lançamento trazido' : 'lançamentos trazidos'}.`);
            ctx.refresh();
          } catch (error) {
            toast(error?.status === 409 ? 'Esta conexão já pertence a outra conta.' : 'Não consegui concluir a conexão agora.');
          }
        },
        onError: () => toast('A conexão não foi concluída. Você pode tentar de novo.'),
        onClose: () => {
          connect.disabled = !consent.checked;
        },
      });
      widget.init();
    } catch (error) {
      connect.disabled = !consent.checked;
      toast(error?.status === 403 ? 'Contas conectadas são do plano Desbravador.' : 'Não consegui abrir a conexão agora. Tente de novo em instantes.');
    }
  });

  const rows = of.connections.map((c) => {
    const sync = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Atualizar agora');
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
    return el('li', { class: 'wallet-row' },
      el('div', {}, el('strong', {}, c.institution || 'Conta conectada'), el('p', { class: 'muted fine' }, `${c.accounts} ${c.accounts === 1 ? 'conta' : 'contas'} · última atualização: ${fmt(c.lastSyncAt)}`), c.lastError ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'A última atualização falhou. Tente de novo ou reconecte a conta.')) : null),
      sync, del);
  });

  return el('div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Contas conectadas'),
      el('p', { class: 'muted' }, 'Traga o saldo e o extrato das suas contas bancárias para o Prumo sem digitar. Cada conta vira uma carteira, e se ela estiver no cheque especial, o Prumo mostra o custo e coloca na sua lista de dívidas.'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'Só leitura: lemos saldo e extrato de contas correntes e de poupança. Não movimentamos dinheiro e não pedimos senha: o login é feito no banco, dentro do parceiro autorizado.'),
        el('li', {}, 'Você escolhe o banco e pode desconectar quando quiser, aqui mesmo. Ao desconectar, cortamos o acesso na hora.'),
        el('li', {}, 'Usamos os dados só para montar as suas carteiras e lançamentos. Não vendemos nem compartilhamos com terceiros.'),
        el('li', {}, 'Cartões de crédito ainda não entram nesta versão.')),
      el('div', { class: 'check' }, consent, el('label', { for: 'of-aceite' }, 'Entendi e autorizo o Fôlego a ler os dados da conta que eu escolher conectar, até eu desconectar.')),
      el('div', { class: 'button-row' }, connect),
      el('p', { class: 'fine' }, `Versão do termo de consentimento: ${of.consentVersion}.`)),
    rows.length ? card(el('h2', {}, 'Suas conexões'), el('ul', { class: 'entries' }, ...rows)) : null,
  );
}
