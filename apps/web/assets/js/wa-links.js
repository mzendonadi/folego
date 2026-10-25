// Links para abrir uma conversa já com a mensagem escrita, escolhendo o aplicativo: WhatsApp ou WhatsApp Business.
// O link comum (wa.me) deixa o celular decidir, e quem tem os dois instalados cai sempre no mesmo. Por isso cada aplicativo tem o seu endereço:
//   Android (Chrome): "intent://" com o pacote do aplicativo (com.whatsapp ou com.whatsapp.w4b); se não estiver instalado, cai no wa.me.
//   iPhone: esquema whatsapp:// (normal) ou whatsapp-smb:// (Business).
//   Computador e outros: wa.me, que abre o WhatsApp Web ou o aplicativo de computador.

/** @param {string} number telefone do WhatsApp do Fôlego, com ou sem símbolos (ex.: "+55 11 91379-2370") */
export function waLinks(number, message) {
  const phone = String(number).replace(/\D/g, '');
  const text = encodeURIComponent(message);
  const web = `https://wa.me/${phone}?text=${text}`;
  const intent = (pkg) => `intent://send/?phone=${phone}&text=${text}#Intent;scheme=whatsapp;package=${pkg};S.browser_fallback_url=${encodeURIComponent(web)};end`;
  return {
    web,
    android: { normal: intent('com.whatsapp'), business: intent('com.whatsapp.w4b') },
    ios: { normal: `whatsapp://send?phone=${phone}&text=${text}`, business: `whatsapp-smb://send?phone=${phone}&text=${text}` },
  };
}

/** 'android', 'ios' ou 'outro' (computador). */
export function platformOf(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints) {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  return 'outro';
}
