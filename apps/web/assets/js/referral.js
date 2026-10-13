// Indicações: modal "indique um amigo" (compradores no Pix e assinantes do Prumo) e a aba "Indique e ganhe".
import { el, icon, toast, copyText } from './dom.js';
import { brl } from './format.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));

/**
 * Modal com o e-mail do amigo (e, para quem não tem conta, o primeiro nome de quem indica).
 * `onSubmit({ friendEmail, yourName })` deve lançar erro se falhar.
 */
export function openFriendDialog({ title, intro, askName = false, note, submitLabel = 'Enviar convite', onSent = () => {} , onSubmit }) {
  const email = el('input', { class: 'input', id: 'rf-email', type: 'email', autocomplete: 'off', required: true, placeholder: 'email@doseuamigo.com' });
  const name = askName ? el('input', { class: 'input', id: 'rf-nome', type: 'text', autocomplete: 'given-name', maxlength: '40', required: true, placeholder: 'Como seu amigo te conhece?' }) : null;
  const send = el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
  const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Agora não');
  const form = el(
    'form', { class: 'tool-form', novalidate: true },
    name ? el('div', { class: 'field' }, el('label', { class: 'label', for: 'rf-nome' }, 'Seu primeiro nome'), name) : null,
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'rf-email' }, 'E-mail do seu amigo'), email),
    note ? el('p', { class: 'fine muted' }, note) : null,
  );
  const dialog = el(
    'dialog', { class: 'dialog dialog-sm', 'aria-labelledby': 'rf-title' },
    el('div', { class: 'dialog-inner' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'rf-title' }, title)),
      el('div', { class: 'dialog-body prose' }, el('p', {}, intro), form),
      el('footer', { class: 'dialog-foot' }, cancel, send)),
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  const submit = async () => {
    const f = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f)) return toast('Confira o e-mail do seu amigo.');
    if (name && name.value.trim().length < 2) return toast('Diga o seu primeiro nome.');
    send.disabled = true;
    try {
      const res = await onSubmit({ friendEmail: f, yourName: name?.value.trim() ?? '' });
      if (res?.status === 'blocked') {
        // Não enviamos: dizemos a verdade em vez de "enviado". Não revelamos se foi prazo ou pedido da pessoa de não receber.
        send.disabled = false;
        return toast('Não enviamos: este e-mail já recebeu um convite recentemente ou pediu para não receber. Tente outro e-mail ou compartilhe o seu link.');
      }
      toast(`Convite enviado para ${f}. Se não aparecer na caixa de entrada, peça para olhar o spam.`);
      close();
      onSent();
    } catch (err) {
      send.disabled = false;
      toast(err?.message || 'Não consegui enviar agora. Tente de novo.');
    }
  };
  send.addEventListener('click', submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  document.body.append(dialog);
  dialog.showModal();
  (name ?? email).focus();
}

/** Texto do convite (o mesmo do modelo aprovado no WhatsApp do Fôlego; no seu próprio WhatsApp a pessoa pode editar antes de enviar). */
export const whatsappInviteText = (friendName, link) =>
  `Olá, ${friendName}! Sou assinante do Prumo e com ele tenho reorganizado minhas finanças, atingindo minhas metas com o planejador e estou gostando da experiência. Por isso, gostaria de compartilhar com você o acesso à plataforma para conhecer melhor a solução. Se quiser saber mais, acesse: ${link} Abraços!`;

const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Modal do convite por WhatsApp. Dois caminhos:
 * - "Enviar pelo meu WhatsApp": abre o WhatsApp da própria pessoa com a mensagem pronta (sem custo e sem regra de envio em massa).
 * - "Enviar pelo WhatsApp do Fôlego" (só se ligado): o Fôlego manda a mensagem, em horário comercial, e mostra a situação do envio.
 */
