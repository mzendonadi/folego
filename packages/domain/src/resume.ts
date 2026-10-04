// Currículo por vaga: lê o anúncio da vaga, cruza com o que a pessoa JÁ fez e monta o conteúdo do currículo sob medida.
// Regras da casa: (1) só usa o que a pessoa informou (nunca inventa experiência, curso ou número); (2) NÃO recebe nome, telefone,
// e-mail nem endereço: esses dados ficam no navegador e só entram na hora de montar o arquivo; (3) cálculo puro, sem IA e sem rede.

export type Level = 'entrada' | 'pleno' | 'senior';

export interface ResumeExperience {
  role: string;
  years: number;
  /** O que fazia, uma tarefa por linha (ou separadas por ponto e vírgula). */
  tasks: string;
}

export interface ResumeInput {
  targetRole: string;
  level: Level;
  jobText: string;
  skills: string;
  education: string;
  languages: string;
  experiences: ResumeExperience[];
}

export const MAX_JOB_CHARS = 4000;

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// competências conhecidas: [rótulo exibido, padrão sobre texto sem acento e minúsculo]
const HARD: [string, RegExp][] = [
  ['Excel', /\bexcel\b/], ['Power BI', /power ?bi/], ['SQL', /\bsql\b/], ['Python', /\bpython\b/], ['JavaScript', /\bjavascript\b/], ['Java', /\bjava\b(?!script)/],
  ['SAP', /\bsap\b/], ['CRM', /\bcrm\b/], ['Pacote Office', /pacote office|\bword\b|powerpoint/], ['Atendimento ao cliente', /atendimento/],
  ['Vendas', /\bvendas?\b|vendedor|comercial/], ['Negociação', /negocia[cç]ao|negociar/], ['Cobrança', /cobran[cç]a/], ['Estoque', /estoque|invent[aá]rio/],
  ['Logística', /log[ií]stica|expedi[cç]ao|recebimento/], ['Contabilidade', /contabil|contador/], ['Rotinas fiscais', /fiscal|nota fiscal|\bnf-?e\b|tributa/],
  ['Folha de pagamento', /folha de pagamento|departamento pessoal/], ['Financeiro', /contas a (pagar|receber)|concilia[cç]ao|fluxo de caixa|financeiro/],
  ['Recepção', /recep[cç]ao|recepcionista/], ['Operação de empilhadeira', /empilhadeira/], ['CNH', /\bcnh\b|habilita[cç]ao/], ['Inglês', /ingl[eê]s|english/],
  ['Espanhol', /espanhol/], ['Redes sociais', /redes sociais|instagram|social media/], ['Atendimento por chat e telefone', /\bchat\b|telefone|telemarketing|call center|sac\b/],
  ['Controle de qualidade', /qualidade|\biso\b/], ['Segurança do trabalho', /\bnr-?\d+|seguran[cç]a do trabalho|\bepi\b/], ['Cozinha e alimentos', /cozinh|alimento|manipula[cç]ao/],
  ['Enfermagem', /enfermag|t[eé]cnico de enfermagem|\bcoren\b/], ['Manutenção', /manuten[cç]ao|mec[aâ]nic|el[eé]tric/], ['Limpeza', /limpeza|conserva[cç]ao|higieniza/],
];
const SOFT: [string, RegExp][] = [
  ['Comunicação', /comunica[cç]ao|comunicativ/], ['Trabalho em equipe', /equipe|trabalho em grupo|colabora/], ['Proatividade', /proativ|iniciativa/], ['Organização', /organiza[cç]ao|organizad/],
  ['Liderança', /lideran[cç]a|liderar|gest[aã]o de pessoas/], ['Atenção a detalhes', /aten[cç]ao (a|aos) detalhe|detalhista/], ['Responsabilidade', /responsabilidade|comprometimento/],
  ['Resolução de problemas', /resolu[cç]ao de problemas|resolver problemas|solucion/], ['Agilidade', /agilidade|din[aâ]mic/], ['Empatia', /empatia|cordialidade|educa[cç]ao no trato/],
];

