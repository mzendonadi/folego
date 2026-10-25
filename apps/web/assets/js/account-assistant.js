// Assistente do Prumo no WhatsApp: vincular o número, ver o que dá para pedir e desconectar.
// O vínculo é feito mandando "VINCULAR <código>" do próprio aparelho para o WhatsApp do Fôlego; isso prova que o número é da pessoa.
import { el, icon, toast } from './dom.js';
import { confirmDialog } from './confirm.js';

export function assistantCard(ctx) {
  const box = el('section', { class: 'card d-section assistant-card' });
  let poll = null;
  let drawn = false;

  async function draw() {
    if (drawn && !box.isConnected) { clearInterval(poll); return; } // a pessoa saiu da aba
    drawn = true;
    const s = await ctx.api.getAssistant().catch(() => null);
    if (!s || !s.available) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    const parts = [el('h2', {}, 'Assistente no WhatsApp'), el('p', { class: 'muted' }, 'Lance gastos e consulte o saldo conversando, sem abrir o app. Escreva do seu jeito: "mercado 45", "recebi 1.200 de salário".')];
    clearInterval(poll);
    if (s.linked) {
      const off = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Desconectar este WhatsApp');
      off.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Desconectar o WhatsApp?', text: 'Você deixa de lançar e consultar por mensagem. Os lançamentos já feitos continuam na sua conta.', confirmLabel: 'Desconectar' }))) return;
        try { await ctx.api.unlinkAssistant(); toast('WhatsApp desconectado.'); } catch { toast('Não consegui agora.'); }
        draw();
      });
      parts.push(
        el('p', { class: 'note' }, icon('check'), el('span', {}, `Conectado ao WhatsApp ${s.phone}. Mande mensagem para ${s.number}.`)),
        el('ul', { class: 'tick-list left' }, ...['"uber 18,90 ontem" lança um gasto', 'SALDO mostra o mês', 'CONTAS lista o que vence em 7 dias', 'DESFAZER apaga o último lançamento'].map((t) => el('li', {}, icon('check'), t))),
        off,
      );
    } else if (s.pending) {
      parts.push(
        el('p', {}, 'Toque no botão e envie a mensagem que já vem pronta. Se preferir, mande ', el('strong', {}, `VINCULAR ${s.pending.code}`), ` para ${s.number}, do número que você quer conectar.`),
        el('a', { class: 'btn btn-primary', href: s.pending.link, target: '_blank', rel: 'noopener' }, 'Abrir o WhatsApp e enviar o código'),
        el('p', { class: 'fine muted' }, 'O código vale por 30 minutos. Esta tela atualiza sozinha quando o WhatsApp for conectado.'),
      );
      poll = setInterval(draw, 4000);
    } else {
      const go = el('button', { class: 'btn btn-primary', type: 'button' }, 'Conectar meu WhatsApp');
      go.addEventListener('click', async () => {
        go.disabled = true;
        try { await ctx.api.startAssistantLink(); } catch (e) { toast(e?.message || 'Não consegui agora.'); }
        draw();
      });
      parts.push(go);
    }
    box.replaceChildren(...parts);
  }
  draw();
  return box;
}
