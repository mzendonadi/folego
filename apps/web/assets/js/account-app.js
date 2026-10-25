// Prumo como app no celular: instalar na tela inicial (sem loja) e receber lembretes por notificação.
// Android/Chrome oferece o botão de instalar sozinho; iPhone não: lá a pessoa adiciona pela folha "Compartilhar" e só então as notificações existem (iOS 16.4+).
import { el, icon, toast } from './dom.js';

let deferredPrompt = null;
const listeners = new Set();
// O navegador dispara isto cedo, antes de a pessoa chegar à conta: guarda o convite para usar quando ela clicar.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((f) => f());
});

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registra o service worker (necessário para instalar e para receber notificações). Falhar não atrapalha nada. */
export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

const keyBytes = (b64url) => {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Pede a permissão, cria a inscrição no navegador e entrega ao servidor. Devolve 'denied' se a pessoa não permitiu. */
async function enablePush(api, state) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) }));
  const json = sub.toJSON();
  await api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return 'ok';
}

const HOURS = [8, 9, 10, 12, 18, 19, 20, 21];

/** Cartão "Prumo no seu celular" (aba Perfil): instalar + notificações. */
export function appCard(ctx) {
  const box = el('section', { class: 'card d-section app-card' });
  let drawn = false;
  const redraw = () => draw().catch(() => {});
  listeners.add(redraw);

  async function draw() {
    if (drawn && !box.isConnected) { listeners.delete(redraw); return; } // a pessoa saiu da aba
    drawn = true;
    const standalone = isStandalone();
    const state = await ctx.api.getPush().catch(() => null);
    const local = await currentSubscription();
    const parts = [el('h2', {}, 'Prumo no seu celular'), el('p', { class: 'muted' }, 'Instale o Prumo como um app, sem loja: ele ganha um ícone na tela inicial e abre direto na sua conta.')];

    // ---- instalar ----
    if (standalone) {
      parts.push(el('p', { class: 'note note-ok' }, icon('check'), el('span', {}, 'O Prumo já está instalado neste aparelho.')));
    } else if (deferredPrompt) {
      const b = el('button', { class: 'btn btn-primary', type: 'button' }, 'Instalar no celular');
      b.addEventListener('click', async () => {
        const p = deferredPrompt;
        if (!p) return;
        deferredPrompt = null;
        await p.prompt();
        await p.userChoice.catch(() => null);
        redraw();
      });
      parts.push(b);
    } else if (isIos()) {
      parts.push(el('div', { class: 'app-steps' }, el('strong', {}, 'No iPhone ou iPad:'), el('ol', {}, el('li', {}, 'Abra esta página no Safari.'), el('li', {}, 'Toque em Compartilhar (o quadrado com uma seta para cima).'), el('li', {}, 'Escolha "Adicionar à Tela de Início" e confirme.'), el('li', {}, 'Abra o Prumo pelo ícone novo para ativar as notificações.'))));
    } else {
      parts.push(el('div', { class: 'app-steps' }, el('strong', {}, 'No Android:'), el('ol', {}, el('li', {}, 'Abra o menu do navegador (os três pontinhos).'), el('li', {}, 'Toque em "Instalar app" ou "Adicionar à tela inicial".'))));
    }

    // ---- notificações ----
    if (state?.available) {
      parts.push(el('h3', {}, 'Lembretes por notificação'));
      if (!pushSupported()) {
        parts.push(el('p', { class: 'muted' }, isIos() && !standalone ? 'No iPhone, as notificações só funcionam depois de instalar o Prumo na Tela de Início (iOS 16.4 ou mais novo).' : 'Este navegador não permite notificações. Instale o app pelo Chrome (Android) ou pelo Safari (iPhone).'));
      } else if (Notification.permission === 'denied') {
        parts.push(el('p', { class: 'muted' }, 'As notificações estão bloqueadas neste aparelho. Libere nas configurações do navegador (ou do app) e volte aqui.'));
      } else if (!local) {
        const b = el('button', { class: 'btn btn-primary', type: 'button' }, 'Ativar notificações neste aparelho');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            toast((await enablePush(ctx.api, state)) === 'ok' ? 'Notificações ativadas.' : 'Sem permissão, as notificações continuam desligadas.');
          } catch {
            toast('Não consegui ativar agora. Tente de novo.');
          }
          redraw();
        });
        parts.push(el('p', { class: 'muted' }, 'Você escolhe o que receber e pode desligar quando quiser. Só avisamos entre 8h e 22h.'), b);
      } else {
        const j = local.toJSON();
        if (state.devices === 0) await ctx.api.subscribePush({ endpoint: j.endpoint, keys: j.keys }).catch(() => {}); // o servidor esqueceu este aparelho: reenvia
        const pref = (id, label, hint, on, key) => {
          const input = el('input', { type: 'checkbox', id });
          input.checked = on;
          input.addEventListener('change', async () => {
            try { await ctx.api.savePushPrefs({ [key]: input.checked }); toast('Salvo.'); } catch { input.checked = !input.checked; toast('Não consegui salvar agora.'); }
          });
          return el('div', { class: 'pref-row' }, el('div', { class: 'check' }, input, el('label', { for: id }, el('strong', {}, label), el('span', { class: 'fine muted' }, ` ${hint}`))));
        };
        const hour = el('select', { class: 'input', id: 'push-hour', 'aria-label': 'Hora do lembrete de despesas' }, ...HOURS.map((h) => el('option', { value: String(h) }, `${h}h`)));
        hour.value = String(HOURS.includes(state.prefs.hour) ? state.prefs.hour : 20);
        hour.addEventListener('change', async () => {
          try { await ctx.api.savePushPrefs({ hour: Number(hour.value) }); toast('Horário salvo.'); } catch { toast('Não consegui salvar agora.'); }
        });
        const test = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Enviar notificação de teste');
        test.addEventListener('click', async () => {
          test.disabled = true;
          try { await ctx.api.testPush(); toast('Enviei. Deve chegar em instantes.'); } catch (e) { toast(e?.message || 'Não consegui enviar o teste.'); }
          test.disabled = false;
        });
        const off = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Desativar neste aparelho');
        off.addEventListener('click', async () => {
          off.disabled = true;
          try {
            await ctx.api.unsubscribePush({ endpoint: j.endpoint });
            await local.unsubscribe();
            toast('Notificações desligadas neste aparelho.');
          } catch { toast('Não consegui desligar agora.'); }
          redraw();
        });
        parts.push(
          el('p', { class: 'note note-ok' }, icon('check'), el('span', {}, 'Notificações ativas neste aparelho.')),
          pref('push-despesas', 'Lançar despesas do dia', 'Um lembrete por dia, só se você ainda não lançou nada.', state.prefs.expenses, 'expenses'),
          el('div', { class: 'field' }, el('label', { class: 'label', for: 'push-hour' }, 'Hora do lembrete de despesas'), hour),
          pref('push-metas', 'Metas', 'Aos domingos, para lembrar do seu próximo aporte.', state.prefs.goals, 'goals'),
          pref('push-contas', 'Contas a vencer', 'Quando uma conta dos Lembretes está perto do vencimento.', state.prefs.bills, 'bills'),
          el('div', { class: 'row-actions' }, test, off),
        );
      }
    }
    box.replaceChildren(...parts);
  }
  redraw();
  return box;
}