export function openWhatsAppDialog({ link, officialEnabled, onSubmit, onSent = () => {} }) {
  const name = el('input', { class: 'input', id: 'rw-nome', type: 'text', autocomplete: 'off', maxlength: '40', required: true, placeholder: 'Nome do seu amigo' });
  const phone = el('input', { class: 'input', id: 'rw-fone', type: 'tel', inputmode: 'tel', autocomplete: 'off', maxlength: '24', placeholder: '(41) 99999-0000' });
  const confirm = el('input', { type: 'checkbox', id: 'rw-ok' });
  const preview = el('p', { class: 'fine muted', id: 'rw-previa', style: 'white-space:pre-wrap' });
  const upd = () => {
    preview.textContent = whatsappInviteText(name.value.trim() || 'Nome', link);
  };
  name.addEventListener('input', upd);
  upd();
  const own = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('chat'), 'Enviar pelo meu WhatsApp');
  const official = officialEnabled ? el('button', { class: 'btn btn-primary', type: 'button' }, 'Enviar pelo WhatsApp do Fôlego') : null;
  const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Agora não');
  const form = el(
    'form', { class: 'tool-form', novalidate: true },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'rw-nome' }, 'Primeiro nome do seu amigo'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'rw-fone' }, 'WhatsApp do seu amigo (com DDD)'), phone),
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Mensagem'), preview),
    officialEnabled
      ? el('div', { class: 'check' }, confirm, el('label', { for: 'rw-ok' }, 'Conheço esta pessoa e acho que ela vai gostar de receber este convite. Ela poderá responder SAIR para não receber mais nada.'))
      : null,
    el('p', { class: 'fine muted' }, officialEnabled ? 'No “meu WhatsApp” a mensagem abre pronta no seu aplicativo e você envia você mesmo. Pelo WhatsApp do Fôlego, mandamos por você, em horário comercial.' : 'A mensagem abre pronta no seu WhatsApp para você enviar.'),
  );
  const dialog = el(
    'dialog', { class: 'dialog dialog-sm', 'aria-labelledby': 'rw-title' },
    el('div', { class: 'dialog-inner' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'rw-title' }, 'Convide um amigo pelo WhatsApp')),
      el('div', { class: 'dialog-body prose' }, form),
      el('footer', { class: 'dialog-foot dialog-foot-stack' }, cancel, own, official)),
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  const friend = () => name.value.trim();
  own.addEventListener('click', () => {
    if (friend().length < 2) return toast('Digite o primeiro nome do seu amigo.');
    const d = onlyDigits(phone.value);
    const to = d.length >= 10 ? (d.startsWith('55') && d.length >= 12 ? d : `55${d}`) : '';
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(whatsappInviteText(friend(), link))}`, '_blank', 'noopener');
  });
  official?.addEventListener('click', async () => {
    if (friend().length < 2) return toast('Digite o primeiro nome do seu amigo.');
    if (onlyDigits(phone.value).length < 10) return toast('Digite o WhatsApp do seu amigo com DDD.');
    if (!confirm.checked) return toast('Confirme que você conhece a pessoa para enviarmos o convite.');
    official.disabled = true;
    try {
      const res = await onSubmit({ phone: phone.value.trim(), friendName: friend(), confirmed: true });
      if (res?.status === 'blocked') {
        official.disabled = false;
        return toast(res.reason === 'optout' ? 'Esta pessoa pediu para não receber mensagens do Fôlego. Compartilhe pelo seu WhatsApp.' : 'Este número já recebeu um convite recentemente. Compartilhe pelo seu WhatsApp, se quiser.');
      }
      toast('Convite na fila! Enviamos em horário comercial e você acompanha a situação aqui.');
      close();
      onSent();
    } catch (err) {
      official.disabled = false;
      toast(err?.message || 'Não consegui enviar agora. Tente de novo.');
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}

/** Cartão "Está curtindo o Fôlego? Indique um amigo" da página de entrega (produtos no Pix). Só gera lead: sem desconto. */
export function referralCard({ onInvite }) {
  const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('plus'), 'Indicar um amigo');
  btn.addEventListener('click', () => {
    openFriendDialog({
      title: 'Indique o Fôlego para um amigo',
      intro: 'Digite o e-mail de quem você acha que vai gostar. Mandamos um convite simpático, dizendo que foi você quem indicou.',
      askName: true,
      note: 'Usamos o e-mail do seu amigo só para enviar este convite. Ele pode pedir para não receber mais nada com um clique.',
      onSubmit: onInvite,
    });
  });
  return card(el('h2', {}, 'Está curtindo o Fôlego?'), el('p', { class: 'muted' }, 'Indique para um amigo. Um recado seu e ele já começa a respirar mais tranquilo.'), el('div', { class: 'button-row no-print' }, btn));
}

/** Aba "Indique e ganhe" do Prumo: link, convite por e-mail, créditos de desconto e histórico. */
export function viewIndicar(ctx) {
  const r = ctx.referrals;
  if (!r.enabled) return card(el('h2', {}, 'Indique e ganhe'), el('p', { class: 'muted' }, 'O programa de indicações está pausado no momento. Volte em breve.'));
  const copy = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('copy'), 'Copiar link');
  copy.addEventListener('click', async () => toast((await copyText(r.link)) ? 'Link copiado.' : 'Não consegui copiar.'));
  const link = el('input', { class: 'input', type: 'text', readonly: true, value: r.link, 'aria-label': 'Seu link de indicação' });
  const invite = el('button', { class: 'btn btn-primary', type: 'button' }, icon('plus'), 'Convidar por e-mail');
  invite.addEventListener('click', () => {
    openFriendDialog({
      title: 'Convide um amigo para o Prumo',
      intro: 'Mandamos um e-mail bonito, em seu nome, com o seu link. Quando a pessoa assinar um plano, você ganha desconto na próxima fatura.',
      note: 'Usamos o e-mail do seu amigo só para este convite. Ele pode pedir para não receber mais nada com um clique.',
      onSubmit: ctx.api.inviteSubscriberFriend,
      onSent: () => ctx.refresh(),
    });
  });
  const whats = el('button', { class: 'btn btn-primary', type: 'button' }, icon('chat'), 'Convidar por WhatsApp');
  whats.addEventListener('click', () => openWhatsAppDialog({ link: r.link, officialEnabled: Boolean(r.whatsappInvite), onSubmit: ctx.api.inviteSubscriberWhatsApp, onSent: () => ctx.refresh() }));
  invite.className = 'btn btn-secondary';
  const next = r.next
    ? el('div', { class: 'note note-green' }, icon('check'), el('span', {}, `Sua próxima fatura vem com ${r.next.percent}% de desconto: ${brl(r.next.valueCents)} em vez de ${brl(r.next.listCents)}. Você tem ${r.next.months} ${r.next.months === 1 ? 'mês' : 'meses'} de desconto acumulado${r.next.months === 1 ? '' : 's'}.`))
    : null;
  const status = { sent: 'Convite enviado', converted: 'Assinou! Desconto ganho' };
  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Indique e ganhe'),
      el('p', {}, `A cada amigo que assinar um plano pelo seu convite, você ganha `, el('strong', {}, `${r.percent}% de desconto na próxima fatura`), '. Os descontos se acumulam: indicou 10 que assinaram, são 10 meses seguidos com desconto.'),
      next,
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'rf-link' }, 'Seu link de indicação'), el('div', { class: 'pix-code-row' }, Object.assign(link, { id: 'rf-link' }), copy)),
      el('div', { class: 'button-row no-print' }, whats, invite),
    ),
    card(
      el('h2', {}, 'Seus números'),
      el('div', { class: 'ref-stats' },
        el('div', {}, el('strong', {}, String(r.invited)), el('span', { class: 'fine muted' }, 'convites enviados')),
        el('div', {}, el('strong', {}, String(r.converted)), el('span', { class: 'fine muted' }, 'amigos assinaram')),
        el('div', {}, el('strong', {}, String(r.credits.available)), el('span', { class: 'fine muted' }, 'meses de desconto disponíveis')),
        el('div', {}, el('strong', {}, String(r.credits.applied)), el('span', { class: 'fine muted' }, 'descontos já aplicados')),
      ),
      r.recent.length
        ? el('ul', { class: 'entries' }, ...r.recent.map((x) => el('li', { class: 'wallet-row' }, el('div', {}, el('strong', {}, x.friend), el('p', { class: 'fine muted' }, `${new Date(x.at).toLocaleDateString('pt-BR')}${x.delivery ? ` · ${x.delivery}` : ''}`)), el('span', { class: `pill ${x.status === 'converted' ? 'tone-ok' : ''}` }, status[x.status] ?? x.status))))
        : el('p', { class: 'muted' }, 'Você ainda não indicou ninguém. Copie o link e mande para quem você acha que vai gostar.'),
      el('p', { class: 'fine muted' }, 'O desconto vale quando o seu amigo assina pela primeira vez e a primeira cobrança é confirmada. Indicar a si mesmo ou a quem já assina não gera desconto.'),
    ),
  );
}
