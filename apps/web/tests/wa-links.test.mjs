import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waLinks, platformOf } from '../assets/js/wa-links.js';

test('links do WhatsApp: cada aplicativo tem o seu endereço, com a mensagem pronta', () => {
  const l = waLinks('+55 11 91379-2370', 'VINCULAR AB3K9X');
  assert.equal(l.web, 'https://wa.me/5511913792370?text=VINCULAR%20AB3K9X');
  assert.match(l.android.normal, /^intent:\/\/send\/\?phone=5511913792370&text=VINCULAR%20AB3K9X#Intent;scheme=whatsapp;package=com\.whatsapp;/);
  assert.match(l.android.business, /package=com\.whatsapp\.w4b;/);
  assert.ok(l.android.business.endsWith(`S.browser_fallback_url=${encodeURIComponent(l.web)};end`), 'sem o aplicativo instalado, cai no link comum');
  assert.equal(l.ios.normal, 'whatsapp://send?phone=5511913792370&text=VINCULAR%20AB3K9X');
  assert.equal(l.ios.business, 'whatsapp-smb://send?phone=5511913792370&text=VINCULAR%20AB3K9X');
});

test('plataforma: reconhece Android, iPhone, iPad moderno e computador', () => {
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/126', 'Linux armv81', 5), 'android');
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari', 'iPhone', 5), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 5), 'ios', 'iPad que se apresenta como Mac');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126', 'Win32', 0), 'outro');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 0), 'outro', 'Mac de verdade');
});
