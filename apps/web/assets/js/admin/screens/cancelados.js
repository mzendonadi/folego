// Assinaturas → Cancelados: ex-assinantes. O acesso deles acaba no fim do mês pago; aqui o dono baixa TODOS os dados
// (.zip) e, só depois, exclui. Se ninguém excluir, o sistema apaga sozinho depois da janela de retenção (Configurações).
import { api } from '../api.js';
import { el, toast, int, dt, card, table, badge, loading, errorBox, PLAN } from '../ui.js';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/** Pergunta com campo de texto: o e-mail do ex-assinante precisa ser digitado para liberar a exclusão. */
function confirmByTyping({ title, text, expected, confirmLabel }) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', type: 'text', autocomplete: 'off', 'aria-label': 'Digite o e-mail para confirmar', placeholder: expected });
    const ok = el('button', { class: 'btn btn-danger', type: 'button', disabled: true }, confirmLabel);
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    const dialog = el(
      'dialog', { class: 'dialog dialog-sm', 'aria-labelledby': 'purge-title' },
      el('div', { class: 'dialog-inner' },
        el('header', { class: 'dialog-head' }, el('h2', { id: 'purge-title' }, title)),
        el('div', { class: 'dialog-body prose' }, el('p', {}, text), el('p', {}, 'Para confirmar, digite o e-mail: ', el('strong', {}, expected)), input),
        el('footer', { class: 'dialog-foot' }, cancel, ok)),
    );
    const done = (v) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    input.addEventListener('input', () => { ok.disabled = input.value.trim().toLowerCase() !== expected.toLowerCase(); });
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dialog.addEventListener('cancel', () => done(false));
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

export async function canceladosView(ctx) {
  const host = el('div', { class: 'bo-stack' });
  async function draw() {
    host.replaceChildren(loading());
    try {
      const d = await api.cancelados();
      const rows = d.rows;
      const baixar = (r) => {
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Baixar dados');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const blob = await api.baixarDados(r.subscriberId);
            save(blob.blob, blob.filename);
            toast('Pacote baixado. Guarde em local seguro antes de excluir.');
            draw();
          } catch (e) {
            b.disabled = false;
            toast(e.message);
          }
        });
        return b;
      };
      const excluir = (r) => {
        const b = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: !r.exportedAt, title: r.exportedAt ? '' : 'Baixe os dados antes de excluir' }, 'Excluir dados');
        b.addEventListener('click', async () => {
          const ok = await confirmByTyping({
            title: 'Excluir todos os dados?',
            text: `Vamos apagar para sempre tudo o que o sistema guarda de ${r.email} (lançamentos, dívidas, metas, lembretes, carteiras, preferências). Pedidos e pagamentos ficam sem dado pessoal, por obrigação fiscal. Não dá para desfazer.`,
            expected: r.email,
            confirmLabel: 'Excluir definitivamente',
          });
          if (!ok) return;
          b.disabled = true;
          try {
            const out = await api.excluirDados(r.subscriberId, r.email);
            toast(`Dados excluídos (${int(out.deletedRows)} registros).`);
            draw();
          } catch (e) {
            b.disabled = false;
            toast(e.message);
          }
        });
        return b;
      };
      host.replaceChildren(
        card(
          'Ex-assinantes (cancelados)',
          el('p', { class: 'muted' }, `Quem cancelou continua com acesso e com o download dos próprios dados até o fim do mês pago. Depois disso o acesso fecha. Aqui você baixa, ao seu critério, o pacote COMPLETO (.zip) e então exclui. Se ninguém excluir, o sistema apaga sozinho ${d.purgeDays} dias depois do fim do acesso (ajustável em Configurações).`),
          table(
            [
              { label: 'E-mail', render: (r) => r.email },
              { label: 'Plano', render: (r) => PLAN[r.plan?.toLowerCase()] ?? r.plan },
              { label: 'Cancelou em', render: (r) => day(r.canceledAt) },
              { label: 'Acesso', render: (r) => (r.accessEnded ? badge('Encerrado', 'muted') : badge(`Até ${day(r.accessUntil)}`, 'ok')) },
              { label: 'Exclusão automática', render: (r) => day(r.purgeOn) },
              { label: 'Dados baixados', render: (r) => (r.exportedAt ? badge(dt(r.exportedAt), 'ok') : badge('Ainda não', 'warn')) },
              { label: 'Registros', align: 'right', render: (r) => int(r.dataRows) },
              { label: 'Ações', render: (r) => el('div', { class: 'bo-actions' }, baixar(r), excluir(r)) },
            ],
            rows,
            { emptyText: 'Ninguém cancelou até agora.' },
          ),
        ),
        el('p', { class: 'fine' }, 'O pacote inclui uma tabela por arquivo (.json) com todas as linhas ligadas à conta, mais um LEIA-ME. Não inclui segredos de sessão. Baixar e excluir ficam registrados na auditoria.'),
      );
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return host;
}
