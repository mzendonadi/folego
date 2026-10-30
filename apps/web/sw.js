// Service worker do Prumo instalado no celular. Faz duas coisas: mostrar a notificação que o servidor manda e,
// ao tocar nela, abrir o app na tela certa. Não guarda nada em cache (o site continua sempre atualizado).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// Passa tudo direto para a rede (sem cache). Existe só porque alguns Chrome/Android exigem um fetch handler para
// oferecer "Instalar app" (WebAPK, com o nome e o ícone do manifesto) em vez de um simples atalho do site.
self.addEventListener('fetch', () => {});

// Só abrimos telas da própria conta: o endereço vem do servidor, mas nunca confiamos em algo fora de /conta.
const safeUrl = (u) => (typeof u === 'string' && /^\/conta(\/[a-z]+)?$/.test(u) ? u : '/conta');

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  // Toda notificação recebida precisa aparecer (no iPhone, receber sem mostrar faz o sistema cancelar a permissão).
  event.waitUntil(
    self.registration.showNotification(typeof d.title === 'string' && d.title ? d.title : 'Prumo Finanças', {
      body: typeof d.body === 'string' ? d.body : '',
      icon: '/assets/icon-192.png?v=3', // o "P" oficial do Prumo (o ?v= faz o Android largar o ícone antigo em cache)
      badge: '/assets/badge-96.png?v=3', // silhueta do "P" (a barra de status só usa a forma, em branco)
      tag: typeof d.tag === 'string' ? d.tag : undefined,
      lang: 'pt-BR',
      data: { url: safeUrl(d.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine) {
        await mine.focus();
        // Chrome/Android navegam a janela aberta; onde isso não existe (iOS), abre uma nova já na tela certa.
        if ('navigate' in mine) {
          try { await mine.navigate(url); return; } catch { /* cai no openWindow */ }
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
