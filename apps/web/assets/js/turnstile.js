// Cloudflare Turnstile (anti-robô). Só entra em ação se o servidor informar a chave pública em /api/features.
// Modo "interaction-only": quase sempre invisível; só mostra a caixinha se o Cloudflare desconfiar.
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptReady = null;

function loadScript() {
  scriptReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile_script'));
    document.head.append(s);
  });
  return scriptReady;
}

/** Devolve o cabeçalho com um token novo (cada token vale uma vez) ou {} se o recurso está desligado/indisponível. */
export async function turnstileHeaders(siteKey) {
  if (!siteKey) return {};
  try {
    await loadScript();
  } catch {
    return {};
  }
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'ts-box';
    document.body.append(box);
    let id = null;
    const done = (headers) => {
      clearTimeout(timer);
      setTimeout(() => {
        try {
          if (id !== null) window.turnstile.remove(id);
        } catch {
          /* já removido */
        }
        box.remove();
      }, 0);
      resolve(headers);
    };
    const timer = setTimeout(() => done({}), 25_000);
    id = window.turnstile.render(box, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: (token) => done({ 'x-turnstile': token }),
      'error-callback': () => done({}),
    });
  });
}
