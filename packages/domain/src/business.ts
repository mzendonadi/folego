// Empresa (PJ) dentro do Prumo: categorias, movimentos entre a empresa e o sócio (PF) e leitura do que o texto de um lançamento diz.
// Regra de ouro: os números da empresa NUNCA se misturam com os pessoais. Aqui só ficam as regras puras (sem banco, sem tela).

/** Categorias dos lançamentos da empresa. */
export const BIZ_CATEGORIES = ['receita', 'impostos', 'folha', 'pro_labore', 'lucros', 'fornecedores', 'marketing', 'software', 'aluguel', 'contas', 'transporte', 'taxas', 'dividas', 'aporte', 'retirada', 'outros'] as const;
export type BizCategory = (typeof BIZ_CATEGORIES)[number];

export const BIZ_CATEGORY_LABEL: Record<BizCategory, string> = {
  receita: 'Receita (vendas e serviços)', impostos: 'Impostos e guias', folha: 'Folha e equipe', pro_labore: 'Pró-labore do sócio', lucros: 'Distribuição de lucros',
  fornecedores: 'Fornecedores e compras', marketing: 'Marketing e anúncios', software: 'Software e assinaturas', aluguel: 'Aluguel e espaço', contas: 'Contas (energia, internet, telefone)',
  transporte: 'Transporte e combustível', taxas: 'Tarifas e taxas bancárias', dividas: 'Empréstimos e parcelas', aporte: 'Aporte do sócio', retirada: 'Retirada do sócio', outros: 'Outros',
};

/** Movimento entre a empresa e o sócio (a pessoa física). */
export const BIZ_MOVEMENTS = ['pro_labore', 'lucros', 'aporte', 'retirada'] as const;
export type BizMovement = (typeof BIZ_MOVEMENTS)[number];

export const BIZ_MOVEMENT_LABEL: Record<BizMovement, string> = {
  pro_labore: 'Pró-labore (empresa paga o sócio)', lucros: 'Distribuição de lucros (empresa paga o sócio)',
  aporte: 'Aporte (sócio coloca dinheiro na empresa)', retirada: 'Retirada (sócio tira dinheiro da empresa)',
};

export interface MovementRule {
  /** Sinal do lançamento na empresa: +1 entra dinheiro, -1 sai. */
  bizSign: 1 | -1;
  bizCategory: BizCategory;
  /** Sinal do lado pessoal. */
  pfSign: 1 | -1;
  /** true = o lado pessoal é RENDA (entra em "Entrou"); false = é só transferência entre o bolso do sócio e a empresa (não é renda nem gasto). */
  pfIsIncome: boolean;
  pfNote: string;
  bizNote: string;
}

/**
 * Como cada movimento aparece nos dois lados.
 * Pró-labore e lucros são renda de quem recebe; aporte e retirada são transferência (o dinheiro continua do sócio), por isso
 * não inflam a renda nem o gasto pessoal.
 */
export function movementRule(m: BizMovement): MovementRule {
  switch (m) {
    case 'pro_labore': return { bizSign: -1, bizCategory: 'pro_labore', pfSign: 1, pfIsIncome: true, pfNote: 'Empresa: pró-labore', bizNote: 'Pró-labore do sócio' };
    case 'lucros': return { bizSign: -1, bizCategory: 'lucros', pfSign: 1, pfIsIncome: true, pfNote: 'Empresa: distribuição de lucros', bizNote: 'Distribuição de lucros ao sócio' };
    case 'aporte': return { bizSign: 1, bizCategory: 'aporte', pfSign: -1, pfIsIncome: false, pfNote: 'Aporte na empresa', bizNote: 'Aporte do sócio' };
    case 'retirada': return { bizSign: -1, bizCategory: 'retirada', pfSign: 1, pfIsIncome: false, pfNote: 'Retirada da empresa', bizNote: 'Retirada do sócio' };
  }
}

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O texto de um lançamento fala de um movimento entre a empresa e o sócio? (pró-labore, lucros, aporte, retirada) */
export function detectBizMovement(note: string): BizMovement | null {
  const t = fold(note);
  if (/pro.?labore/.test(t)) return 'pro_labore';
  if (/(distribuicao|dist\.?)\s*(de\s*)?lucros?|lucros?\s*distribu/.test(t)) return 'lucros';
  if (/(aporte|integralizacao|capital social|emprestimo (do |de )?socio|adiantamento (do |de )?socio)/.test(t)) return 'aporte';
  if (/(retirada|saque (do )?socio|reembolso (ao |do )?socio)/.test(t)) return 'retirada';
  return null;
}

/** Lembra uma empresa pelo nome (LTDA, EIRELI, MEI, S/A...): serve para sugerir "isso veio da sua empresa?" nos lançamentos pessoais. */
export const looksLikeCompany = (note: string): boolean => /\b(ltda|eireli|mei|s\/a|s\.a\.?|epp)\b/.test(fold(note));

const BIZ_RULES: Array<[BizCategory, RegExp]> = [
  ['impostos', /(\bdas\b|simples nacional|darf|imposto|\biss\b|icms|\binss\b|fgts|\bgps\b|guia|tributo)/],
  ['folha', /(folha|salario|funcionario|colaborador|13o|decimo terceiro|ferias|vale refeicao|vale alimentacao|beneficio)/],
  ['marketing', /(google ads|facebook ads|meta ads|ads\d|anuncio|publicidade|marketing|instagram|tiktok ads|impulsion)/],
  ['software', /(software|saas|assinatura|\baws\b|azure|google workspace|notion|slack|zoom|github|hostgator|dominio|hospedagem|licenca|microsoft|adobe|canva)/],
  ['aluguel', /(aluguel|coworking|condominio|iptu)/],
  ['contas', /(energia|\bluz\b|internet|telefone|\bagua\b|celular|vivo|claro|\btim\b)/],
  ['transporte', /(uber|99app|combustivel|posto|gasolina|pedagio|estacionamento|frete|motoboy)/],
  ['taxas', /(tarifa|taxa|\biof\b|anuidade|mensalidade (do )?banco|manutencao de conta|juros)/],
  ['dividas', /(emprestimo|financiamento|parcela|consignado|cheque especial|capital de giro)/],
  ['fornecedores', /(fornecedor|material|estoque|compra de|mercadoria|insumo)/],
];

/** Categoria sugerida para um lançamento da empresa a partir do texto e do sinal do valor (entrada = receita, salvo movimento do sócio). */
export function categorizeBiz(note: string, amountCents: number): BizCategory {
  const m = detectBizMovement(note);
  if (m) return movementRule(m).bizCategory;
  if (amountCents > 0) return 'receita';
  const t = fold(note);
  for (const [cat, re] of BIZ_RULES) if (re.test(t)) return cat;
  return 'outros';
}

/** O que é transferência interna da empresa (não é receita nem despesa): pagamento de fatura de cartão e aplicação financeira. */
export const BIZ_TRANSFER_KINDS = ['card_payment', 'investment'] as const;
export type BizTransferKind = (typeof BIZ_TRANSFER_KINDS)[number];

/** Limites por plano: Ousado tem uma conta e um cartão da empresa; Desbravador, quantos precisar (com um teto de segurança). */
export function businessLimits(multi: boolean): { wallets: number; cards: number } {
  return multi ? { wallets: 30, cards: 30 } : { wallets: 1, cards: 1 };
}
