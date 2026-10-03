// Parte 1: carta de abertura e capítulos 1 a 4 (mentalidade, diagnóstico, orçamento, dívidas).
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Simula a quitação de dívidas (juros mensais em %, parcelas mínimas, extra mensal). */
export function payoff(debts, extra, method) {
  const live = debts.map((d) => ({ ...d }));
  let month = 0;
  let interest = 0;
  const order = [];
  const budget = live.reduce((s, d) => s + d.min, 0) + extra;
  while (live.some((d) => d.bal > 0.005) && month < 600) {
    month += 1;
    for (const d of live) {
      if (d.bal <= 0) continue;
      const i = d.bal * (d.rate / 100);
      d.bal += i;
      interest += i;
    }
    let left = budget;
    for (const d of live) {
      if (d.bal <= 0) continue;
      const pay = Math.min(d.bal, d.min, left);
      d.bal -= pay;
      left -= pay;
    }
    const target = live.filter((d) => d.bal > 0.005).sort((a, b) => (method === 'avalanche' ? b.rate - a.rate : a.bal - b.bal));
    for (const d of target) {
      if (left <= 0) break;
      const pay = Math.min(d.bal, left);
      d.bal -= pay;
      left -= pay;
    }
    for (const d of live) if (d.bal <= 0.005 && !order.includes(d.name)) order.push(d.name);
  }
  return { months: month, interest, order };
}

