// Trava contra regressão: o pixel da Meta no navegador (D-122) já foi desfeito por engano duas vezes, por commits feitos sobre cópias antigas
// dos arquivos. Se alguma peça sumir, este teste falha e o deploy (publicar.yml roda npm test) não sai.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('pixel da Meta: navegador, eventos, fbp/fbc e CSP continuam no código', () => {
  const need = (file: string, ...parts: string[]): void => {
    const src = read(file);
    for (const part of parts) assert.ok(src.includes(part), `${file} perdeu: ${part} (veja D-122 no DOCUMENTO-OFICIAL.md; atualize a cópia local com git pull antes de editar)`);
  };
  need('apps/web/assets/js/meta-pixel.js', '1085904724208873', 'autoConfig', 'getFbp', 'getFbc');
  need('apps/web/assets/js/consent.js', "from './meta-pixel.js'", 'enablePixel', "track('PageView'");
  need('apps/web/assets/js/checkout.js', "from './meta-pixel.js'", "track('Lead'", "track('InitiateCheckout'");
  need('apps/web/assets/js/main.js', "from './meta-pixel.js'", 'ViewContent');
  need('apps/web/assets/js/api-http.js', 'getFbp');
  need('apps/api/src/capi.ts', 'fbp', "country");
  need('apps/api/src/app.ts', 'eventId', 'FBP_RE');
  need('apps/api/src/security.ts', 'https://connect.facebook.net', 'https://www.facebook.com');
  need('deploy/nginx/folego.conf', 'https://connect.facebook.net', 'https://www.facebook.com');
});
