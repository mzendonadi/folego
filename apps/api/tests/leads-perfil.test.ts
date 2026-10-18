import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitsPartnerProfile } from '../src/leads.ts';

const base = { employmentType: 'public_servant', netIncomeCents: 250_000, ageBand: '35-44', cltContract: null };

test('perfil prioritário: renda a partir de R$ 2.500, 18 a 74 anos e vínculo estável', () => {
  assert.equal(fitsPartnerProfile(base), true, 'servidor com exatamente R$ 2.500 entra');
  assert.equal(fitsPartnerProfile({ ...base, netIncomeCents: 249_999 }), false, 'um centavo abaixo não entra');
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'inss_retiree', ageBand: '65-74' }), true, 'aposentado/pensionista de 65 a 74 entra');
  assert.equal(fitsPartnerProfile({ ...base, ageBand: '75+' }), false, '75 anos ou mais fica de fora');
  assert.equal(fitsPartnerProfile({ ...base, ageBand: '18-24' }), true);
});

test('perfil prioritário: CLT só com prazo indeterminado; autônomo/MEI e outra situação ficam de fora', () => {
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'clt', cltContract: 'permanent' }), true);
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'clt', cltContract: 'temporary' }), false, 'CLT temporário não entra');
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'clt', cltContract: null }), false, 'CLT sem informar o contrato não entra');
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'self_employed' }), false);
  assert.equal(fitsPartnerProfile({ ...base, employmentType: 'other' }), false);
});