export interface Keyword {
  label: string;
  kind: 'tecnica' | 'comportamento' | 'exigencia';
  inJob: boolean;
  /** A pessoa já mostrou essa competência (nas habilidades ou nas tarefas que informou). */
  matched: boolean;
}

export interface Requirements {
  yearsExperience: number | null;
  needsCnh: string | null;
  education: string | null;
}

function extractRequirements(job: string): Requirements {
  const t = fold(job);
  const yearsMatch = t.match(/(\d{1,2})\s*(?:\+\s*)?anos? de experiencia|experiencia (?:minima )?de (\d{1,2}) anos?/);
  const cnh = t.match(/cnh\s*(?:categoria\s*)?([a-e]{1,2})\b|categoria\s*([a-e]{1,2})\b/);
  const edu = /ensino superior|gradua[cç]ao|bacharel/.test(t) ? 'ensino superior' : /ensino medio/.test(t) ? 'ensino médio' : /ensino fundamental/.test(t) ? 'ensino fundamental' : /tecnico|curso tecnico/.test(t) ? 'curso técnico' : null;
  return {
    yearsExperience: yearsMatch ? Number(yearsMatch[1] ?? yearsMatch[2]) : null,
    needsCnh: cnh ? (cnh[1] ?? cnh[2] ?? '').toUpperCase() || null : /\bcnh\b/.test(t) ? '' : null,
    education: edu,
  };
}

