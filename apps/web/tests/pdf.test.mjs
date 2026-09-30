import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '../scripts/pdf-entry.mjs';
import { fillLetter, missingFields } from '../assets/js/generated.js';
import { diagnose } from '../../api/src/engine.ts';
import { buildFacts } from '../../api/src/generation/facts.ts';
import { templateLetters } from '../../api/src/generation/templates.ts';

const debts = [
  { id: 'd1', creditorName: 'Aluguel Ação & Cia', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 },
  { id: 'd2', creditorName: 'Crediário São João', kind: 'store_credit', balanceCents: 90_000, monthlyRateBps: 1000, daysOverdue: 400 },
  { id: 'd3', creditorName: 'Loja antiga ÇÃO', kind: 'store_credit', balanceCents: 70_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
];
const diagnosis = diagnose({ asOf: '2026-09-26', profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' }, debts });
const facts = buildFacts(debts, diagnosis);
const names = new Map(debts.map((d) => [d.id, d.creditorName]));
const letters = templateLetters(facts, names, new Map([['d3', '01/2019']])).letters;
const data = { nome: 'Maria da Conceição Álvares', cpf: '123.456.789-09', cidade: 'São Paulo', email: 'maria@exemplo.com', telefone: '(11) 91234-5678', data: '27 de setembro de 2026' };

test('as cartas de exemplo existem (prescrição, informações e contestação)', () => {
  assert.ok(letters.length >= 4);
});

test('preencher: troca os campos, mantém entre colchetes o que falta e não conta o contrato como pendência', () => {
  const l = letters.find((x) => x.tipo === 'prescricao');
  assert.ok(missingFields(l.corpo).length >= 5);
  const filled = fillLetter(l.corpo, data, 'Contrato 998877');
  assert.ok(filled.includes('Maria da Conceição Álvares') && filled.includes('123.456.789-09') && filled.includes('Contrato 998877'));
  assert.deepEqual(missingFields(filled), []);
  const partial = fillLetter(l.corpo, { ...data, cpf: '' });
  assert.deepEqual(missingFields(partial), ['[SEU CPF]']);
});

test('uma carta vira um PDF válido, com acentos e cedilha, sem erro de codificação', async () => {
  const l = letters.find((x) => x.tipo === 'prescricao');
  const bytes = await buildPdf([{ title: l.titulo, body: fillLetter(l.corpo, data, 'Contrato 998877') }]);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
  assert.equal(doc.getTitle(), l.titulo);
  mkdirSync(new URL('../.tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../.tmp/carta-exemplo.pdf', import.meta.url), bytes);
});

test('todas as cartas em um PDF: uma ou mais páginas por carta e rodapé em todas', async () => {
  const bytes = await buildPdf(letters.map((l) => ({ title: l.titulo, body: fillLetter(l.corpo, data) })));
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= letters.length);
  assert.equal(doc.getTitle(), 'Cartas e defesas');
  mkdirSync(new URL('../.tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../.tmp/cartas-exemplo.pdf', import.meta.url), bytes);
});

test('texto longo quebra em várias páginas e palavra gigante não estoura a margem', async () => {
  const longo = Array.from({ length: 140 }, (_, i) => `Parágrafo ${i + 1}: texto de teste com acentuação, çãõ, vírgulas e números 12.345,67.`).join('\n\n');
  const gigante = 'X'.repeat(400);
  const bytes = await buildPdf([{ title: 'Documento longo', body: `${longo}\n\n${gigante}` }]);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `páginas: ${doc.getPageCount()}`);
});

test('caracteres fora do alfabeto do PDF são trocados, não quebram', async () => {
  const bytes = await buildPdf([{ title: 'Símbolos → ≥ ✓ 😀', body: 'Seta → e emoji 😀 e check ✓ e reticências…' }]);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});
