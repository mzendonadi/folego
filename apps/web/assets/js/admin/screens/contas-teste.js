// Contas de teste (demo): ligue para usar o Prumo completo e os produtos avulsos sem pagar; desligue para voltar ao normal.
// O código de entrada é gerado aqui (não depende de caixa de e-mail) e aparece uma única vez.
import { api } from '../api.js';
import { el, toast, dt, card, table, badge, field, drawer } from '../ui.js';
import { confirmDialog } from '../../confirm.js';

export async function contasTesteScreen() {
  const host = el('div', { class: 'bo-stack' });

  async function draw() {
    host.replaceChildren(el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      const r = await api.contasTeste();
      const act = async (fn, ok) => {
        try {
          await fn();
          if (ok) toast(ok);
          draw();
        } catch (e) {
          toast(e?.message ?? 'Não consegui agora.');
        }
      };
      const actions = (x) => {
        const toggle = el('button', { class: `btn btn-sm ${x.active ? 'btn-quiet' : 'btn-primary'}`, type: 'button' }, x.active ? 'Desligar' : 'Ligar');
        toggle.addEventListener('click', () => act(() => api.ligarContaTeste(x.id, !x.active), x.active ? 'Conta de teste desligada.' : 'Conta de teste ligada.'));
        const code = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !x.active }, 'Gerar código de entrada');
        code.addEventListener('click', async () => {
          try {
            const out = await api.codigoContaTeste(x.id);
            const d = drawer('Código de entrada');
            d.body.append(
              el('p', { class: 'note note-amber' }, el('span', {}, `Vale ${out.minutes} minutos e só uma vez. No Prumo (folego.online/conta), digite ${out.email} e este código.`)),
              el('section', {}, el('h3', {}, out.email), el('div', { class: 'bo-secret' }, out.code)),
            );
          } catch (e) {
            toast(e?.message ?? 'Não consegui gerar o código.');
          }
        });
        const pass = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, x.hasPassword ? 'Nova senha' : 'Criar senha');
        pass.addEventListener('click', async () => {
          if (x.hasPassword && !(await confirmDialog({ title: 'Gerar uma senha nova?', text: 'A senha atual deixa de funcionar. A nova aparece uma vez só.', confirmLabel: 'Gerar' }))) return;
          try {
            const out = await api.senhaContaTeste(x.id);
            draw();
            const d = drawer('Senha de entrada');
            d.body.append(
              el('p', { class: 'note note-amber' }, el('span', {}, `Guarde agora, ela não aparece de novo. No Prumo (folego.online/conta), toque em "Conta de teste? Entrar com senha" e use ${x.email} com esta senha. Só funciona com a conta LIGADA.`)),
              el('section', {}, el('h3', {}, x.email), el('div', { class: 'bo-secret' }, out.password)),
            );
          } catch (e) {
            toast(e?.message ?? 'Não consegui gerar a senha.');
          }
        });
        const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Remover ${x.email}` }, 'Remover');
        del.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: `Remover ${x.email}?`, text: 'A conta de teste sai da lista e o plano é encerrado. Os dados da conta continuam até serem apagados.', confirmLabel: 'Remover', danger: true }))) return;
          act(() => api.removerContaTeste(x.id), 'Conta de teste removida.');
        });
        return el('span', { class: 'bo-actions' }, toggle, pass, code, del);
      };

      const email = el('input', { class: 'input', type: 'email', 'aria-label': 'E-mail da conta de teste', placeholder: 'demo@folego.online' });
      const label = el('input', { class: 'input', type: 'text', maxlength: '80', 'aria-label': 'Descrição', placeholder: 'Ex.: teste da equipe' });
      const add = el('button', { class: 'btn btn-primary', type: 'button' }, 'Adicionar conta de teste');
      add.addEventListener('click', () => {
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return toast('Informe um e-mail válido.');
        act(() => api.criarContaTeste({ email: email.value.trim(), label: label.value.trim() }), 'Conta de teste adicionada (começa desligada).');
      });

      host.replaceChildren(
        el('p', { class: 'muted' }, 'Com a conta LIGADA, quem entrar com ela vê o Prumo completo (plano Desbravador) e libera os produtos avulsos (Mapa, tradutor, guias, cartas, calendário, renda extra) sem Pix nem cartão. O pedido fica registrado com valor zero e não entra na receita. DESLIGADA, ela volta a ser uma conta comum: o plano fecha na hora e os produtos voltam a pedir pagamento.'),
        table(
          [
            { label: 'E-mail', render: (x) => x.email },
            { label: 'Descrição', render: (x) => x.label || '—' },
            { label: 'Situação', cls: 'nowrap', render: (x) => (x.active ? badge('Ligada', 'ok') : badge('Desligada', 'muted')) },
            { label: 'Último acesso', cls: 'nowrap', render: (x) => dt(x.lastLoginAt) },
            { label: '', render: actions },
          ],
          r.accounts,
          { emptyText: 'Nenhuma conta de teste.' },
        ),
        el('div', { class: 'bo-form-grid' }, field('Nova conta de teste (e-mail)', email), field('Descrição (opcional)', label)),
        el('div', { class: 'bo-actions' }, add),
        el('p', { class: 'fine' }, 'Dica: o código de entrada é gerado aqui, então o e-mail não precisa ter caixa de entrada. Para receber o código por e-mail como um cliente comum, use um endereço que você acessa.'),
      );
    } catch (e) {
      host.replaceChildren(el('p', { class: 'note note-amber' }, el('span', {}, e?.message ?? 'Não consegui carregar.')));
    }
  }
  draw();
  return card('Contas de teste (demo)', host);
}