/** Convite curto no topo de Coach e Visão geral: some ao instalar ou ao dispensar. */
export function installBanner(goTab) {
  let dismissed = false;
  try { dismissed = localStorage.getItem('prumo_app_convite') === '1'; } catch { dismissed = false; }
  if (dismissed || isStandalone()) return null;
  const mobile = window.matchMedia('(max-width: 900px)').matches || navigator.maxTouchPoints > 0;
  if (!mobile) return null;
  const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Instalar no celular');
  const x = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Agora não');
  const box = el('aside', { class: 'card d-section app-invite' }, el('strong', {}, 'Leve o Prumo no bolso'), el('p', { class: 'muted' }, 'Instale como app (sem loja) e receba lembretes para lançar suas despesas e não perder contas.'), el('div', { class: 'row-actions' }, go, x));
  go.addEventListener('click', async () => {
    if (deferredPrompt) {
      const p = deferredPrompt;
      deferredPrompt = null;
      await p.prompt();
      await p.userChoice.catch(() => null);
      box.remove();
    } else {
      goTab('perfil');
    }
  });
  x.addEventListener('click', () => {
    try { localStorage.setItem('prumo_app_convite', '1'); } catch { /* sem armazenamento: o convite volta na próxima visita */ }
    box.remove();
  });
  return box;
}
