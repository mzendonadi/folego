import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFromInvoice, cardPaymentHint, detectDocumentKind, invoiceCardChanges, invoiceImportBody, matchInvoiceCard, parseInvoiceDocument } from '../src/invoice.ts';
import { summarizeCard } from '../src/cards.ts';

test('cartão: o pagamento da fatura ANTERIOR não abate a fatura nova (o "pago só uma parte da fatura" que não existia)', () => {
  const card = { closingDay: 9, dueDay: 16, limitCents: 5_000_000 };
  const charges = [{ date: '2026-09-17', amountCents: 900_000, invoiceKey: '2026-10' }];
  const payments = [{ date: '2026-09-10', amountCents: 700_000, invoiceKey: '2026-09' }];
  const official = [
    { key: '2026-09', closingOn: '2026-09-09', dueOn: '2026-09-16', totalCents: 700_000, paidCents: 700_000 },
    { key: '2026-10', closingOn: '2026-10-08', dueOn: '2026-10-16', totalCents: 900_000, paidCents: null },
  ];
  const plans = [{ perCents: 30_000, totalN: 6, postedN: 4, firstOn: '2026-07-27' }]; // compra parcelada 4/6: faltam 2 parcelas
  const s = summarizeCard(card, charges, payments, plans, '2026-10-25', official);
  const sep = s.invoices.find((i) => i.key === '2026-09')!;
  const oct = s.invoices.find((i) => i.key === '2026-10')!;
  assert.deepEqual([sep.status, sep.totalCents, sep.remainingCents], ['paid', 700_000, 0], 'setembro está quitada');
  assert.deepEqual([oct.totalCents, oct.paidCents, oct.remainingCents], [900_000, 0, 900_000], 'outubro continua inteira em aberto');
  assert.equal(oct.dueOn, '2026-10-16');
  assert.equal(s.usedCents, 900_000 + 2 * 30_000, 'fatura em aberto + parcelas que ainda vêm = "limite utilizado" da fatura');
  assert.equal(s.availableCents, 5_000_000 - 960_000, 'bate com o limite disponível que o banco informa');

  // Sem saber de qual fatura é o pagamento (jeito antigo), ele era jogado na única fatura com compras: era o erro.
  const old = summarizeCard(card, charges.map((c) => ({ ...c, invoiceKey: undefined })), payments.map((p) => ({ ...p, invoiceKey: undefined })), plans, '2026-10-25');
  assert.equal(old.invoices.find((i) => i.key === '2026-10')!.paidCents, 700_000);
});

// Fatura sintética (nada de dados reais) com as armadilhas de um layout comum no Brasil: oferta de parcelamento com "Total a Pagar" maior que
// o da fatura, vários finais de cartão, compra em euro/dólar com IOF em linha própria, parcela mostrando a data da compra original e pagamento da fatura anterior.
const FATURA = `
BANCO EXEMPLO S.A. – CNPJ/MF 00.000.000/0001-00
TITULAR EXEMPLO - 5480 XXXX XXXX 3303
Parcele esta fatura até 16/out/26 com taxa de Juros de 15,09 % ao mês com
valor Total a Pagar R$ 13.158,88
Olá, Titular! Esta é a fatura do seu cartão BANCO EXEMPLO ELITE MASTERCARD
contendo compras e pagamentos realizados até 08/10.
TITULAR EXEMPLO - 5480 XXXX XXXX 3303
Total a Pagar
R$ 404,85
Vencimento
16/10/2026
Seu limite é
R$44.060,00
Limite utilizado
R$604,85
Limite Disponível:
R$43.455,15
Histórico de Faturas   Pagamento   Período das compras
AGO.   R$ 900,00   R$900,00   10/07/26 a 10/08/26
SET.
R$ 500,00   R$500,00   11/08/26 a 09/09/26
OUT.   R$ 404,85   Esta Fatura   10/09/26 a 08/10/26
NOV.   R$ 200,00   Fatura Aberta   09/10/26 a 09/11/26
Detalhamento da Fatura
TITULAR EXEMPLO - 5480 XXXX XXXX 3303
Pagamento e Demais Créditos
Compra   Data   Descrição   Parcela   R$   US$
10/09 PAGAMENTO DE FATURA-INTERNET   -500,00
Parcelamentos
Compra   Data   Descrição   Parcela   R$   US$
3   17/07 LOJA TESTE 6   03/03   100,00
Despesas
Compra   Data   Descrição   Parcela   R$   US$
05/10 TARIFA TESTE   10,00
08/10 ANUIDADE DIFERENCIADA   03/12   0,00
VALOR TOTAL   110,00   0,00
@ TITULAR EXEMPLO - 5480 XXXX XXXX 8556
Despesas
09/09 FACEBK *ABC123   35,48 EURO   228,26   41,95
COTAÇÃO DOLAR R$ 5,4412
IOF DESPESA NO EXTERIOR   7,99
10/09 OPENAI   28,31   5,19
COTAÇÃO DOLAR R$ 5,4544
IOF DESPESA NO EXTERIOR   0,99
10/09 OPENAI   28,31   5,19
IOF DESPESA NO EXTERIOR   0,99
VALOR TOTAL   294,85   10,38
Resumo da Fatura
Descrição   R$   US$
Saldo Anterior   500,00
(+) Total Despesas/Débitos no Brasil   119,97
(+) Total Despesas/Débitos no Exterior   284,88   10,38
(-) Total de pagamentos   500,00
(-) Total de créditos   0,00
(=) Saldo Desta Fatura   404,85
`;

