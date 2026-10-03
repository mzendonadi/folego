// Parte 2: capítulos 5 a 9 (reserva, economia, juros compostos, investir, metas).
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Valor futuro de aportes mensais iguais (juros mensais em %), começando em zero. */
const fv = (aporte, taxaMes, meses) => (taxaMes === 0 ? aporte * meses : aporte * (((1 + taxaMes / 100) ** meses - 1) / (taxaMes / 100)));

export function part2(b) {
  // ------------------------------------------------------------ cap 5
  b.chapter({ num: 5, title: 'Reserva de emergência: seu colchão de paz', subtitle: 'O que separa um imprevisto de uma crise.', epigraph: 'Reserva não rende para enriquecer. Rende para você não precisar se endividar.', art: 0 });
  b.lead('A reserva de emergência é a peça que mais muda o jeito de viver. Não pelo valor, mas pelo que ela faz com a sua cabeça: o imprevisto vira um incômodo, não um desastre.');
  b.h2('Para que serve (e para que não serve)');
  b.p('É o dinheiro guardado para o que **não dá para adiar e não estava planejado**: o desemprego, o conserto do carro que é seu instrumento de trabalho, o problema de saúde, a geladeira que pifou. Sem ela, a pessoa recorre ao cartão, ao cheque especial ou a empréstimos caros, e o imprevisto de R$ 2.000 vira uma dívida de R$ 3.500.');
  b.p('Por outro lado, a reserva **não é** para viagem, para a promoção imperdível ou para o presente de aniversário. Para isso existem as metas (capítulo 9). Misturar as duas é o caminho mais comum para ficar sem nenhuma.');
  b.h2('Quanto guardar');
  b.p('O ponto de partida é o seu **custo de vida essencial mensal**: moradia, alimentação, transporte, saúde, contas, parcelas obrigatórias. Não a sua renda, o que você precisa para sobreviver bem. Depois, multiplique conforme o seu perfil:');
  b.table({
    head: ['Perfil', 'Meses de custo essencial', 'Por quê'],
    widths: [4, 3, 6],
    rows: [
      ['Emprego estável (CLT, servidor)', '3 a 6', 'Renda previsível, proteção legal em caso de demissão'],
      ['Renda variável ou autônomo', '6 a 12', 'Meses de vacas magras fazem parte do jogo'],
      ['Sustenta família sozinho(a)', '6 a 12', 'Mais gente depende da mesma renda'],
      ['Empreendedor', '6 a 12 (pessoal) + caixa do negócio', 'A empresa e a pessoa precisam de colchões diferentes'],
    ],
  });
  b.box('conta', 'Calculando a sua reserva', [
    'Exemplo: essencial de R$ 2.800 por mês.',
    `- 3 meses = ${brl(2800 * 3)}`,
    `- 6 meses = ${brl(2800 * 6)}`,
    `- 12 meses = ${brl(2800 * 12)}`,
    'Parece enorme? Calma: ninguém junta isso de uma vez. Veja os degraus abaixo.',
  ]);
  b.h2('Onde guardar');
  b.p('A reserva precisa de três qualidades, nesta ordem: **segurança** (não perder valor), **liquidez** (poder sacar rápido, sem perdas) e só depois rentabilidade. Opções comuns, em linhas gerais:');
  b.ul([
    '**Tesouro Selic:** título público, baixo risco, resgate em um dia útil. Boa opção para quem quer simplicidade.',
    '**CDB de liquidez diária:** de bancos sólidos, com rendimento de 100% do CDI ou próximo disso, coberto pelo FGC dentro do limite.',
    '**Conta ou caixinha remunerada:** conveniente e fácil de automatizar, confira a rentabilidade real.',
    '**Evite para a reserva:** ações, criptomoedas, fundos de risco, imóveis. Eles podem estar em baixa justamente quando você precisar.',
  ]);
  b.box('atencao', 'Sobre a poupança', 'A caderneta de poupança é segura e acessível, mas na maior parte do tempo rende menos que as alternativas de baixo risco acima. Para a reserva, ela é melhor que o colchão, e pior que as alternativas. Compare sempre.');
  b.h2('Os degraus da reserva');
  b.p('Montar a reserva é uma subida. Suba degrau por degrau, e comemore cada um:');
  b.ul([
    '**Degrau 1: R$ 1.000.** Cobre os pequenos sustos e interrompe o hábito de recorrer ao cartão. Meta: 1 a 2 meses.',
    '**Degrau 2: 1 mês de custo essencial.** Você deixa de entrar em pânico quando o carro dá problema.',
    '**Degrau 3: 3 meses.** O imprevisto vira conversa, não drama.',
    '**Degrau 4: 6 meses (ou mais, conforme o perfil).** Você consegue negociar emprego, contas e rotina sem pressão.',
  ], { ordered: true });
  b.table({
    head: ['Reserva alvo', 'Em 12 meses', 'Em 24 meses', 'Em 36 meses'],
    widths: [3, 3, 3, 3],
    align: ['r', 'r', 'r', 'r'],
    rows: [[brl(5000), `${brl(5000 / 12)}/mês`, `${brl(5000 / 24)}/mês`, `${brl(5000 / 36)}/mês`], [brl(12000), `${brl(12000 / 12)}/mês`, `${brl(12000 / 24)}/mês`, `${brl(12000 / 36)}/mês`], [brl(20000), `${brl(20000 / 12)}/mês`, `${brl(20000 / 24)}/mês`, `${brl(20000 / 36)}/mês`]],
    note: 'Valores sem rendimento, só aportes. O rendimento ajuda um pouco, mas o motor é o hábito de guardar todo mês.',
  });
  b.h3('Quando usar, e como repor');
  b.p('Use a reserva quando o gasto for **urgente, inesperado e necessário**. Se tiver dúvida, aplique a regra: "eu podia ter previsto isso?". Se sim, é meta. Se não, é reserva. Depois de usar, **reponha como prioridade**, antes de qualquer outra meta. Ela existe para ser usada, e para ser reconstruída.');
  b.box('exercicio', 'Seu primeiro degrau', [
    '- Calcule o seu custo essencial mensal.',
    '- Defina o valor mensal que vai guardar (qualquer valor serve, mas defina).',
    '- Abra a conta ou caixinha e programe a transferência para o dia seguinte ao salário.',
  ]);

  // ------------------------------------------------------------ cap 6
  b.chapter({ num: 6, title: 'Economia sem dor de cabeça', subtitle: 'O que Selic, inflação e dólar têm a ver com o seu bolso.', epigraph: 'Você não precisa prever a economia. Precisa entender o suficiente para não ser pego de surpresa.', art: 1 });
  b.lead('Notícia de economia costuma parecer língua estrangeira. Mas por trás dos termos há quatro ideias simples que mexem com a sua vida toda semana.');
  b.h2('Selic: o preço do dinheiro');
  b.p('A **Selic** é a taxa básica de juros da economia brasileira, definida pelo Banco Central a cada 45 dias, aproximadamente, nas reuniões do Copom (são oito por ano). Pense nela como o "preço do dinheiro": quando sobe, o crédito fica mais caro (financiamentos, cartão, empréstimo) e quem guarda dinheiro em renda fixa ganha mais. Quando cai, o contrário.');
  b.h2('Inflação: o preço das coisas');
  b.p('A **inflação**, medida no Brasil principalmente pelo IPCA, é o aumento geral dos preços. Se ela é de 5% ao ano, o que custava R$ 100 passa a custar R$ 105. Seu salário precisa crescer pelo menos isso apenas para você manter o mesmo padrão. Inflação é o imposto invisível sobre o dinheiro parado.');
  const poder = [0, 5, 10, 20].map((anos) => [`${anos} anos`, `R$ ${(100 / 1.05 ** anos).toFixed(2).replace('.', ',')}`]);
  b.table({
    head: ['Daqui a...', 'O que R$ 100 de hoje compram (inflação de 5% ao ano)'],
    widths: [3, 8],
    align: ['l', 'r'],
    rows: poder,
    note: 'Cálculo ilustrativo: R$ 100 dividido por 1,05 elevado ao número de anos.',
  });
  b.h2('CDI e juro real: quanto o seu dinheiro realmente rende');
  b.p('O **CDI** é a taxa que os bancos usam entre si, e anda colada na Selic. Muitos investimentos de renda fixa dizem "rende 100% do CDI". Mas o que importa para você é o **juro real**: quanto o dinheiro rende **acima da inflação**.');
  b.box('conta', 'Juro real em uma linha', [
    'Juro real = (1 + juro nominal) ÷ (1 + inflação) − 1',
    'Exemplo: um investimento que rende 10% ao ano, com inflação de 5%: (1,10 ÷ 1,05) − 1 = 4,76% ao ano de ganho real.',
    'Se o rendimento fosse 5% e a inflação 5%, o ganho real seria zero: você apenas manteria o poder de compra.',
  ]);
  b.h2('Dólar: o preço do que vem de fora');
  b.p('O dólar mexe no preço de combustível, eletrônicos, trigo, passagens e de tudo o que depende de importação. Quando sobe, muita coisa encarece com atraso de semanas. Se você tem gastos em dólar (assinaturas, viagens, compras internacionais), vale ter um limite próprio para eles no orçamento. E não, ninguém consegue prever o dólar de forma consistente: não monte planos que dependem disso.');
  b.table({
    head: ['Se isso sobe...', 'Você sente aqui', 'O que fazer'],
    widths: [3, 5, 6],
    rows: [
      ['Selic', 'Financiamento e cartão mais caros; renda fixa rende mais', 'Evite novas dívidas caras; renegocie as que tiver; reserva rende mais'],
      ['Inflação', 'Mercado, aluguel, serviços mais caros', 'Revise o orçamento, renegocie contratos, proteja o dinheiro de longo prazo'],
      ['Dólar', 'Combustível, eletrônicos, viagens', 'Adie compras importadas, limite gastos em moeda estrangeira'],
      ['Desemprego', 'Renda familiar em risco', 'Reforce a reserva, diversifique renda'],
    ],
  });
  b.box('dica', 'Como acompanhar sem enlouquecer', [
    '- Escolha uma ou duas fontes confiáveis e olhe uma vez por semana, não todo dia.',
    '- Desconfie de manchetes alarmistas e de "previsões certeiras".',
    '- Pergunte sempre: "Isso muda o que eu faço no meu orçamento este mês?" Se não muda, não se preocupe.',
  ]);

  // ------------------------------------------------------------ cap 7
  b.chapter({ num: 7, title: 'Juros compostos: o tempo trabalhando por você', subtitle: 'O mesmo mecanismo que afoga na dívida constrói patrimônio na reserva.', epigraph: 'O melhor momento para começar foi há dez anos. O segundo melhor é hoje, com o valor que cabe.', art: 3 });
  b.lead('Juros compostos não são mágica: são paciência com matemática. E o ingrediente mais importante não é o dinheiro, é o tempo.');
  b.h2('Como funciona');
  b.p('Nos juros compostos, o rendimento de cada período é somado ao capital, e no período seguinte você ganha juros **sobre o total**. É a bola de neve do bem: no início ela parece lenta; com o tempo, ganha velocidade sozinha.');
  b.p('Veja um exemplo ilustrativo: aportes mensais de **R$ 300**, com rendimento de **0,8% ao mês** (algo em torno de 10% ao ano, só para raciocinar). Compare quanto você colocou do bolso com quanto o tempo adicionou:');
  const taxa = 0.8;
  b.table({
    head: ['Tempo', 'Você investiu', 'Valor acumulado', 'Ajuda dos juros'],
    widths: [2, 3, 3, 3],
    align: ['l', 'r', 'r', 'r'],
    rows: [5, 10, 20, 30].map((anos) => {
      const pago = 300 * anos * 12;
      const total = fv(300, taxa, anos * 12);
      return [`${anos} anos`, brl(pago), brl(total), brl(total - pago)];
    }),
    note: 'Valores ilustrativos, sem impostos nem inflação. Rendimentos reais variam e não há garantia.',
  });
  b.p('Repare no que acontece depois de 20 anos: os juros passam a render mais que os seus aportes. Aos 30, o dinheiro que o tempo criou é bem maior do que o que saiu do seu bolso. **Esse é o efeito composto.**');
  b.h2('O custo de adiar');
  b.p('Imagine duas pessoas que investem R$ 300 por mês na mesma taxa. A primeira começa aos 25 e para de aportar aos 35 (dez anos). A segunda só começa aos 35 e aporta até os 65 (trinta anos). Quem ganha?');
  const cedo = fv(300, taxa, 10 * 12) * (1 + taxa / 100) ** (30 * 12);
  const tarde = fv(300, taxa, 30 * 12);
  b.table({
    head: ['', 'Começa aos 25', 'Começa aos 35'],
    widths: [4, 4, 4],
    align: ['l', 'r', 'r'],
    rows: [
      ['Aporta por', '10 anos', '30 anos'],
      ['Total que saiu do bolso', brl(300 * 120), brl(300 * 360)],
      ['Valor aos 65 anos', brl(cedo), brl(tarde)],
    ],
    note: 'Ilustração da lógica dos juros compostos, com a mesma taxa para os dois.',
  });
  b.box('dica', 'A regra dos 72', 'Quer saber em quanto tempo um dinheiro dobra? Divida 72 pela taxa anual em %. A 6% ao ano, dobra em 12 anos (72 ÷ 6). A 12% ao ano, em 6 anos. Funciona também ao contrário: uma dívida de 36% ao ano dobra em apenas 2 anos.');
  b.h2('O que fazer com isso');
  b.ul([
    '**Comece pequeno, mas comece.** R$ 50 por mês agora valem mais do que R$ 500 "quando eu puder".',
    '**Aumente o aporte junto com a renda.** Cada aumento de salário: pelo menos metade vai para o futuro.',
    '**Não interrompa.** Os maiores ganhos vêm dos últimos anos, e quem para antes perde justamente a melhor parte.',
    '**Cuidado com as taxas.** Uma taxa de administração de 2% ao ano come uma fatia enorme do resultado em 30 anos.',
  ]);
  b.breath('O tempo é o único ingrediente que não se compra, só se usa. Use o seu.');

  // ------------------------------------------------------------ cap 8
  b.chapter({ num: 8, title: 'Investir sem mistério', subtitle: 'Conceitos que ficam de pé com qualquer produto que você encontrar.', epigraph: 'Se você não entende como o produto ganha dinheiro, provavelmente é com o seu.', art: 2 });
  b.lead('Investir não é privilégio de quem tem muito. É o que se faz depois de arrumar a casa, e dá para começar com pouco.');
  b.box('atencao', 'Aviso importante', 'Este capítulo é educativo. Ele explica conceitos, não recomenda produtos nem substitui um profissional certificado. Antes de investir, avalie o seu perfil, os seus objetivos e os riscos de cada produto.');
  b.h2('Antes de investir: o checklist da base');
  b.checklist('Você está pronto(a) para investir quando...', [
    'Não tem dívidas caras (rotativo, cheque especial, financeiras).',
    'Tem pelo menos o primeiro degrau da reserva de emergência (e ela está em um lugar seguro e líquido).',
    'Está sobrando dinheiro no mês, mesmo que pouco.',
    'Sabe para que serve o dinheiro (meta) e por quanto tempo pode deixá-lo aplicado.',
  ]);
  b.h2('O triângulo que explica tudo: risco, retorno e liquidez');
  b.p('Todo investimento equilibra três coisas. **Retorno** é o quanto pode render. **Risco** é a chance de render menos do que o esperado, ou perder. **Liquidez** é a facilidade de transformar em dinheiro. Não existe produto com retorno alto, risco baixo e liquidez imediata. Quem promete isso está vendendo ilusão.');
  b.h2('As famílias de investimentos');
  b.table({
    head: ['Tipo', 'Como funciona', 'Perfil comum'],
    widths: [3, 7, 4],
    rows: [
      ['Renda fixa pós-fixada', 'Rende conforme um índice (CDI, Selic). Ex.: Tesouro Selic, CDB', 'Reserva e curto prazo'],
      ['Renda fixa prefixada', 'Taxa definida na compra. Pode oscilar se resgatar antes', 'Metas com data certa'],
      ['Renda fixa ligada à inflação', 'Rende inflação + uma taxa. Ex.: Tesouro IPCA+', 'Longo prazo (aposentadoria)'],
      ['Renda variável', 'Ações, fundos imobiliários, ETFs. O valor oscila', 'Longo prazo, tolerância a risco'],
      ['Fundos', 'Um gestor cuida do dinheiro de vários. Cobram taxas', 'Quem prefere delegar'],
    ],
  });
  b.h2('Proteção: o que é o FGC');
  b.p('O **Fundo Garantidor de Créditos** protege o seu dinheiro em alguns produtos bancários (CDB, LCI, LCA, poupança, entre outros) caso a instituição quebre, até **R$ 250 mil por CPF, por instituição**, com um teto global de R$ 1 milhão a cada quatro anos. Títulos do Tesouro Direto têm a garantia do governo federal. Ações e fundos não têm cobertura do FGC.');
  b.h2('Imposto: não esqueça de contar');
  b.p('Nos investimentos de renda fixa, o Imposto de Renda incide só sobre o **lucro**, e cai quanto mais tempo o dinheiro fica aplicado:');
  b.table({
    head: ['Prazo da aplicação', 'Alíquota sobre o rendimento'],
    widths: [5, 4],
    align: ['l', 'r'],
    rows: [['Até 180 dias', '22,5%'], ['De 181 a 360 dias', '20%'], ['De 361 a 720 dias', '17,5%'], ['Acima de 720 dias', '15%']],
    note: 'Regra geral para renda fixa tributada. Alguns produtos (como LCI e LCA para pessoa física) têm isenção. Confira as regras vigentes antes de investir.',
  });
  b.h2('Os erros que mais custam caro');
  b.ul([
    '**Perseguir rentabilidade passada.** O que rendeu muito ano passado pode não render este ano.',
    '**Investir o que não pode perder** ou o que vai precisar em breve.',
    '**Concentrar tudo em um só ativo.** Diversificar reduz a chance de um tombo grande.',
    '**Vender no pânico e comprar na euforia.** O investidor paciente costuma ganhar do ansioso.',
    '**Ignorar taxas e impostos.** Elas corroem o resultado em silêncio.',
  ]);
  b.box('atencao', 'Sinais de golpe', [
    '- Promessa de retorno garantido e muito acima do mercado.',
    '- Pressa: "só hoje", "restam duas vagas".',
    '- Pirâmide: o ganho depende de trazer outras pessoas.',
    '- Quem oferece não é regulado (confira CNPJ e autorização na CVM e no Banco Central).',
    '- "Robôs" ou "sinais" que prometem lucro automático no trade.',
  ]);

  // ------------------------------------------------------------ cap 9
  b.chapter({ num: 9, title: 'Metas e planejamento por prazos', subtitle: 'Como transformar "um dia eu queria" em "até dezembro eu vou".', epigraph: 'Sonho sem prazo é só desejo. Sonho com número e data vira plano.', art: 0 });
  b.lead('Metas são a razão pela qual vale a pena organizar o dinheiro. Sem elas, o orçamento vira apenas controle; com elas, vira direção.');
  b.h2('Três horizontes');
  b.table({
    head: ['Horizonte', 'Prazo', 'Exemplos', 'Onde guardar (em geral)'],
    widths: [2.4, 2, 5, 5],
    rows: [
      ['Curto', 'Até 1 ano', 'Viagem, material escolar, conserto, entrada de um curso', 'Renda fixa de liquidez, caixinha'],
      ['Médio', '1 a 5 anos', 'Entrada de imóvel, troca de carro, mestrado', 'Renda fixa, prefixados, IPCA+'],
      ['Longo', 'Mais de 5 anos', 'Aposentadoria, educação dos filhos, liberdade financeira', 'Mistura de renda fixa e variável, conforme o perfil'],
    ],
  });
  b.h2('Meta boa tem quatro partes');
  b.ul([
    '**Nome:** algo que te emocione. "Viagem para Gramado com a família" pesa mais que "meta 3".',
    '**Valor:** quanto custa, de verdade, pesquisado.',
    '**Prazo:** uma data, não um "quando der".',
    '**Primeiro passo:** a ação mais simples que você faz esta semana.',
  ], { ordered: true });
  b.h2('A conta da meta');
  b.p('Divida o valor pelo número de meses até o prazo. Esse é o aporte mensal necessário (sem contar rendimento, o que é conservador):');
  b.table({
    head: ['Meta', 'Valor', 'Prazo', 'Guardar por mês'],
    widths: [5, 3, 2, 3],
    align: ['l', 'r', 'r', 'r'],
    rows: [
      ['Viagem em família', brl(6000), '12 meses', brl(6000 / 12)],
      ['Notebook para trabalhar', brl(4200), '6 meses', brl(4200 / 6)],
      ['Entrada de um imóvel', brl(40000), '48 meses', brl(40000 / 48)],
      ['Curso de especialização', brl(9000), '18 meses', brl(9000 / 18)],
    ],
  });
  b.box('dica', 'Quando a conta não fecha', [
    '- Alongue o prazo (a opção mais saudável).',
    '- Reduza o valor da meta (versão enxuta).',
    '- Aumente a renda (capítulo 10) ou reduza outros gastos.',
    '- Nunca "resolva" tirando da reserva ou entrando em dívida para uma meta que não é emergência.',
  ]);
  b.h2('A escada financeira: por onde começar');
  b.p('Quando as necessidades competem, use esta ordem de prioridade. Ela evita que você invista enquanto paga 14% ao mês no cartão:');
  b.ul([
    '**Organizar:** saber quanto entra e sai.',
    '**Quitar as dívidas caras.**',
    '**Montar a reserva de emergência.**',
    '**Metas de médio prazo e proteção** (seguros que façam sentido).',
    '**Investir para o longo prazo.**',
    '**Liberdade financeira:** escolher como usar o seu tempo.',
  ], { ordered: true });
  b.box('exercicio', 'A roda da vida financeira', [
    'Dê uma nota de 0 a 10 para cada área hoje e anote:',
    '- Controle (sei para onde vai o dinheiro) · Dívidas · Reserva · Metas · Investimentos · Proteção · Paz de espírito.',
    'Escolha as duas áreas com menor nota e coloque uma ação concreta para cada uma nos próximos 30 dias. Repita a roda a cada três meses e veja a evolução.',
  ]);
  b.h3('Ritual de revisão');
  b.p('Planejamento não é evento, é hábito. Dez minutos por semana (conferir lançamentos e o que vence), trinta minutos por mês (fechar o mês e ajustar categorias) e uma tarde por trimestre (revisar metas e a roda da vida) são suficientes para manter tudo nos trilhos.');
}
