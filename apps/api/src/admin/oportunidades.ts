// Oportunidades de contato por WhatsApp a partir dos diagnósticos: quem tem o perfil com mais chance de consignado
// (renda ≥ R$ 2.500, 18 a 74 anos, CLT por prazo indeterminado, aposentado/pensionista ou servidor) e quem fez o
// diagnóstico mas não comprou o Mapa. Só entra quem deixou celular (no Pix ou no pedido de parceiro) e ainda não foi apagado.
import { decryptText } from '../crypto.ts';
import { fitsPartnerProfile } from '../leads.ts';
import type { Ctx } from '../services.ts';

export type OpportunitySegment = 'prioritario' | 'mapa_pendente' | 'parceiro_sem_mapa';
const MAX_ITEMS = 500;

interface Row {
  id: string; created_at: Date | string; employment_type: string | null; net_income_cents: string | null; age_band: string | null; debt_total_cents: string | null;
  clt: string | null; contact_phone_enc: Buffer | null; lead_phone_enc: Buffer | null; full_name_enc: Buffer | null; paid: boolean; consent: boolean;
}

export interface Opportunity {
  caseId: string;
  name: string | null;
  phone: string;
  source: 'pedido_parceiro' | 'pix';
  segments: OpportunitySegment[];
  employment: string | null;
  ageBand: string | null;
  netIncomeCents: number | null;
  debtTotalCents: number | null;
  createdAt: string;
}

export async function opportunities(ctx: Ctx) {
  const r = await ctx.db.query<Row>(
    `SELECT c.id, c.created_at, c.employment_type, c.net_income_cents, c.age_band, c.debt_total_cents, c.inputs->>'cltContract' AS clt,
            c.contact_phone_enc, lc.phone_enc AS lead_phone_enc, lc.full_name_enc,
            EXISTS (SELECT 1 FROM app.orders o WHERE o.case_id = c.id AND o.status = 'paid') AS paid,
            EXISTS (SELECT 1 FROM app.v_current_consents v WHERE v.case_id = c.id AND v.purpose = 'lead_sharing' AND v.action = 'grant') AS consent
       FROM app.cases c LEFT JOIN app.lead_contacts lc ON lc.case_id = c.id
      WHERE c.status <> 'purged' AND c.product_kind = 'map'
      ORDER BY c.created_at DESC`,
  );
  const dec = (b: Buffer | null) => { try { return b ? decryptText(ctx.config.secret, b) : null; } catch { return null; } };
  const counts = { diagnosticos: r.rows.length, prioritarios: 0, prioritariosComCelular: 0, semMapa: 0, semMapaComCelular: 0, parceiroSemMapa: 0, comCelular: 0 };
  const seen = new Set<string>();
  const items: Opportunity[] = [];
  for (const x of r.rows) {
    const fit = x.employment_type !== null && x.age_band !== null && x.net_income_cents !== null
      && fitsPartnerProfile({ employmentType: x.employment_type, netIncomeCents: Number(x.net_income_cents), ageBand: x.age_band, cltContract: x.clt });
    const segments: OpportunitySegment[] = [];
    if (fit && !x.consent) segments.push('prioritario');
    if (!x.paid) segments.push('mapa_pendente');
    if (x.consent && !x.paid) segments.push('parceiro_sem_mapa');
    const phoneRaw = dec(x.lead_phone_enc) ?? dec(x.contact_phone_enc);
    const phone = phoneRaw ? phoneRaw.replace(/\D/g, '') : '';
    if (fit) counts.prioritarios += 1;
    if (!x.paid) counts.semMapa += 1;
    if (x.consent && !x.paid) counts.parceiroSemMapa += 1;
    if (!phone) continue;
    counts.comCelular += 1;
    if (fit) counts.prioritariosComCelular += 1;
    if (!x.paid) counts.semMapaComCelular += 1;
    if (!segments.length || seen.has(phone) || items.length >= MAX_ITEMS) continue;
    seen.add(phone);
    items.push({
      caseId: x.id,
      name: dec(x.full_name_enc),
      phone,
      source: x.lead_phone_enc ? 'pedido_parceiro' : 'pix',
      segments,
      employment: x.employment_type,
      ageBand: x.age_band,
      netIncomeCents: x.net_income_cents === null ? null : Number(x.net_income_cents),
      debtTotalCents: x.debt_total_cents === null ? null : Number(x.debt_total_cents),
      createdAt: new Date(x.created_at).toISOString(),
    });
  }
  return { counts, items, truncated: items.length >= MAX_ITEMS };
}