test('fatura: identifica o cartão, o limite, o vencimento e o total certo (não o da oferta de parcelamento)', () => {
  const d = parseInvoiceDocument(FATURA, new Date('2026-10-25T12:00:00Z'));
  assert.equal(detectDocumentKind(FATURA), 'fatura');
  assert.equal(d.card.name, 'Banco Exemplo Elite Mastercard');
  assert.equal(d.card.brand, 'mastercard');
  assert.deepEqual(d.card.last4s, ['3303', '8556']);
  assert.equal(d.card.primaryLast4, '3303');
  assert.equal(d.card.limitCents, 4_406_000);
  assert.equal(d.card.usedCents, 60_485);
  assert.equal(d.card.availableCents, 4_345_515);
  assert.equal(d.invoice.key, '2026-10');
  assert.equal(d.invoice.closingOn, '2026-10-08');
  assert.equal(d.invoice.periodStart, '2026-09-10');
  assert.equal(d.invoice.dueOn, '2026-10-16');
  assert.equal(d.invoice.totalCents, 40_485, 'o "valor total a pagar" de 13.158,88 é a oferta de parcelamento, não a fatura');
  assert.equal(d.previousKey, '2026-09');
  assert.deepEqual(cardFromInvoice(d), { name: 'Banco Exemplo Elite Mastercard', brand: 'mastercard', last4: '3303', limitCents: 4_406_000, closingDay: 9, dueDay: 16 });
});

test('fatura: o pagamento do topo quitou a fatura ANTERIOR; as compras desta fatura são só as novas', () => {
  const d = parseInvoiceDocument(FATURA, new Date('2026-10-25T12:00:00Z'));
  assert.deepEqual(d.payments, [{ date: '2026-09-10', amountCents: 50_000, note: 'PAGAMENTO DE FATURA-INTERNET' }]);
  assert.deepEqual(d.refunds, []);
  assert.equal(d.invoice.previousCents, 50_000);
  assert.deepEqual(d.previous, { status: 'quitada', leftCents: 0 });
  assert.deepEqual(d.history.map((h) => [h.key, h.totalCents, h.paidCents, h.state]), [
    ['2026-08', 90_000, 90_000, 'paga'], ['2026-09', 50_000, 50_000, 'paga'], ['2026-10', 40_485, null, 'esta'], ['2026-11', 20_000, null, 'aberta'],
  ]);
  assert.ok(d.check?.ok, `soma das linhas ${d.check?.parsedCents} contra ${d.check?.expectedCents}`);
  assert.equal(d.check?.parsedCents, 40_485);
});

test('fatura: parcela vai para o mês dela, compra em euro traz o IOF somado, linhas iguais não se perdem e anuidade zerada some', () => {
  const d = parseInvoiceDocument(FATURA, new Date('2026-10-25T12:00:00Z'));
  assert.equal(d.entries.length, 5);
  const loja = d.entries.find((e) => e.note === 'LOJA TESTE 6')!;
  assert.deepEqual([loja.installmentNo, loja.installmentTotal, loja.date, loja.amountCents], [3, 3, '2026-09-17', 10_000], 'terceira parcela de uma compra de 17/07: cai em setembro');
  const euro = d.entries.find((e) => e.note.startsWith('FACEBK'))!;
  assert.equal(euro.amountCents, 22_826 + 799, 'R$ 228,26 + IOF 7,99');
  assert.equal(euro.iofCents, 799);
  assert.equal(euro.foreign, '35,48 EURO');
  assert.match(euro.note, /\(35,48 EURO\)/);
  assert.equal(euro.date, '2026-09-09');
  assert.equal(euro.cardLast4, '8556');
  const openai = d.entries.filter((e) => e.note === 'OPENAI');
  assert.equal(openai.length, 2, 'duas compras idênticas no mesmo dia continuam sendo duas');
  assert.ok(openai.every((e) => e.amountCents === 2_831 + 99));
  assert.equal(d.entries.some((e) => /anuidade/i.test(e.note)), false);
  assert.deepEqual(d.byCard, [{ last4: '3303', totalCents: 11_000 }, { last4: '8556', totalCents: 29_485 }]);
});