export class ResumeInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Dados do currículo inválidos: ${issues.join('; ')}`);
    this.name = 'ResumeInputError';
    this.issues = issues;
  }
}

export function validateResume(i: ResumeInput): void {
  const issues: string[] = [];
  if (i.targetRole.trim().length < 3) issues.push('informe o cargo da vaga');
  if (i.jobText.trim().length < 40) issues.push('cole o texto da vaga (mínimo 40 caracteres)');
  if (i.jobText.length > MAX_JOB_CHARS) issues.push(`o texto da vaga passa de ${MAX_JOB_CHARS} caracteres`);
  if (i.experiences.length > 6) issues.push('no máximo 6 experiências');
  if (i.experiences.length === 0 && i.skills.trim().length < 3) issues.push('conte pelo menos uma experiência ou algumas habilidades');
  if (issues.length > 0) throw new ResumeInputError(issues);
}

const splitTasks = (t: string) => t.split(/\r?\n|;/).map((x) => x.trim().replace(/^[-•*]\s*/, '')).filter((x) => x.length >= 4);

export interface TailoredExperience {
  role: string;
  years: number;
  bullets: { text: string; usesKeywords: string[]; needsNumber: boolean }[];
}

export interface TailoredResume {
  headline: string;
  summary: string;
  skillsOrdered: string[];
  experiences: TailoredExperience[];
  education: string;
  languages: string;
}

export interface ResumeResult {
  targetRole: string;
  coveragePct: number;
  keywords: Keyword[];
  matched: Keyword[];
  missing: Keyword[];
  requirements: Requirements;
  requirementNotes: string[];
  resume: TailoredResume;
  honestyNotes: string[];
  atsTips: string[];
  layoutTips: string[];
  coverLetter: string;
  interview: { question: string; how: string }[];
}

export function buildResume(input: ResumeInput): ResumeResult {
  validateResume(input);
  const job = fold(input.jobText);
  const mine = fold([input.skills, input.education, input.languages, ...input.experiences.map((e) => `${e.role} ${e.tasks}`)].join(' \n '));

  const keywords: Keyword[] = [];
  for (const [label, re] of HARD) if (re.test(job)) keywords.push({ label, kind: 'tecnica', inJob: true, matched: re.test(mine) });
  for (const [label, re] of SOFT) if (re.test(job)) keywords.push({ label, kind: 'comportamento', inJob: true, matched: re.test(mine) });
  const req = extractRequirements(input.jobText);
  const totalYears = input.experiences.reduce((s, e) => s + Math.max(0, e.years), 0);

  const hard = keywords.filter((k) => k.kind === 'tecnica');
  const matched = keywords.filter((k) => k.matched);
  const missing = keywords.filter((k) => !k.matched);
  const weighted = (arr: Keyword[]) => arr.filter((k) => k.kind === 'tecnica').length * 2 + arr.filter((k) => k.kind === 'comportamento').length;
  const coveragePct = keywords.length === 0 ? 0 : Math.round((weighted(matched) / weighted(keywords)) * 100);

  const requirementNotes: string[] = [];
  if (req.yearsExperience !== null) {
    requirementNotes.push(totalYears >= req.yearsExperience ? `A vaga pede ${req.yearsExperience} ano(s) de experiência e você informou ${totalYears}: destaque isso no topo.` : `A vaga pede ${req.yearsExperience} ano(s) de experiência e você informou ${totalYears}. Candidate-se mesmo assim se o restante bater, mas seja honesto sobre o tempo e destaque o que aprendeu rápido.`);
  }
  if (req.needsCnh !== null) requirementNotes.push(req.needsCnh ? `A vaga pede CNH categoria ${req.needsCnh}. Só informe se você tem.` : 'A vaga pede CNH. Só informe se você tem.');
  if (req.education) requirementNotes.push(`A vaga cita ${req.education}. ${input.education.trim() ? 'Coloque a sua formação logo no início.' : 'Se você tem, informe; se está cursando, escreva "cursando" e a previsão de término.'}`);

  const kwFound = (text: string) => keywords.filter((k) => k.matched && [...HARD, ...SOFT].find(([l]) => l === k.label)![1].test(fold(text))).map((k) => k.label);

  const experiences: TailoredExperience[] = input.experiences.map((e) => ({
    role: e.role.trim(),
    years: Math.max(0, e.years),
    bullets: splitTasks(e.tasks).slice(0, 6).map((t) => {
      const text = cap(t.replace(/\.$/, ''));
      return { text, usesKeywords: kwFound(t), needsNumber: !/\d/.test(t) };
    }),
  }));

  const topMatched = matched.filter((k) => k.kind === 'tecnica').slice(0, 4).map((k) => k.label);
  const topSoft = matched.filter((k) => k.kind === 'comportamento').slice(0, 2).map((k) => k.label.toLowerCase());
  const levelText = { entrada: 'em início de carreira', pleno: 'com experiência consolidada', senior: 'com ampla experiência' }[input.level];
  const headline = cap(input.targetRole.trim()) + (topMatched.length > 0 ? ` · ${topMatched.slice(0, 3).join(' · ')}` : '');
  const parts: string[] = [];
  parts.push(`${cap(input.targetRole.trim())} ${levelText}${totalYears > 0 ? `, com ${totalYears} ${totalYears === 1 ? 'ano' : 'anos'} somados em ${input.experiences.length === 1 ? 'uma função' : `${input.experiences.length} funções`}` : ''}.`);
  if (topMatched.length > 0) parts.push(`Atuação com ${topMatched.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`);
  if (topSoft.length > 0) parts.push(`Perfil com ${topSoft.join(' e ')}.`);
  parts.push('Disponível para contribuir com a equipe e aprender o que a função pedir.');
  const mySkills = input.skills.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length >= 2);
  // habilidades que casam com a vaga vêm primeiro
  const skillsOrdered = [...mySkills];
  const score = (s: string) => keywords.filter((k) => k.matched && [...HARD, ...SOFT].find(([l]) => l === k.label)![1].test(fold(s))).length;
  skillsOrdered.sort((a, b) => score(b) - score(a));

  const need = req.yearsExperience;
  const cover = [
    'Prezados(as),',
    '',
    `Tenho interesse na vaga de ${input.targetRole.trim()} na [NOME DA EMPRESA] e acredito que posso contribuir.`,
    topMatched.length > 0 ? `Tenho experiência prática com ${topMatched.join(', ').replace(/, ([^,]*)$/, ' e $1')}${totalYears > 0 ? `, em ${totalYears} ${totalYears === 1 ? 'ano' : 'anos'} de trabalho` : ''}, itens que vi na descrição da vaga.` : 'Li a descrição com atenção e me identifiquei com as atividades da função.',
    need !== null && totalYears < need ? 'Sei que a vaga pede mais tempo de experiência; aprendo rápido e estou pronto(a) para mostrar isso na prática.' : 'Estou disponível para conversar e detalhar minha experiência.',
    '',
    'Fico à disposição para uma entrevista.',
    'Atenciosamente,',
    '[SEU NOME]',
  ].join('\n');

  const interview = [
    { question: 'Fale um pouco sobre você.', how: 'Responda em 1 minuto: quem é, o que já fez de mais parecido com a vaga e por que quer esta função. Use o resumo do currículo como base.' },
    { question: 'Por que você quer trabalhar aqui?', how: 'Cite algo concreto da empresa ou da vaga (o que ela faz, uma atividade que você gosta). Pesquise 10 minutos antes.' },
    ...hard.slice(0, 2).map((k) => ({ question: `Conte uma situação em que você usou ${k.label}.`, how: 'Conte em 4 passos: situação, o que precisava ser feito, o que você fez e o resultado. Se não tem experiência, diga o que estudou e como aprende.' })),
    { question: 'Qual foi um erro que você cometeu e o que aprendeu?', how: 'Escolha um erro pequeno e real, mostre o que fez para corrigir e o que mudou. Evite dizer que nunca erra.' },
    { question: 'Quais são as suas pretensões?', how: 'Pesquise a faixa da função na sua cidade e responda com uma faixa, não um valor fechado.' },
  ];

  return {
    targetRole: input.targetRole.trim(),
    coveragePct,
    keywords,
    matched,
    missing,
    requirements: req,
    requirementNotes,
    resume: { headline, summary: parts.join(' '), skillsOrdered, experiences, education: input.education.trim(), languages: input.languages.trim() },
    honestyNotes: [
      'Escreva só o que é verdade. Contratação descobre exagero na entrevista ou no período de experiência.',
      'As palavras da vaga que você não tem aparecem na lista "falta mostrar". Se você tem a habilidade e esqueceu de escrever, inclua; se não tem, não coloque.',
      'Onde faltar número (quantos clientes, quantas vendas, quanto tempo), pergunte-se: tenho uma estimativa honesta? Números concretos valem mais que adjetivos.',
    ],
    atsTips: [
      'Use as mesmas palavras da vaga quando forem verdadeiras: muitos sistemas de triagem procuram o termo exato.',
      'Salve em PDF com texto selecionável (não imagem) e nome de arquivo simples, como "curriculo-seu-nome.pdf".',
      'Evite tabelas, colunas e ícones; prefira um layout de uma coluna, com títulos claros (Resumo, Experiência, Formação).',
      'Coloque a experiência mais recente primeiro e limite a 1 página (2 só com mais de 10 anos de carreira).',
      'Não inclua CPF, RG, estado civil nem foto, a menos que a vaga peça.',
    ],
    layoutTips: ['Uma página, fonte de 10 a 12 pontos, margens de 2 cm.', 'Dados de contato no topo: nome, telefone, e-mail, cidade (sem endereço completo).', 'Verbos no passado para o que já fez e no presente para o que faz hoje.'],
    coverLetter: cover,
    interview,
  };
}

export interface ResumePreview {
  coveragePct: number;
  matchedCount: number;
  missingCount: number;
  topMatched: string[];
  topMissing: string[];
  headline: string;
}

export function buildResumePreview(r: ResumeResult): ResumePreview {
  const topMatched = r.matched.slice(0, 3).map((k) => k.label);
  const topMissing = r.missing.filter((k) => k.kind === 'tecnica').slice(0, 2).map((k) => k.label);
  return {
    coveragePct: r.coveragePct,
    matchedCount: r.matched.length,
    missingCount: r.missing.length,
    topMatched,
    topMissing,
    headline:
      r.keywords.length === 0
        ? 'Não identificamos palavras-chave conhecidas nesta vaga. O currículo completo organiza o que você informou e dá dicas para esta função.'
        : `Seu perfil já cobre ${r.coveragePct}% do que a vaga pede${topMatched.length ? ` (${topMatched.join(', ')})` : ''}. ${r.missing.length > 0 ? `Faltam ${r.missing.length} ${r.missing.length === 1 ? 'ponto' : 'pontos'} para mostrar ou desenvolver.` : 'Você cobre tudo que identificamos.'}`,
  };
}
