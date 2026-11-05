// Portal do parceiro > Contatos do Fôlego > Exportar: planilha .xlsx dos contatos enviados ao parceiro, com filtros personalizados.
// Regras: só o parceiro dono das entregas exporta; titular que revogou a autorização NUNCA entra (a lista já o marca como revogado);
// o filtro é validado e aplicado AQUI (o que a tela mostra é só uma prévia); cada exportação vai para a auditoria (quantidade e período, sem dados pessoais).
import { z } from 'zod';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, todaySaoPaulo } from './services.ts';
import { partnerLeads } from './leads.ts';
import { buildXlsx } from './xlsx.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '2020-01-01' && v <= '2100-12-31'; }, 'Data inválida');
const STATUSES = ['delivered', 'contacted', 'converted', 'rejected'] as const;
export const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { delivered: 'Novo', contacted: 'Em contato', converted: 'Contrato fechado', rejected: 'Descartado' };

export const leadExportSchema = z.strictObject({
  /** Período pela data em que o contato foi recebido (dia de São Paulo, inclusive nas duas pontas). */
  from: day.optional(),
  to: day.optional(),
  status: z.array(z.enum(STATUSES)).max(4).default([]),
  uf: z.array(z.string().regex(/^[A-Z]{2}$/)).max(27).default([]),
  income: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  debt: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  deal: z.enum(['todos', 'com', 'sem']).default('todos'),
  q: z.string().trim().max(60).default(''),
});
export type LeadExportFilter = z.infer<typeof leadExportSchema>;

const spDay = (ms: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms));
const brDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const phoneBr = (p: string | null): string => (p && p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p && p.length === 10 ? `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}` : p ?? '');
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = (cents: number): string => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Lead = { id: string; status: string; createdAt: number; commissionBps: number; dealsCount: number; dealsCents: number; revoked: boolean; uf: string | null; incomeBand: string | null; debtBand: string | null; name: string | null; phone: string | null; email: string | null };

/** A regra do filtro mora aqui: o servidor a aplica ao gerar a planilha. */
export function applyLeadFilter(list: Lead[], f: LeadExportFilter): Lead[] {
  const q = fold(f.q);
  const qd = f.q.replace(/\D/g, '');
  return list.filter((l) => {
    if (l.revoked || !l.phone) return false;
    const d = spDay(l.createdAt);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.status.length && !f.status.includes(l.status as (typeof STATUSES)[number])) return false;
    if (f.uf.length && !(l.uf && f.uf.includes(l.uf))) return false;
    if (f.income.length && !(l.incomeBand && f.income.includes(l.incomeBand))) return false;
    if (f.debt.length && !(l.debtBand && f.debt.includes(l.debtBand))) return false;
    if (f.deal === 'com' && l.dealsCount === 0) return false;
    if (f.deal === 'sem' && l.dealsCount > 0) return false;
    if (q && !(fold(l.name ?? '').includes(q) || fold(l.email ?? '').includes(q) || (qd.length >= 3 && (l.phone ?? '').includes(qd)))) return false;
    return true;
  });
}

export async function exportLeadsXlsx(ctx: Ctx, partnerId: string, filter: LeadExportFilter): Promise<{ buffer: Buffer; count: number; filename: string }> {
  if (filter.from && filter.to && filter.to < filter.from) throw new AppError(422, 'invalid_range', 'A data final vem antes da inicial.');
  const all = (await partnerLeads(ctx, partnerId, 5000)) as unknown as Lead[];
  const rows = applyLeadFilter(all, filter);
  if (rows.length === 0) throw new AppError(422, 'nothing_to_export', 'Nenhum contato com esses filtros. Mude o período ou as opções e tente de novo.');
  const label = (s: string) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s;
  const byStatus = STATUSES.map((s) => [label(s), rows.filter((r) => r.status === s).length] as [string, number]);
  const sum = (k: 'dealsCount' | 'dealsCents') => rows.reduce((s, r) => s + r[k], 0);
  const where = [
    filter.from || filter.to ? `Recebidos ${filter.from ? `de ${brDate(filter.from)}` : ''}${filter.to ? ` até ${brDate(filter.to)}` : ''}`.replace(/\s+/g, ' ').trim() : 'Todo o período',
    filter.status.length ? `Situação: ${filter.status.map(label).join(', ')}` : null,
    filter.uf.length ? `UF: ${filter.uf.join(', ')}` : null,
    filter.income.length ? `Renda: ${filter.income.join(', ')}` : null,
    filter.debt.length ? `Dívidas: ${filter.debt.join(', ')}` : null,
    filter.deal !== 'todos' ? (filter.deal === 'com' ? 'Só com contrato fechado' : 'Só sem contrato fechado') : null,
    filter.q ? `Busca: ${filter.q}` : null,
  ].filter(Boolean) as string[];
  const buffer = buildXlsx([
    {
      name: 'Contatos',
      headers: ['Nome', 'Telefone', 'E-mail', 'UF', 'Faixa de renda', 'Faixa de dívidas', 'Situação', 'Recebido em', 'Contratos fechados', 'Volume contratado', 'Comissão do Fôlego (%)'],
      rows: rows.map((r) => [r.name ?? '', phoneBr(r.phone), r.email ?? '', r.uf ?? '', r.incomeBand ?? '', r.debtBand ?? '', label(r.status), brDate(spDay(r.createdAt)), r.dealsCount, r.dealsCents, r.commissionBps / 100]),
      moneyCols: [9],
    },
    {
      name: 'Resumo',
      headers: ['Item', 'Valor'],
      rows: [
        ['Gerado em', brDate(todaySaoPaulo())],
        ...where.map((w, i): [string, string] => [i === 0 ? 'Filtros' : '', w]),
        ['Contatos exportados', rows.length],
        ...byStatus.map(([k, n]): [string, number] => [`  ${k}`, n]),
        ['Contratos fechados', sum('dealsCount')],
        ['Volume contratado', brl(sum('dealsCents'))],
        ['Aviso', 'Dados pessoais autorizados para contato comercial. Use só para isso e apague quando o titular pedir ou revogar.'],
      ],
    },
  ]);
  await audit(ctx.db, `partner:${partnerId}`, 'partner_leads_exported', 'partner', partnerId, { count: rows.length, from: filter.from ?? null, to: filter.to ?? null });
  return { buffer, count: rows.length, filename: `contatos-folego-${todaySaoPaulo()}.xlsx` };
}