test('fatura: pagamento parcial do saldo anterior vira diagnóstico, não erro', () => {
  const parcial = FATURA.replace('(-) Total de pagamentos   500,00', '(-) Total de pagamentos   200,00').replace('10/09 PAGAMENTO DE FATURA-INTERNET   -500,00', '10/09 PAGAMENTO DE FATURA-INTERNET   -200,00').replace('(=) Saldo Desta Fatura   404,85', '(=) Saldo Desta Fatura   704,85').replace('R$ 404,85\nVencimento', 'R$ 704,85\nVencimento');
  const d = parseInvoiceDocument(parcial, new Date('2026-10-25T12:00:00Z'));
  assert.equal(d.invoice.totalCents, 70_485);
  assert.deepEqual(d.previous, { status: 'parcial', leftCents: 30_000 });
  assert.ok(d.check?.ok, 'o que sobrou da anterior (300,00) entra na conta: 704,85 − 300,00 = 404,85 de compras');
});

test('documento: reconhece extrato de conta e pagamento de fatura dentro dele', () => {
  const extrato = 'Extrato de conta corrente\nAgência 0001 Conta 12345-6\nSaldo anterior 1.000,00\n10/09 PAGAMENTO DE BOLETO BANCO EXEMPLO -7.000,00\n12/09 PIX RECEBIDO 500,00\nSaldo final 800,00';
  assert.equal(detectDocumentKind(extrato), 'extrato');
  assert.equal(detectDocumentKind('Receita de bolo de cenoura: 3 ovos, 2 xícaras de farinha'), 'desconhecido');
  assert.equal(cardPaymentHint('PAGAMENTO DE FATURA CARTAO ITAU'), 'forte');
  assert.equal(cardPaymentHint('PGTO FATURA MASTERCARD'), 'forte');
  assert.equal(cardPaymentHint('PAGAMENTO DE BOLETO BANCO SANTANDER (BRASIL)'), 'possivel');
  assert.equal(cardPaymentHint('PAGAMENTO DE BOLETO ENERGIA ELETRICA'), null);
  assert.equal(cardPaymentHint('MERCADO CENTRAL'), null);
});

test('fatura: acha o cartão cadastrado pelo final (qualquer um dos da fatura) ou pelo nome, e diz o que mudou no cadastro', () => {
  const d = parseInvoiceDocument(FATURA, new Date('2026-10-25T12:00:00Z'));
  const azul = { id: 'a', name: 'Banco Azul', last4: '1234', limitCents: 500_000, closingDay: 5, dueDay: 12 };
  const elite = { id: 'b', name: 'Elite', last4: '8556', limitCents: 3_000_000, closingDay: 5, dueDay: 10 };
  assert.equal(matchInvoiceCard([azul, elite], d)?.id, 'b', 'o final 8556 é um dos cartões físicos da fatura');
  assert.equal(matchInvoiceCard([azul], d), null, 'cartão que a pessoa ainda não cadastrou');
  assert.equal(matchInvoiceCard([{ ...azul, name: 'Banco Exemplo Elite Mastercard', last4: null }], d)?.id, 'a', 'sem final, pelo nome');
  assert.equal(matchInvoiceCard([{ ...azul, last4: '3303' }, { ...elite, name: 'Cartão B' }], d), null, 'dois cartões da mesma fatura e nenhum nome que desempate: não adivinha');
  assert.equal(matchInvoiceCard([{ ...azul, last4: '3303' }, elite], d)?.id, 'b', 'o nome desempata');
  assert.deepEqual(invoiceCardChanges({ ...elite, last4: null }, d), { limitCents: 4_406_000, closingDay: 9, dueDay: 16, last4: '3303', availableCents: 4_345_515 });
  assert.deepEqual(invoiceCardChanges({ ...elite, limitCents: 4_406_000, closingDay: 9, dueDay: 16, last4: '3303' }, d), { availableCents: 4_345_515 });
});

test('fatura: o corpo da importação leva a fatura, os pagamentos da anterior e só o histórico que já foi pago', () => {
  const d = parseInvoiceDocument(FATURA, new Date('2026-10-25T12:00:00Z'));
  const body = invoiceImportBody(d, { skip: new Set([1]) });
  assert.equal(body.entries.length, 4, 'uma compra desmarcada');
  assert.deepEqual(body.payments, [{ date: '2026-09-10', amountCents: 50_000, note: 'PAGAMENTO DE FATURA-INTERNET' }]);
  assert.equal(body.invoice?.key, '2026-10');
  assert.equal(body.invoice?.previousKey, '2026-09');
  assert.deepEqual(body.invoice?.history.map((h) => [h.key, h.paidCents]), [['2026-08', 90_000], ['2026-09', 50_000]]);
  assert.equal('card' in body, false);
  assert.deepEqual(invoiceImportBody(d, { card: { limitCents: 1 } }).card, { limitCents: 1 });
});

test('documento: o texto que o PDF entrega vem com espaços irregulares e ainda assim é reconhecido', () => {
  const sujo = FATURA.replace(/ /g, '   ').replace(/\n/g, '\n  ');
  assert.equal(detectDocumentKind(sujo), 'fatura');
  assert.equal(cardPaymentHint('PAGAMENTO   DE   FATURA   CARTAO'), 'forte');
  const d = parseInvoiceDocument(sujo, new Date('2026-10-25T12:00:00Z'));
  assert.equal(d.entries.length, 5);
  assert.ok(d.check?.ok);
});
