import { KIND_LABEL, brl } from './facts.ts';
import type { CaseFacts } from './facts.ts';
import { scriptsCoreSchema } from './schema.ts';
import type { ScriptsCore } from './schema.ts';

export interface AiResult {
  core: ScriptsCore;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ScriptGenerator {
  readonly name: string;
  generate(facts: CaseFacts, feedback: string[]): Promise<AiResult>;
}

const TOOL_NAME = 'entregar_roteiros';

const DEBT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'O mesmo id recebido (ex.: d1).' },
    resumo: { type: 'string' },
    antes_de_ligar: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    abertura: { type: 'string', description: 'O que a pessoa diz nos primeiros segundos da ligação.' },
    argumentos: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
    proposta: { type: 'string', description: 'Como conduzir a proposta usando SOMENTE os valores fornecidos.' },
    mensagem_whatsapp: { type: 'string', description: 'Mensagem pronta para copiar e colar, até 600 caracteres.' },
    evitar: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    se_recusarem: { type: 'string' },
  },
  required: ['id', 'resumo', 'antes_de_ligar', 'abertura', 'argumentos', 'proposta', 'mensagem_whatsapp', 'evitar', 'se_recusarem'],
} as const;

const TOOL = {
  name: TOOL_NAME,
  description: 'Entrega os roteiros de negociação, um por dívida, e dicas gerais.',
  input_schema: {
    type: 'object',
    properties: {
      dividas: { type: 'array', items: DEBT_SCHEMA },
      dicas_gerais: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
    },
    required: ['dividas', 'dicas_gerais'],
  },
} as const;

const SYSTEM = `Você escreve roteiros de negociação de dívidas para pessoas físicas no Brasil, para o serviço Fôlego.
Tom: acolhedor, direto e firme, como uma amiga que entende do assunto. Frases curtas, sem jargão, sem julgamento e sem culpa.
Regras OBRIGATÓRIAS:
1. Use SOMENTE os valores em reais e as porcentagens que aparecem nos dados. NUNCA invente, some, arredonde ou calcule outros números.
2. Escreva os valores exatamente como vieram (ex.: "R$ 1.500,00").
3. Onde precisar citar o credor, escreva exatamente {{credor}} (será substituído depois). Nunca invente nomes.
4. NUNCA cite artigos de lei, súmulas, tribunais ou prazos legais. NUNCA dê conselho jurídico nem prometa resultado ("garanto", "vai conseguir").
5. NUNCA prometa "limpar nome". Não inclua links, e-mails, telefones nem CPF.
6. Não use ameaças. Não sugira mentir ao credor nem esconder informação.
7. Dívidas em dia: o objetivo é reduzir juros, não pedir desconto sobre atraso. Contas essenciais (aluguel, luz, água, financiamento) em atraso: proteger o serviço/moradia e parcelar o atraso.
8. Se o campo "proposta_numerica" for nulo, não cite descontos nem valores de proposta; use apenas os valores dados (saldo, parcela, capacidade mensal).
9. Entregue uma entrada para CADA dívida recebida (mesmo id), e nada além disso.`;

export function buildUserPayload(facts: CaseFacts): string {
  const data = {
    capacidade_mensal_para_todos_os_acordos: facts.capacityCents > 0 ? brl(facts.capacityCents) : null,
    dividas: facts.debts
      .filter((d) => d.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((d) => ({
        id: d.id,
        tipo: KIND_LABEL[d.kind] ?? 'dívida',
        prioridade: d.rank,
        saldo: brl(d.balanceCents),
        parcela_atual: d.monthlyPaymentCents ? brl(d.monthlyPaymentCents) : null,
        juros_mensais_pct: d.monthlyRatePct,
        juros_informados_pelo_usuario: d.rateSource !== 'default',
        em_atraso: d.overdue,
        dias_em_atraso: d.daysOverdue,
        conta_essencial: ['rent', 'utility', 'financing'].includes(d.kind),
        proposta_numerica: d.offer
          ? {
              abertura_a_vista: brl(d.offer.openingCents),
              desconto_abertura_pct: d.offer.openingPct,
              alvo_a_vista: brl(d.offer.targetCents),
              desconto_alvo_pct: d.offer.targetPct,
              limite_a_vista: brl(d.offer.limitCents),
              desconto_limite_pct: d.offer.limitPct,
            }
          : null,
      })),
  };
  return `Escreva os roteiros de negociação para as dívidas abaixo, na ordem de prioridade. Dados (JSON):\n${JSON.stringify(data, null, 2)}`;
}

export interface AnthropicOptions {
  apiKey: string;
  /** Chave sem workspace exige este cabeçalho (ID do workspace, não é segredo). */
  workspaceId?: string | null | undefined;
  model: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Cliente do Claude com saída estruturada (tool use). Só recebe valores e categorias: nenhum dado pessoal. */
export class AnthropicGenerator implements ScriptGenerator {
  readonly name = 'anthropic';
  private readonly o: AnthropicOptions;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicOptions) {
    this.o = options;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generate(facts: CaseFacts, feedback: string[]): Promise<AiResult> {
    const user = buildUserPayload(facts) + (feedback.length > 0 ? `\n\nSua tentativa anterior foi REPROVADA pelos motivos abaixo. Corrija sem repetir esses erros:\n- ${feedback.join('\n- ')}` : '');
    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(this.o.workspaceId ? { 'anthropic-workspace-id': this.o.workspaceId } : {}) },
      body: JSON.stringify({
        model: this.o.model,
        max_tokens: 6000,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 90_000),
    });
    // Nunca registramos o corpo da resposta de erro nem o da resposta: o corpo do pedido só tem valores, mas não vale o risco.
    if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
    const data = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const block = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
    if (!block) throw new Error('anthropic_sem_tool_use');
    const parsed = scriptsCoreSchema.safeParse(block.input);
    if (!parsed.success) throw new Error(`anthropic_formato_invalido: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return { core: parsed.data, model: data.model ?? this.o.model, inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  }
}
