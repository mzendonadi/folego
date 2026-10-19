// Oportunidades enviadas aos parceiros: quem autorizou falar com um parceiro e em que ponto está o envio automático
// (a integração com o parceiro é direta, por webhook assinado, feita pelo worker; aqui só se acompanha).
import { decryptText } from '../crypto.ts';
import type { Ctx } from '../services.ts';

export type DeliveryState = 'pendente' | 'tentando' | 'enviado' | 'falhou' | 'contatado' | 'contratado' | 'recusado' | 'sem_parceiro';
const MAX_ITEMS = 500;
const MAX_ATTEMPTS = 5; // mesmo limite do envio (leads.ts)

interface DeliveryRow {
  id: string; status: string; attempts: number; last_response_code: number | null; created_at: Date | string; delivered_at: Date | string | null;
  legal_name: string; trade_name: string | null; campaign: string; category: string; full_name_enc: Buffer | null; phone_enc: Buffer | null;
  employment_type: string | null; income_band: string | null; age_band: string | null; uf: string | null; debt_band: string | null;
}
interface PendingRow {
  case_id: string; created_at: Date | string; full_name_enc: Buffer; phone_enc: Buffer;
  employment_type: string | null; income_band: string | null; age_band: string | null; uf: string | null; debt_band: string | null;
}

export interface Opportunity {
  id: string;
  name: string | null;
  phone: string | null; // mascarado: só os 4 últimos dígitos
  partner: string | null;
  campaign: string | null;
  category: string | null;
  state: DeliveryState;
  attempts: number;
  httpCode: number | null;
  employment: string | null;
  incomeBand: string | null;
  ageBand: string | null;
  uf: string | null;
  debtBand: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export function stateOf(status: string, attempts: number): DeliveryState {
  switch (status) {
    case 'queued': return attempts > 0 ? 'tentando' : 'pendente';
    case 'failed': return attempts >= MAX_ATTEMPTS ? 'falhou' : 'tentando';
    case 'delivered': return 'enviado';
    case 'contacted': return 'contatado';
    case 'converted': return 'contratado';
    default: return 'recusado';
  }
}

const iso = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null);

export async function opportunities(ctx: Ctx) {
  const dec = (b: Buffer | null) => { try { return b ? decryptText(ctx.config.secret, b) : null; } catch { return null; } };
  const mask = (p: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(${d.slice(0, 2)}) •••• ${d.slice(-4)}` : null; };

  const sent = await ctx.db.query<DeliveryRow>(
    `SELECT d.id, d.status, d.attempts, d.last_response_code, d.created_at, d.delivered_at, p.legal_name, p.trade_name, c.name AS campaign, c.consent_category AS category,
            lc.full_name_enc, lc.phone_enc, lp.employment_type, lp.income_band, lp.age_band, lp.uf, lp.debt_band
       FROM app.lead_deliveries d
       JOIN app.partners p ON p.id = d.partner_id
       JOIN app.partner_campaigns c ON c.id = d.campaign_id
       LEFT JOIN app.lead_contacts lc ON lc.case_id = d.case_id
       LEFT JOIN app.lead_profiles lp ON lp.case_id = d.case_id
      WHERE NOT p.internal
      ORDER BY d.created_at DESC LIMIT ${MAX_ITEMS}`,
  );
  // Autorizaram o contato mas nenhuma campanha de parceiro serviu ao perfil (ou ainda não houve envio).
  const waiting = await ctx.db.query<PendingRow>(
    `SELECT lc.case_id, lc.created_at, lc.full_name_enc, lc.phone_enc, lp.employment_type, lp.income_band, lp.age_band, lp.uf, lp.debt_band
       FROM app.lead_contacts lc
       JOIN app.v_current_consents v ON v.case_id = lc.case_id AND v.purpose = 'lead_sharing' AND v.action = 'grant'
       LEFT JOIN app.lead_profiles lp ON lp.case_id = lc.case_id
      WHERE NOT EXISTS (SELECT 1 FROM app.lead_deliveries d WHERE d.case_id = lc.case_id)
      ORDER BY lc.created_at DESC LIMIT 200`,
  );

  const items: Opportunity[] = [
    ...sent.rows.map((x): Opportunity => ({
      id: x.id, name: dec(x.full_name_enc), phone: mask(dec(x.phone_enc)), partner: x.trade_name ?? x.legal_name, campaign: x.campaign, category: x.category,
      state: stateOf(x.status, x.attempts), attempts: x.attempts, httpCode: x.last_response_code,
      employment: x.employment_type, incomeBand: x.income_band, ageBand: x.age_band, uf: x.uf, debtBand: x.debt_band, createdAt: iso(x.created_at)!, deliveredAt: iso(x.delivered_at),
    })),
    ...waiting.rows.map((x): Opportunity => ({
      id: x.case_id, name: dec(x.full_name_enc), phone: mask(dec(x.phone_enc)), partner: null, campaign: null, category: null,
      state: 'sem_parceiro', attempts: 0, httpCode: null,
      employment: x.employment_type, incomeBand: x.income_band, ageBand: x.age_band, uf: x.uf, debtBand: x.debt_band, createdAt: iso(x.created_at)!, deliveredAt: null,
    })),
  ];
  const counts: Record<DeliveryState | 'total', number> = { total: items.length, pendente: 0, tentando: 0, enviado: 0, falhou: 0, contatado: 0, contratado: 0, recusado: 0, sem_parceiro: 0 };
  for (const i of items) counts[i.state] += 1;
  return { counts, items, truncated: sent.rows.length >= MAX_ITEMS };
}
