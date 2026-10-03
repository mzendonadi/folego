// Indicações: acompanha os convites de quem comprou no Pix (só leads) e de assinantes (10% na próxima fatura por indicação que assina).
import { api } from '../api.js';
import { el, toast, int, dt, card, kpis, kpi, table, badge, loading, errorBox, field } from '../ui.js';

const STATUS = { sent: ['Convite enviado', 'muted'], converted: ['Virou assinante', 'ok'] };

function adjustDialog(row, onDone) {
  const delta = el('input', { class: 'input', type: 'number', min: '-12', max: '12', value: '1', 'aria-label': 'Créditos a somar (use negativo para tirar)' });
  const reason = el('input', { class: 'input', type: 'text', maxlength: '200', placeholder: 'Ex.: cortesia de lançamento', 'aria-label': 'Motivo do ajuste' });
  const ok = el('button', { class: 'btn btn-primary', type: 'button' }, 'Aplicar ajuste');
  const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
  const dialog = el(
    'dialog', { class: 'dialog dialog-sm', 'aria-labelledby': 'adj-title' },
    el('div', { class: 'dialog-inner' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'adj-title' }, 'Ajustar créditos de desconto')),
      el('div', { class: 'dialog-body prose' }, el('p', {}, el('strong', {}, row.email), ` tem ${row.available} crédito(s) disponível(is). Cada crédito é um mês com desconto na próxima fatura.`), field('Créditos (+ soma, − tira)', delta), field('Motivo (fica na auditoria)', reason)),
      el('footer', { class: 'dialog-foot' }, cancel, ok)),
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      const r = await api.ajustarCreditos({ subscriberId: row.subscriberId, delta: Number(delta.value), reason: reason.value });
      toast(`Pronto: ${r.available} crédito(s) disponível(is).`);
      close();
      onDone();
    } catch (e) {
      ok.disabled = false;
      toast(e.message);
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  reason.focus();
}

export async function indicacoesScreen() {
  const host = el('div', { class: 'bo-stack' });
  async function draw() {
    host.replaceChildren(loading());
    try {
      const d = await api.indicacoes();
      const k = d.kpis;
      host.replaceChildren(
        el('p', { class: 'muted bo-lead' }, 'Quem compra um produto no Pix pode indicar um amigo por e-mail (só gera lead, sem desconto nem bônus). Quem assina o Prumo indica e ganha um mês de desconto na próxima fatura por cada indicação que assinar um plano; os meses se acumulam.'),
        kpis(
          kpi('Convites de assinantes', int(k.subscriberInvites), `${int(k.converted)} viraram assinatura (${k.conversionPct}%)`, 'good'),
          kpi('Convites de compradores no Pix', int(k.leadInvites), 'leads, sem bônus', ''),
          kpi('Descontos disponíveis', int(k.creditsAvailable), `${int(k.creditsApplied)} já aplicados em faturas`, k.creditsAvailable ? 'warn' : ''),
          kpi('Desconto por indicação', `${d.percent}%`, d.enabled ? 'programa ligado' : 'programa DESLIGADO', d.enabled ? 'good' : 'bad'),
        ),
        card(
          'Quem mais indica',
          table(
            [
              { label: 'Assinante', render: (r) => r.email },
              { label: 'Convites', align: 'right', render: (r) => int(r.sent) },
              { label: 'Assinaram', align: 'right', render: (r) => int(r.converted) },
              { label: 'Descontos disponíveis', align: 'right', render: (r) => int(r.available) },
              { label: 'Aplicados', align: 'right', render: (r) => int(r.applied) },
              { label: 'Ação', render: (r) => { const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ajustar créditos'); b.addEventListener('click', () => adjustDialog(r, draw)); return b; } },
            ],
            d.top,
            { emptyText: 'Ainda não há indicações.' },
          ),
        ),
        card(
          'Convites recentes',
          table(
            [
              { label: 'Quando', render: (r) => dt(r.at) },
              { label: 'Tipo', render: (r) => (r.kind === 'subscriber' ? badge('Assinante', 'ok') : badge('Comprador (Pix)', 'muted')) },
              { label: 'Quem indicou', render: (r) => r.referrer },
              { label: 'Amigo', render: (r) => r.friend },
              { label: 'Situação', render: (r) => badge(...(STATUS[r.status] ?? [r.status, 'muted'])) },
            ],
            d.recent,
            { emptyText: 'Nenhum convite ainda.' },
          ),
        ),
        el('p', { class: 'fine' }, 'O percentual e o liga/desliga ficam em Configurações. Os e-mails dos amigos aparecem mascarados e ficam guardados só para evitar repetição; quem pede para não receber é bloqueado na hora. O desconto entra no valor da assinatura no Asaas (atualizado automaticamente a cada ajuste).'),
      );
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return host;
}
