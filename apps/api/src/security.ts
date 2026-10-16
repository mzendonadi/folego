/**
 * Política de segurança de conteúdo do site. A MESMA string deve ir no Nginx (deploy/nginx/folego.conf).
 * Sem scripts inline, sem terceiros; estilos inline só em atributos (largura de barras e afins).
 * 'wasm-unsafe-eval': só libera compilar/rodar WebAssembly (o motor de OCR do Tradutor de Cobrança e,
 * possivelmente, o pdf.js); NÃO libera eval/Function de JavaScript comum, então não abre brecha de XSS.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://cdn.pluggy.ai",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.pluggy.ai",
  "frame-src https://challenges.cloudflare.com https://connect.pluggy.ai",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