export function part1(b) {
  // ------------------------------------------------------------ carta de abertura
  b.page();
  b.lead('Antes de qualquer planilha, uma conversa franca: dinheiro não é só número. É sono, é humor, é a conversa no jantar, é o que você deixa de fazer por medo.');
  b.h2('Uma carta antes de começar');
  b.p('Oi. Eu sei por que você está aqui. Talvez a fatura do cartão tenha chegado maior do que você imaginava. Talvez o salário acabe antes do mês. Talvez esteja tudo mais ou menos em ordem, mas você sente que o dinheiro escorre pelos dedos e que nunca sobra para o que importa. Ou talvez você só queira, de verdade, ter tranquilidade para respirar.');
  b.p('Este eBook foi escrito para esse momento. O nome do projeto, **Fôlego**, não é acaso: ter fôlego é conseguir parar, respirar, olhar para a situação com calma e decidir o próximo passo. Quem está sufocado decide mal. Quem respira decide melhor. Todo o conteúdo que você vai ler parte dessa ideia.');
  b.p('Aqui você não vai encontrar fórmula mágica, nem promessa de ficar rico em 30 dias, nem sermão sobre o cafezinho. Vai encontrar **método, números honestos e um caminho possível**: do primeiro olhar para o seu dinheiro até uma vida financeira mais leve, com reserva, sem dívida cara e, se você quiser, com liberdade para escolher como usar o seu tempo.');
  b.box('dica', 'Como usar este eBook', [
    '- Leia um capítulo por vez. Cada um foi pensado para caber em uma sentada, com café na mão.',
    '- Faça os exercícios das caixas azuis (MÃO NA MASSA). Ler muda a cabeça, mas fazer muda o saldo.',
    '- Anote os números no papel, numa planilha ou no Prumo. O importante é tirar o dinheiro da névoa.',
    '- Pule o que já domina. Volte ao que precisar. Não existe ordem obrigatória, só a que funciona para você.',
  ]);
  b.h3('O que este eBook é, e o que não é');
  b.p('É um guia de educação financeira em linguagem simples, com exemplos numéricos reais e exercícios. **Não é consultoria de investimentos, nem aconselhamento jurídico ou tributário**. Quando o assunto exigir um profissional (advogado, contador, planejador financeiro certificado), vamos avisar. As taxas e valores usados nos exemplos são ilustrativos: eles servem para você entender o raciocínio, não para prever o futuro.');
  b.p('Pronto? Então vamos começar pelo começo, que não é a planilha: é a sua cabeça.');
  b.space(6);
  b.breath('Dinheiro bem cuidado não é sobre ter mais. É sobre ter paz, escolha e tempo.');

  b.reserveToc();

  // ------------------------------------------------------------ cap 1
  b.chapter({ num: 1, title: 'Respira: o dinheiro começa na cabeça', subtitle: 'Antes de organizar números, vale organizar a relação que você tem com eles.', epigraph: 'Você não precisa saber tudo para dar o primeiro passo. Precisa apenas de coragem para olhar.', art: 0 });
  b.lead('Ninguém aprende a lidar com dinheiro na escola. A gente aprende em casa, ouvindo frases soltas, vendo brigas, sentindo o clima quando a conta chega.');
  b.h2('A sua história com o dinheiro');
  b.p('Antes de falar de juros ou de investimentos, pense em como o dinheiro aparecia na sua infância. Era assunto proibido? Motivo de briga? Sinal de status? Algo que "nunca dava"? Essas lembranças viram **crenças**, e as crenças viram hábitos: quem cresceu ouvindo "dinheiro não traz felicidade" pode, sem perceber, sabotar o próprio patrimônio; quem cresceu com escassez pode gastar assim que recebe, para "garantir que ainda é possível".');
  b.p('Não existe crença certa ou errada, mas existe crença que **trabalha a favor** e crença que trabalha contra. O primeiro passo é enxergá-las.');
  b.box('exercicio', 'Três perguntas para fazer com calma', [
    '- Qual é a frase sobre dinheiro que você mais ouviu em casa quando era criança?',
    '- Qual é a primeira emoção que aparece quando você abre o aplicativo do banco: alívio, medo, vergonha, indiferença?',
    '- Se o dinheiro não fosse um problema, o que você faria diferente na sua vida? (Escreva três coisas.)',
    'Guarde as respostas. No capítulo 9 elas vão virar metas.',
  ]);
  b.h2('Vergonha, culpa e a fuga do extrato');
  b.p('Existe um comportamento comum, e quase ninguém admite: **não olhar**. A pessoa sabe que a situação está difícil, então evita abrir o extrato, deixa a fatura sem ler, adia a ligação do banco. Quanto mais evita, maior o susto quando precisa olhar. É um ciclo: medo gera fuga, fuga gera juros, juros geram mais medo.');
  b.p('Se você se reconhece aqui, respire. Isso é humano, não é falta de caráter. Estudos de comportamento mostram que o cérebro trata ameaça financeira como ameaça física: ele quer fugir. O que quebra o ciclo é transformar o monstro em **lista**. Monstro assusta. Lista, a gente resolve.');
  b.box('historia', 'A Marta e o aplicativo fechado', [
    'Marta (nome fictício, situação bem comum) passou quatro meses sem abrir o aplicativo do banco. "Se eu não vejo, não existe", dizia. Quando finalmente abriu, descobriu três assinaturas esquecidas, uma parcela atrasada que já tinha virado juros e... um saldo menor do que temia, mas maior do que imaginava. Em uma tarde, anotou tudo em um papel: o que devia, para quem, quanto, quando. Metade da angústia sumiu antes de qualquer pagamento. A outra metade virou plano.',
  ]);
  b.h2('Três ideias para soltar os ombros');
  b.ul([
    '**Dinheiro é ferramenta, não nota da sua vida.** Estar endividado não diz quem você é. Diz em que ponto você está.',
    '**Progresso vale mais que perfeição.** Reduzir a dívida em 5% neste mês já é vitória. Quem espera o momento perfeito nunca começa.',
    '**Olhar é o primeiro passo.** Você não precisa resolver tudo hoje. Precisa apenas ver tudo hoje, num lugar só.',
  ]);
  b.box('atencao', 'Cuidado com a "terapia do consumo"', 'Comprar para se sentir melhor funciona por uns vinte minutos, e custa meses. Se você percebe que gasta mais quando está triste, ansioso ou entediado, anote o gatilho antes de tentar cortar o gasto. Entender o porquê vale mais que a força de vontade.');
  b.breath('Você não está atrasado na vida. Você está no ponto de partida de um plano melhor.');
  b.h3('Faça agora: a carta para daqui a um ano');
  b.p('Pegue um papel e escreva uma carta curta para você mesmo(a), com data de daqui a um ano. Conte como espera estar: o que quitou, o que juntou, como se sente quando abre o extrato. Guarde onde possa achar. Daqui a doze meses, você vai ler e provavelmente se surpreender com o quanto já andou.');

  // ------------------------------------------------------------ cap 2
  b.chapter({ num: 2, title: 'Para onde vai o seu dinheiro', subtitle: 'O diagnóstico simples que a maioria das pessoas nunca faz.', epigraph: 'O que não é medido não é gerenciado. O que é medido com carinho costuma melhorar sozinho.', art: 2 });
  b.lead('Você não precisa de uma planilha perfeita. Precisa de quatro números honestos e de uma tarde tranquila.');
  b.h2('Os 4 números que mudam tudo');
  b.p('Antes de qualquer método, você precisa saber onde está. Para isso, descubra apenas quatro números do seu mês. Anote em papel, sem julgamento:');
  b.ul([
    '**Renda líquida:** tudo o que realmente cai na sua conta, depois de descontos. Se a renda varia, use a média dos últimos seis meses (ou o mês mais baixo, para ser conservador).',
    '**Gastos fixos:** o que se repete e pouco muda: aluguel, condomínio, escola, plano de saúde, internet, transporte, parcelas.',
    '**Gastos variáveis:** o que muda mês a mês: mercado, lazer, roupas, delivery, farmácia, presentes.',
    '**Dívidas:** quanto você deve, para quem, a que juros e com que parcela. (Isso inclui cartão, cheque especial, empréstimos, financiamentos.)',
  ], { ordered: true });
  b.p('Pronto: com esses quatro números você já sabe se **sobra**, se **empata** ou se **falta** dinheiro no mês. E sabe quanto da sua renda está sendo engolida por dívidas, o número mais importante deste livro.');
  b.box('conta', 'O termômetro das dívidas', [
    'Some as parcelas de todas as dívidas e divida pela renda líquida.',
    '- Até 15%: tranquilo.',
    '- De 15% a 30%: atenção, mas administrável.',
    '- De 30% a 40%: zona de risco. Priorize renegociar.',
    '- Acima de 40%: emergência. Vai exigir plano de dívida e, possivelmente, ajuda externa (Procon, Defensoria, núcleo de conciliação).',
    'Exemplo: renda de R$ 3.500 e parcelas de R$ 1.400 = 40%. Esse é o seu ponto de partida, e tudo bem. Ponto de partida não é sentença.',
  ]);
  b.h2('Rastreie por 30 dias, sem drama');
  b.p('O orçamento do papel é uma ficção; o do extrato é a realidade. Por um mês, registre tudo o que entrou e saiu. Não precisa cortar nada ainda: só **observar**. Você tem três jeitos de fazer isso:');
  b.ul([
    '**Extrato do banco e da fatura:** baixe o último mês, em CSV ou PDF, e classifique cada linha. É o método mais rápido e menos sujeito a esquecimento.',
    '**Anotação diária:** um caderno ou nota no celular. Funciona bem para quem paga muito em dinheiro ou Pix.',
    '**Aplicativo:** o Prumo, do Fôlego, importa extratos e classifica os gastos automaticamente. Qualquer outro app serve, desde que você use.',
  ]);
  b.h2('Os três baldes');
  b.p('Depois de rastrear, separe os gastos em três baldes. É uma forma simples de enxergar o desenho do seu mês:');
  b.table({
    head: ['Balde', 'O que entra', 'Exemplos'],
    widths: [2, 4, 5],
    rows: [
      ['Essencial', 'O que você precisa para viver', 'Moradia, comida, transporte, saúde, contas de casa'],
      ['Escolhas', 'O que deixa a vida boa', 'Lazer, restaurantes, roupas, hobbies, presentes'],
      ['Futuro', 'O que protege e constrói', 'Dívidas, reserva, metas, investimentos'],
    ],
    note: 'Não existe proporção universal certa. Existe a que cabe na sua realidade e te deixa dormir bem.',
  });
  b.h2('Os vazamentos silenciosos');
  b.p('Quase todo mundo, ao rastrear, descobre dinheiro indo embora sem decisão consciente. Procure por:');
  b.ul([
    '**Assinaturas esquecidas:** streaming que você não vê, app de academia, seguro de celular duplicado.',
    '**Tarifas bancárias e anuidades:** pergunte ao banco o que você paga por mês e peça isenção ou troque de conta.',
    '**Juros e multas:** pagar boleto atrasado, rotativo do cartão, cheque especial. É o gasto mais caro e menos útil que existe.',
    '**Compras de impulso pequenas:** R$ 25 aqui, R$ 40 ali. Isoladas parecem nada; somadas, viram um aluguel.',
  ]);
  b.box('exercicio', 'Sua tarde de diagnóstico (60 minutos)', [
    '- Separe extrato do banco e faturas do último mês.',
    '- Marque cada gasto como essencial, escolha ou futuro.',
    '- Some cada balde e calcule o percentual sobre a renda líquida.',
    '- Circule três vazamentos para cortar ou renegociar nesta semana.',
    '- Calcule o termômetro das dívidas.',
  ]);

  // ------------------------------------------------------------ cap 3
  b.chapter({ num: 3, title: 'Orçamento que cabe na vida real', subtitle: 'Menos regras de planilha, mais um acordo realista com você mesmo(a).', epigraph: 'Um orçamento bom é aquele que você consegue seguir em um mês ruim.', art: 1 });
  b.lead('Orçamento não é prisão. É o jeito de dizer ao dinheiro, antes de ele ir embora, para onde você quer que ele vá.');
  b.h2('Por que a maioria dos orçamentos falha');
  b.p('Quem já tentou e desistiu não é desorganizado. Os orçamentos costumam falhar por razões previsíveis: são **apertados demais** (sem espaço para lazer, a pessoa explode), **complicados demais** (cinquenta categorias, ninguém mantém) ou **irreais** (ignoram os gastos que aparecem uma vez por ano). O orçamento certo é simples, flexível e tem folga.');
  b.h2('Quatro métodos para escolher');
  b.h3('1. Regra 50/30/20: o ponto de partida mais popular');
  b.p('Divida a renda líquida em três: **50% para o essencial**, **30% para as escolhas** e **20% para o futuro** (dívidas, reserva, metas). É fácil de lembrar e funciona como bússola, não como lei.');
  const renda = 3500;
  b.table({
    head: ['Balde', '%', 'Quanto (renda de R$ 3.500)', 'O que cobre'],
    widths: [2.4, 1, 3, 4],
    align: ['l', 'r', 'r', 'l'],
    rows: [
      ['Essencial', '50%', brl(renda * 0.5), 'Aluguel, comida, transporte, contas'],
      ['Escolhas', '30%', brl(renda * 0.3), 'Lazer, delivery, roupas, hobbies'],
      ['Futuro', '20%', brl(renda * 0.2), 'Dívidas, reserva, metas'],
    ],
    note: 'Se o aluguel pesa muito, ajuste: 60/20/20 ou 70/15/15 ainda é um plano válido. O que importa é existir o balde do futuro.',
  });
  b.h3('2. Pague-se primeiro');
  b.p('Antes de pagar qualquer outra coisa, separe a sua parte do futuro no dia em que o dinheiro cair. Mesmo que seja R$ 50. O gasto se adapta ao que sobra; a poupança quase nunca se forma do que "sobrou". Automatize: uma transferência programada para o dia seguinte ao salário tira a decisão da sua cabeça.');
  b.h3('3. Orçamento base zero');
  b.p('Cada real recebe uma função até a renda zerar: 1.200 para aluguel, 600 para mercado, 300 para dívida, 200 para reserva... No fim, "renda menos destinos" dá zero. Funciona bem para quem gosta de controle e tem renda estável.');
  b.h3('4. Envelopes (físicos ou digitais)');
  b.p('Para categorias onde você escorrega (delivery, lazer, compras), defina um valor mensal em um "envelope". Acabou? Acabou. Funciona muito bem para quem estoura no cartão, porque transforma um limite abstrato em algo concreto.');
  b.box('dica', 'Qual escolher?', [
    '- Quer começar sem complicar: 50/30/20.',
    '- Tem dificuldade em poupar: pague-se primeiro.',
    '- Gosta de precisão: base zero.',
    '- Estoura em categorias específicas: envelopes.',
    'Você pode (e deve) misturar: pagar-se primeiro + envelopes para as categorias problemáticas é uma combinação excelente.',
  ]);
  b.h2('As contas que aparecem de surpresa');
  b.p('IPVA, IPTU, material escolar, seguro do carro, presentes de fim de ano, o conserto da geladeira. Elas não são surpresa de verdade: acontecem todo ano. O truque é transformar o gasto anual em uma parcela mensal e guardar **antes** que ele chegue. Chamamos de "cofrinho das contas anuais".');
  const anuais = [['IPVA', 1800], ['IPTU', 1200], ['Material escolar', 900], ['Seguro e revisão do carro', 1500], ['Presentes e festas', 1200], ['Imprevistos da casa', 1200]];
  const totalAnual = anuais.reduce((s, a) => s + a[1], 0);
  b.table({
    head: ['Conta anual (exemplo)', 'Valor no ano', 'Guardar por mês'],
    widths: [5, 3, 3],
    align: ['l', 'r', 'r'],
    rows: [...anuais.map((a) => [a[0], brl(a[1]), brl2(a[1] / 12)]), ['TOTAL', brl(totalAnual), brl2(totalAnual / 12)]],
    note: 'Guardar R$ 650 por mês parece muito? Compare com o susto de R$ 7.800 aparecendo em três meses diferentes do ano.',
  });
  b.box('exercicio', 'Monte o seu cofrinho anual', [
    '- Liste as contas que você paga uma ou duas vezes por ano (veja o extrato dos últimos 12 meses).',
    '- Some e divida por 12.',
    '- Abra uma conta, caixinha ou investimento de liquidez diária só para isso e programe a transferência mensal.',
  ]);

  // ------------------------------------------------------------ cap 4
  b.chapter({ num: 4, title: 'Dívidas: sair do vermelho sem surtar', subtitle: 'Entender como os juros funcionam é metade da solução. A outra metade é método.', epigraph: 'Dívida é um problema matemático com um componente emocional. Resolva primeiro o emocional.', art: 3 });
  b.lead('Você pode estar devendo e, ainda assim, ter muito mais controle do que imagina. O truque é trocar o desespero por ordem.');
  b.h2('Como a dívida cresce (e por que o cartão é o vilão)');
  b.p('Juros compostos são juros sobre juros. Num investimento, isso trabalha a seu favor. Numa dívida cara, trabalha **contra você**, e rápido. Veja o que acontece com R$ 1.000 deixados no rotativo do cartão, com uma taxa ilustrativa de 12% ao mês, sem pagar nada:');
  const rows = [];
  for (let m = 0; m <= 12; m += 3) {
    rows.push([String(m), brl2(1000 * 1.12 ** m), m === 0 ? '—' : `+${Math.round(((1.12 ** m) - 1) * 100)}%`]);
  }
  b.table({ head: ['Meses', 'Quanto você deve', 'Crescimento'], widths: [2, 4, 3], align: ['r', 'r', 'r'], rows, note: 'Taxa ilustrativa. Confira a taxa real do seu contrato: ela costuma estar no extrato ou na fatura (campo "juros do rotativo").' });
  b.p('Em um ano, R$ 1.000 viram quase **R$ 3.900**. É por isso que a primeira regra das dívidas é: **combata primeiro as de juros mais altos** (rotativo do cartão, cheque especial, empréstimos de financeiras).');
  b.h2('A ordem certa de prioridades');
  b.ul([
    '**Contas essenciais:** moradia, luz, água, comida, saúde. Sem elas, o resto desmorona.',
    '**Dívidas de juros altos:** rotativo, cheque especial, financeiras. Cada mês parada custa muito.',
    '**Dívidas com garantia:** financiamento de casa e carro, por causa do risco de perder o bem.',
    '**Dívidas de juros baixos:** consignado, financiamentos longos. Pagar em dia basta.',
  ], { ordered: true });
  b.h2('Avalanche ou bola de neve?');
  b.p('Duas estratégias clássicas para quitar várias dívidas. Em ambas, você paga o **mínimo em todas** e coloca todo o dinheiro extra em uma só, a "dívida-alvo". Quando ela some, a parcela que sobrou passa para a próxima: é o efeito cascata.');
  b.ul([
    '**Avalanche:** o alvo é a dívida de **maior juro**. Matematicamente, é o que menos custa.',
    '**Bola de neve:** o alvo é a dívida de **menor saldo**. Custa um pouco mais em juros, mas dá vitórias rápidas, e motivação também paga conta.',
  ]);
  const debts = [
    { name: 'Cartão', bal: 3000, rate: 12, min: 300 },
    { name: 'Loja', bal: 1500, rate: 5, min: 150 },
    { name: 'Consignado', bal: 6000, rate: 2, min: 250 },
  ];
  const av = payoff(debts, 300, 'avalanche');
  const sn = payoff(debts, 300, 'snowball');
  b.box('conta', 'Os dois métodos na prática (exemplo)', [
    'Três dívidas: cartão (R$ 3.000, 12% ao mês, mínimo R$ 300), loja (R$ 1.500, 5% ao mês, mínimo R$ 150) e consignado (R$ 6.000, 2% ao mês, mínimo R$ 250). Extra disponível: R$ 300 por mês.',
  ]);
  b.table({
    head: ['Método', 'Tempo para quitar tudo', 'Juros pagos no total', 'Primeira a cair'],
    widths: [2.4, 3, 3, 2.6],
    align: ['l', 'r', 'r', 'l'],
    rows: [
      ['Avalanche', `${av.months} meses`, brl(av.interest), av.order[0]],
      ['Bola de neve', `${sn.months} meses`, brl(sn.interest), sn.order[0]],
    ],
    note: `Diferença: ${brl(Math.abs(sn.interest - av.interest))} em juros. Se a bola de neve te mantiver motivado(a), vale o custo extra; se você é do tipo que persevera com a conta na mão, a avalanche economiza.`,
  });
  b.h2('Como renegociar sem cair em armadilhas');
  b.p('Renegociar é conversar, não implorar. Credores querem receber, e muitas vezes preferem um acordo realista a uma dívida eterna. Siga este roteiro:');
  b.ul([
    '**Prepare seus números:** quanto você pode pagar por mês sem faltar com o essencial. Esse é o seu limite, e ninguém pode empurrar além dele.',
    '**Peça o saldo atualizado, por escrito:** valor original, juros, multa, encargos.',
    '**Peça o CET** (Custo Efetivo Total) da proposta: ele mostra o custo real, com todas as taxas. Compare propostas pelo CET, não só pela parcela.',
    '**Negocie à vista, com desconto:** quem tem alguma reserva muitas vezes consegue abatimentos grandes em dívidas antigas.',
    '**Guarde tudo:** protocolo, acordo, comprovante. Se o acordo não sair do papel, você terá como provar.',
  ], { ordered: true });
  b.box('atencao', 'Parcela que cabe vs. parcela que você mantém', 'Aceitar uma parcela que só cabe "se tudo der certo" é montar a próxima dívida. Se o acordo exige que você corte mercado, escola ou remédio, ele está caro demais. Volte e negocie de novo.');
  b.h2('Seus direitos como consumidor endividado');
  b.p('A lei protege quem deve, e muita gente não sabe. Em linhas gerais (confira sempre os detalhes com o Procon, a Defensoria Pública ou um advogado):');
  b.ul([
    '**Superendividamento:** a Lei 14.181/2021 permite pedir a renegociação conjunta de todas as dívidas de consumo, preservando o mínimo para a sua subsistência. O caminho é o Procon, a Defensoria ou os núcleos de conciliação dos tribunais.',
    '**Teto de juros no cartão:** desde 2024, juros e encargos do rotativo e do parcelamento da fatura não podem passar de 100% do valor original da dívida.',
    '**Cobrança respeitosa:** o credor não pode constranger, ameaçar, expor ou ligar de madrugada. Isso é infração, e você pode denunciar.',
    '**Prazo para cobrar:** dívidas muito antigas podem estar prescritas (em regra, 5 anos para a maioria das dívidas em contrato), mas isso tem exceções e se avalia caso a caso. Não ignore cobranças sem checar.',
  ]);
  b.box('atencao', 'Cuidado com quem "limpa o nome"', 'Ninguém limpa nome de forma garantida e cobra adiantado. Quem promete isso costuma ser golpe, ou cobra por algo que você mesmo pode fazer de graça (negociar direto no site do credor ou em feirões oficiais). Nunca pague antes de ver o serviço entregue.');
  b.checklist('Antes de assinar qualquer acordo', [
    'A parcela cabe no meu mês depois de pagar o essencial?',
    'Eu sei o valor total que vou pagar e o CET?',
    'O acordo está por escrito, com valores, datas e as dívidas que ele quita?',
    'Há alguma tarifa, seguro ou serviço embutido que eu não pedi?',
    'Eu tenho como provar o pagamento de cada parcela?',
  ]);
  b.breath('Dívida se resolve uma parcela de cada vez. Mas só começa a ser resolvida quando você olha para ela.');
}
