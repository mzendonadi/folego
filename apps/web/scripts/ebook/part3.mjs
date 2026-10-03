// Parte 3: capítulos 10 a 15, glossário e encerramento.
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Anos até a liberdade financeira poupando uma fração da renda, com retorno real anual e meta de 25x o gasto anual. */
export function yearsToFreedom(savingsRate, realReturn = 0.04) {
  const income = 1;
  const savings = income * savingsRate;
  const spend = income - savings;
  const target = spend * 25;
  if (savings <= 0) return Infinity;
  return Math.log((target * realReturn + savings) / savings) / Math.log(1 + realReturn);
}

export function part3(b) {
  // ------------------------------------------------------------ cap 10
  b.chapter({ num: 10, title: 'Renda extra e o valor do seu tempo', subtitle: 'Quando cortar não basta, aumentar a entrada é um caminho legítimo.', epigraph: 'Economizar tem piso: você não corta abaixo de zero. Ganhar mais não tem teto.', art: 2 });
  b.lead('Cortar gastos ajuda até certo ponto. A partir daí, o que muda o jogo é a outra ponta da equação: quanto entra.');
  b.h2('Quanto vale a sua hora');
  b.p('Antes de aceitar qualquer trabalho extra, saiba o valor do seu tempo. Pegue a sua renda líquida mensal e divida pelas horas que você realmente dedica ao trabalho, incluindo deslocamento.');
  b.box('conta', 'Valor da hora', [
    'Exemplo: renda líquida de R$ 3.600 por mês. Trabalho de 8h por dia, 22 dias, mais 1h30 de deslocamento por dia = 209 horas.',
    `Valor da hora ≈ ${brl(3600 / 209)} (e isso é líquido, sem contar o cansaço).`,
    'Se um bico paga menos que isso depois de custos e deslocamento, ele pode valer o dinheiro, mas só se a necessidade for grande ou se ele abrir portas.',
  ]);
  b.h2('De onde pode vir uma renda extra');
  b.ul([
    '**Venda do que está parado:** móveis, eletrônicos, roupas, livros. Dinheiro rápido, sem custo, e ainda libera espaço.',
    '**Serviços com o que você já sabe:** aulas, reforço escolar, reparos, costura, culinária, fotografia, organização, cuidado de pets.',
    '**Trabalho remoto e freelas:** tradução, design, redação, suporte, edição de vídeo, atendimento.',
    '**Revenda e artesanato:** compra planejada com margem clara, pequena escala, sem estoque grande no começo.',
    '**Aproveitar o que a casa oferece:** alugar vaga de garagem, espaço ocioso, equipamentos.',
  ]);
  b.h2('Teste pequeno antes de apostar grande');
  b.p('Regra de ouro: **não se endivide para começar**. Valide a ideia com o que você já tem, vendendo para conhecidos ou pedindo parte do pagamento adiantado. Se funcionar, reinvista o lucro. Se não funcionar, você perdeu pouco e aprendeu muito.');
  b.checklist('Teste da ideia em 4 semanas', [
    'Semana 1: escolher uma ideia, listar o que já tenho e definir o preço (custo + tempo + margem).',
    'Semana 2: oferecer para 10 pessoas conhecidas e fazer as primeiras vendas.',
    'Semana 3: pedir feedback, ajustar preço e oferta.',
    'Semana 4: decidir: continuar, mudar ou parar, com números na mão.',
  ]);
  b.h2('Quando o negócio cresce: formalização');
  b.p('Se a renda extra se torna frequente, vale conhecer o **MEI** (Microempreendedor Individual): um CNPJ simplificado, com pagamento mensal fixo de impostos, direito a nota fiscal, benefícios previdenciários e acesso a crédito e fornecedores melhores. Há limite de faturamento anual e regras de atividade permitida. Converse com um contador ou procure o Sebrae antes de decidir.');
  b.box('atencao', 'Cuidado com as promessas', [
    '- "Ganhe R$ 5 mil por mês sem sair de casa": desconfie. Quem promete renda fácil costuma vender curso.',
    '- Trabalho que pede pagamento antecipado para "liberar vagas" ou "kits": golpe clássico.',
    '- Pirâmides disfarçadas de "negócio": se o ganho vem de recrutar pessoas, não de vender produto, fuja.',
    '- Renda extra tem imposto: no Imposto de Renda e, dependendo da atividade, em outros tributos.',
  ]);
  b.box('dica', 'Proteja o que já paga as contas', 'Seu emprego, sua saúde e o seu descanso vêm antes. Uma renda extra que te faz perder o sono ou o desempenho no trabalho principal sai cara. Comece com 3 a 5 horas por semana e aumente com cuidado.');

  // ------------------------------------------------------------ cap 11
  b.chapter({ num: 11, title: 'Consumo consciente: a arte de decidir', subtitle: 'Gastar bem não é gastar pouco: é gastar com intenção.', epigraph: 'Cada compra é um voto no tipo de vida que você quer ter.', art: 3 });
  b.lead('Ninguém quer viver como monge. A ideia aqui é outra: gastar mais naquilo que traz alegria de verdade, e parar de gastar no que só traz peso.');
  b.h2('Os gatilhos que empurram você para a compra');
  b.p('As lojas, os aplicativos e a publicidade conhecem bem o cérebro humano. Alguns gatilhos clássicos:');
  b.ul([
    '**Urgência falsa:** "só hoje", contador regressivo, "últimas unidades".',
    '**Parcelamento disfarçado:** "só 12 vezes de R$ 49", o que apaga a sensação do preço total.',
    '**Comparação social:** vitrines perfeitas nas redes sociais.',
    '**Frete grátis:** que te faz comprar um item a mais para "valer a pena".',
    '**Fricção zero:** compra com um clique, cartão salvo, Pix instantâneo.',
  ]);
  b.h2('A regra das 24 horas (ou 7 dias)');
  b.p('Para compras não planejadas acima de um valor que você define (por exemplo, R$ 100), espere 24 horas. Para as acima de R$ 500, espere uma semana. Anote o desejo em uma lista. Se ele sobreviver ao tempo e couber no seu orçamento, compre sem culpa. Na maioria das vezes, a vontade passa.');
  b.h2('Custo por uso: a conta que muda a decisão');
  b.p('O preço de uma compra deve ser dividido pelo número de vezes que você vai usar. Algumas coisas caras são baratas por uso; algumas baratas são caras por nunca serem usadas.');
  b.table({
    head: ['Compra', 'Preço', 'Usos esperados', 'Custo por uso'],
    widths: [5, 2.5, 3, 3],
    align: ['l', 'r', 'r', 'r'],
    rows: [
      ['Tênis de caminhada', brl(320), '150', `R$ ${(320 / 150).toFixed(2).replace('.', ',')}`],
      ['Roupa de festa', brl(280), '2', `R$ ${(280 / 2).toFixed(2).replace('.', ',')}`],
      ['Panela de qualidade', brl(240), '1.500', `R$ ${(240 / 1500).toFixed(2).replace('.', ',')}`],
      ['Aparelho de academia (usado 3x)', brl(900), '3', `R$ ${(900 / 3).toFixed(2).replace('.', ',')}`],
    ],
  });
  b.h2('Cartão de crédito: ferramenta ou armadilha');
  b.ul([
    '**Use como débito:** só gaste o que já tem na conta. Pague sempre o **valor total** da fatura.',
    '**Nunca pague o mínimo** a não ser em emergência: o restante entra no rotativo, o crédito mais caro que existe.',
    '**Evite parcelar o que dura menos do que a parcela.** Jantar parcelado em 6 vezes é dívida de comida.',
    '**Programe o pagamento automático** do valor total para evitar atrasos.',
    '**Revise a fatura todo mês**, linha a linha. É onde moram as assinaturas esquecidas.',
  ]);
  b.box('exercicio', 'Faxina de assinaturas (15 minutos)', [
    '- Abra as últimas três faturas e o extrato.',
    '- Liste tudo o que se repete mensalmente.',
    '- Para cada item, pergunte: usei no último mês? Valeu o preço? Se não, cancele agora.',
    '- Some o valor economizado por ano. Muita gente se surpreende.',
  ]);
  b.box('dica', 'Black Friday e promoções: o plano', 'Faça a lista do que realmente precisa **antes** da data, pesquise o preço dos últimos meses e defina um teto. O desconto verdadeiro é o que cai no seu orçamento, não o que está na etiqueta.');

  // ------------------------------------------------------------ cap 12
  b.chapter({ num: 12, title: 'Proteção: seguros, golpes e papéis em dia', subtitle: 'O que fazer para um tombo não derrubar tudo que você construiu.', epigraph: 'Ganhar dinheiro é uma habilidade. Não perdê-lo é outra, tão importante quanto.', art: 1 });
  b.lead('Planejar financeiramente também é se proteger: de acidentes, de golpes e de desorganização.');
  b.h2('Seguros: quando fazem sentido');
  b.p('Seguro é pagar um custo pequeno e certo para evitar um prejuízo grande e incerto. Os que mais costumam fazer sentido:');
  b.ul([
    '**Seguro de vida:** se há pessoas que dependem da sua renda (cônjuge, filhos). Para quem vive sozinho(a) e sem dependentes, costuma ser dispensável.',
    '**Plano de saúde ou reserva para saúde:** um problema grave sem cobertura pode consumir anos de poupança.',
    '**Seguro residencial:** barato e cobre incêndio, roubo, danos elétricos.',
    '**Seguro do carro:** conforme o valor do bem e o risco da região.',
    '**Seguro de celular e garantia estendida:** costumam custar caro para o que cobrem. Compare antes.',
  ]);
  b.h2('Previdência privada: o que é, sem jargão');
  b.p('Previdência privada é um tipo de investimento para o longo prazo, com benefícios fiscais em alguns casos. Há dois tipos principais, **PGBL** e **VGBL**, que se diferem na forma como o Imposto de Renda é cobrado. Há também a tabela regressiva (quanto mais tempo, menor a alíquota) e taxas de administração e carregamento que podem pesar. Compare sempre as taxas e pergunte ao gerente (ou a um profissional independente) qual opção combina com a sua situação fiscal.');
  b.h2('Os golpes financeiros mais comuns');
  b.table({
    head: ['Golpe', 'Como funciona', 'Como se proteger'],
    widths: [3, 5, 6],
    rows: [
      ['Falsa central', 'Ligam como se fossem o banco e pedem "confirmar" dados ou mover dinheiro', 'Desligue e ligue você mesmo(a) para o número do cartão. Banco nunca pede senha'],
      ['WhatsApp clonado', 'Alguém se passa por parente pedindo Pix urgente', 'Ligue ou chame em vídeo antes de pagar. Ative a verificação em duas etapas'],
      ['"Limpa nome" ou crédito fácil', 'Cobram taxa adiantada para liberar um empréstimo ou limpar o nome', 'Nenhum crédito legítimo exige depósito antecipado'],
      ['Investimento milagroso', 'Prometem retornos garantidos e altos', 'Confira CNPJ, CVM e Banco Central. Desconfie de pressa'],
      ['Boleto ou link falso', 'Boleto adulterado, site clonado, SMS de "multa" ou "encomenda"', 'Confira o beneficiário e acesse sempre pelo app ou site oficial'],
    ],
  });
  b.box('atencao', 'Regras de ouro contra golpes', [
    '- Banco, operadora e governo não ligam pedindo senha, código ou Pix.',
    '- Pressa e segredo são o sinal número um de golpe.',
    '- Ative a verificação em duas etapas em e-mail, WhatsApp e banco.',
    '- Caiu? Avise o banco imediatamente e peça a devolução pelo mecanismo especial do Pix. Registre boletim de ocorrência. Não há garantia de recuperar, mas agir rápido ajuda.',
  ]);
  b.h2('A pasta do "dia em que algo der errado"');
  b.p('Reúna em um lugar seguro (físico e digital): documentos pessoais, apólices de seguro, contratos, comprovantes de residência e de renda, lista de senhas em um gerenciador, contatos importantes e instruções para quem cuida de você. Uma tarde de organização poupa semanas de dor de cabeça se algo acontecer.');
  b.checklist('Checklist de proteção', [
    'Verificação em duas etapas ativada no e-mail, no WhatsApp e nos aplicativos de banco.',
    'Senhas diferentes e fortes, de preferência em um gerenciador.',
    'Seguros avaliados: vida (se há dependentes), residencial, saúde ou reserva para saúde.',
    'Pasta de documentos e contatos atualizada.',
    'Alguém de confiança sabe onde estão as informações importantes.',
  ]);

  // ------------------------------------------------------------ cap 13
  b.chapter({ num: 13, title: 'Dinheiro em família', subtitle: 'Casal, filhos, pais: finanças são um assunto de convivência.', epigraph: 'Casais não brigam por dinheiro. Brigam por valores que o dinheiro revela.', art: 0 });
  b.lead('Falar de dinheiro com quem a gente ama é, para muita gente, o assunto mais difícil. Mas é também o que mais protege a relação.');
  b.h2('A conversa com o(a) parceiro(a)');
  b.p('Combine um momento tranquilo (nunca no meio de uma briga ou com a fatura na mão) e comece pelo que cada um **sonha**, antes de falar do que cada um **gasta**. O objetivo não é achar culpados, é montar um plano a dois.');
  b.box('exercicio', 'Roteiro para a primeira conversa', [
    '- Cada um escreve, sozinho, três sonhos para os próximos cinco anos.',
    '- Depois, cada um conta quanto ganha, o que deve e como se sente em relação ao dinheiro.',
    '- Juntos, listam as contas da casa e decidem como dividi-las.',
    '- Combinam um valor mensal "livre" para cada um, sem prestar contas.',
    '- Marcam uma revisão mensal curta (20 minutos).',
  ]);
  b.h2('Como dividir as contas');
  b.table({
    head: ['Modelo', 'Como funciona', 'Bom para'],
    widths: [3, 6, 5],
    rows: [
      ['Tudo junto', 'Todas as rendas vão para uma conta comum; as despesas saem dela', 'Casais com rendas e objetivos muito alinhados'],
      ['Tudo separado', 'Cada um paga partes definidas das despesas', 'Quem está começando a viver junto'],
      ['Proporcional', 'Cada um contribui na proporção da renda', 'Rendas diferentes, busca de justiça'],
      ['Híbrido', 'Conta conjunta para a casa + contas individuais para o resto', 'O mais comum e flexível'],
    ],
  });
  b.h2('Filhos e dinheiro');
  b.p('Crianças aprendem muito mais pelo exemplo do que por sermões. Deixe que elas vejam você planejando, comparando preço e esperando para comprar. A partir dos 6 ou 7 anos, uma pequena mesada (sem atrelar a tarefas obrigatórias da casa) ensina a escolher, e a lidar com o "acabou". Com adolescentes, converse sobre salário, boleto e custo de vida: é a melhor aula de educação financeira do mundo.');
  b.h2('Pais idosos e dinheiro');
  b.p('Cuidar de quem cuidou da gente envolve temas delicados: renda, saúde, moradia, herança. Converse cedo e com respeito, sem tomar decisões por eles. Ajude a organizar documentos, a conhecer golpes que miram idosos e a deixar a vontade registrada. Muita briga de família nasce de assuntos que ninguém teve coragem de falar a tempo.');
  b.breath('Finanças em família funcionam melhor quando a pergunta deixa de ser "quem errou?" e vira "o que a gente quer construir?".');

  // ------------------------------------------------------------ cap 14
  b.chapter({ num: 14, title: 'Liberdade financeira: o que é, e como chegar', subtitle: 'Não é sobre nunca mais trabalhar. É sobre trabalhar porque quer.', epigraph: 'Liberdade financeira é quando o dinheiro deixa de ser o motivo das suas decisões.', art: 3 });
  b.lead('A liberdade financeira costuma ser vendida como fuga. Na prática, é a conquista de escolhas: recusar um emprego ruim, mudar de cidade, cuidar de quem precisa, empreender, descansar.');
  b.h2('Os quatro níveis');
  b.table({
    head: ['Nível', 'Como se sente', 'O que já existe'],
    widths: [3, 5, 7],
    rows: [
      ['1. Segurança', 'Dá para dormir', 'Contas em dia, sem dívida cara, reserva de 3 meses'],
      ['2. Estabilidade', 'Imprevistos não assustam', 'Reserva completa, seguros básicos, metas em andamento'],
      ['3. Flexibilidade', 'Dá para escolher um pouco', 'Investimentos cobrindo parte relevante das despesas'],
      ['4. Liberdade', 'Trabalhar é opção', 'Patrimônio cuja renda cobre o custo de vida'],
    ],
  });
  b.h2('O número da liberdade');
  b.p('Uma regra de bolso muito usada é a **regra dos 4%**: se você consegue viver retirando 4% ao ano do seu patrimônio (sem corroê-lo ao longo do tempo), ele precisa ter cerca de **25 vezes o seu gasto anual**. É uma referência, não uma garantia: foi calculada em outro país e depende de inflação, taxas e comportamento dos mercados. Mas é um ótimo ponto de partida para fazer a conta.');
  b.table({
    head: ['Gasto mensal', 'Gasto anual', 'Patrimônio de referência (25x)'],
    widths: [3, 3, 5],
    align: ['r', 'r', 'r'],
    rows: [3000, 5000, 8000, 12000].map((g) => [brl(g), brl(g * 12), brl(g * 12 * 25)]),
    note: 'Cálculo simples de referência. Revise com um profissional, considerando impostos, inflação, dependentes e planos de vida.',
  });
  b.box('dica', 'Duas alavancas poderosas', [
    '- **Gastar menos** reduz o número que você precisa alcançar e aumenta o quanto você consegue guardar. Duplo efeito.',
    '- **Ganhar mais** acelera tudo, desde que você não suba o padrão de vida na mesma proporção.',
  ]);
  b.h2('Quanto tempo leva: a taxa de poupança manda');
  b.p('Quanto mais da sua renda você guarda, menos tempo leva. O gráfico mental é simples: quem poupa 10% da renda leva décadas; quem poupa 50% leva poucos anos. A tabela abaixo usa um retorno real (acima da inflação) de 4% ao ano, partindo do zero, só para ilustrar:');
  b.table({
    head: ['Poupa da renda', 'Anos até a liberdade (ilustrativo)'],
    widths: [4, 6],
    align: ['l', 'r'],
    rows: [10, 20, 30, 50, 70].map((r) => [`${r}%`, `${yearsToFreedom(r / 100).toFixed(0)} anos`]),
    note: 'Modelo simplificado: retorno real de 4% ao ano, meta de 25x o gasto anual, sem imprevistos. Não é previsão.',
  });
  b.p('A lição não é "poupe 70%". É perceber que **cada ponto percentual a mais na taxa de poupança compra tempo da sua vida de volta**. Subir de 10% para 20% já corta mais da metade do caminho.');
  b.h2('Dinheiro bom é dinheiro com propósito');
  b.p('Liberdade financeira sem sentido vira tédio. Antes de cobrar-se um número, responda: o que você quer fazer com o seu tempo? Estar com quem ama? Estudar? Viajar? Empreender? Trabalhar menos horas? Essa resposta vira o seu "porquê", e é o que sustenta a disciplina nos meses difíceis.');
  b.box('exercicio', 'O seu número, em 15 minutos', [
    '- Some seus gastos mensais essenciais e desejáveis (use o diagnóstico do capítulo 2).',
    '- Multiplique por 12 e depois por 25. Esse é o patrimônio de referência.',
    '- Divida pelo quanto você consegue guardar por ano. Esse é o tamanho do desafio, sem considerar rendimento.',
    '- Escolha uma alavanca para mexer neste trimestre: gastar menos, ganhar mais ou investir melhor.',
  ]);

  // ------------------------------------------------------------ cap 15
  b.chapter({ num: 15, title: 'Seu plano de 90 dias', subtitle: 'Do "preciso me organizar" para a primeira vitória, passo a passo.', epigraph: 'Três meses não resolvem uma vida inteira. Mas mudam completamente a direção.', art: 2 });
  b.lead('Chegou a hora de transformar tudo em calendário. Siga as semanas abaixo, no seu ritmo. Se atrasar, siga de onde parou, o plano espera por você.');
  b.table({
    head: ['Semana', 'Foco', 'Ação concreta'],
    widths: [2, 4, 9],
    rows: [
      ['1', 'Olhar', 'Fazer o diagnóstico: 4 números, termômetro das dívidas'],
      ['2', 'Rastrear', 'Registrar todos os gastos; listar vazamentos e assinaturas'],
      ['3', 'Cortar vazamentos', 'Cancelar o que não usa; renegociar tarifas e contratos'],
      ['4', 'Montar o orçamento', 'Escolher um método (50/30/20, base zero, envelopes) e configurar'],
      ['5', 'Organizar dívidas', 'Listar todas com taxa e saldo; escolher avalanche ou bola de neve'],
      ['6', 'Renegociar', 'Ligar para os credores; comparar propostas pelo CET'],
      ['7', 'Reserva: degrau 1', 'Abrir a conta ou caixinha e programar o aporte mensal'],
      ['8', 'Cofrinho das contas anuais', 'Listar e dividir por 12; automatizar'],
      ['9', 'Metas', 'Definir três metas com nome, valor, prazo e primeiro passo'],
      ['10', 'Renda', 'Calcular o valor da hora; testar uma ideia de renda extra'],
      ['11', 'Proteção', 'Ativar verificação em duas etapas; revisar seguros; pasta de documentos'],
      ['12', 'Revisão e comemoração', 'Refazer a roda da vida e o termômetro; reconhecer cada conquista'],
    ],
  });
  b.h2('Os rituais que sustentam o plano');
  b.ul([
    '**Toda semana (10 minutos):** lançar o que faltou, ver o que vence e escolher uma melhoria.',
    '**Todo mês (30 minutos):** fechar o mês, comparar com o anterior, ajustar categorias e aportes.',
    '**Todo trimestre (1 tarde):** revisar metas, a roda da vida e o termômetro das dívidas.',
    '**Todo ano:** revisar seguros, contratos, assinaturas e metas de longo prazo.',
  ]);
  b.h2('Três números para acompanhar');
  b.table({
    head: ['Indicador', 'Como medir', 'Boa direção'],
    widths: [4, 6, 4],
    rows: [
      ['Taxa de poupança', '(renda − gastos) ÷ renda', 'Subindo, rumo a 20% ou mais'],
      ['Peso das dívidas', 'Parcelas ÷ renda líquida', 'Descendo, abaixo de 30%'],
      ['Meses de reserva', 'Reserva ÷ custo essencial', 'Subindo, rumo a 6 meses'],
    ],
  });
  b.box('dica', 'Um aliado no dia a dia', 'Tudo o que você viu neste livro funciona com papel e caneta. Se quiser um parceiro para o dia a dia, o **Prumo**, o app de finanças do Fôlego, junta lançamentos, dívidas com plano de quitação, metas, lembretes, o cenário econômico e um coach que mostra, todo dia, o próximo passo. Você mesmo(a) decide como usar.');
  b.checklist('Seu compromisso', [
    'Escolhi a data de início do meu plano de 90 dias.',
    'Defini o meu "porquê": o que quero mudar na minha vida.',
    'Combinei com alguém de confiança para me cobrar com carinho.',
    'Marquei no calendário a revisão da semana 12.',
  ]);

  // ------------------------------------------------------------ glossário
  b.page();
  b.h2('Glossário rápido');
  b.table({
    head: ['Termo', 'Em português claro'],
    widths: [3, 11],
    rows: [
      ['Amortização', 'Parte da parcela que reduz a dívida de verdade (o resto é juros)'],
      ['CDB', 'Título de renda fixa emitido por bancos; pode ter liquidez diária ou prazo'],
      ['CDI', 'Taxa de referência entre bancos, parecida com a Selic; muito usada em renda fixa'],
      ['CET', 'Custo Efetivo Total: o custo real de um crédito, com juros, tarifas e seguros'],
      ['Copom', 'Comitê do Banco Central que define a Selic'],
      ['Diversificar', 'Distribuir o dinheiro em ativos diferentes para reduzir risco'],
      ['FGC', 'Fundo que garante parte do dinheiro aplicado em produtos bancários'],
      ['Inflação', 'Aumento geral dos preços; reduz o poder de compra'],
      ['IPCA', 'Índice oficial de inflação no Brasil'],
      ['Juros compostos', 'Juros calculados sobre o capital mais os juros acumulados'],
      ['Juro real', 'Rendimento acima da inflação'],
      ['Liquidez', 'Facilidade de transformar um investimento em dinheiro'],
      ['MEI', 'Microempreendedor Individual: CNPJ simplificado para pequenos negócios'],
      ['Portabilidade', 'Levar uma dívida para outro banco com condições melhores'],
      ['Prescrição', 'Perda do direito de cobrar judicialmente depois de certo prazo'],
      ['Renda fixa', 'Investimentos com regras de rendimento definidas na contratação'],
      ['Renda variável', 'Investimentos cujo valor oscila (ex.: ações)'],
      ['Reserva de emergência', 'Dinheiro guardado para imprevistos, em lugar seguro e líquido'],
      ['Rotativo', 'Crédito automático do cartão quando você não paga a fatura inteira; um dos mais caros'],
      ['Selic', 'Taxa básica de juros da economia brasileira'],
      ['Spread', 'Diferença entre o que o banco paga para captar e cobra para emprestar'],
      ['Superendividamento', 'Incapacidade de pagar todas as dívidas sem comprometer o mínimo para viver'],
      ['Tesouro Direto', 'Programa para comprar títulos públicos federais pela internet'],
      ['Taxa de poupança', 'Percentual da renda que você guarda'],
    ],
  });

  // ------------------------------------------------------------ mensagem final
  b.page();
  b.h2('Uma última conversa');
  b.p('Se você chegou até aqui, já fez o que a maioria não faz: parou, respirou e foi atrás de entender. Isso, sozinho, já muda uma trajetória.');
  b.p('Talvez você tenha reconhecido a sua história em algumas páginas. Talvez tenha sentido um aperto ao ver um número. Está tudo certo. Dinheiro é um assunto emocional, e tratar dele com carinho, e não com culpa, é parte do método.');
  b.p('Nos próximos meses, você vai ter dias bons e dias ruins. Vai errar a categoria, estourar o limite, esquecer de lançar. Faz parte. O que importa é a direção: **um pouco melhor a cada mês**. Em um ano, você olhará para trás e perceberá que quem escreveu aquela carta no capítulo 1 já está em outro lugar.');
  b.quote('Primeiro você respira. Depois organiza. Depois avança.', 'Equipe Fôlego');
  b.p('Se precisar de ajuda ao longo do caminho, o Fôlego está aqui: com o diagnóstico gratuito, as ferramentas e o Prumo, o nosso app de finanças. E, se em algum momento sentir que precisa de mais suporte, podemos te direcionar para um parceiro Fôlego.');
  b.space(8);
  b.box('atencao', 'Aviso legal', 'Este material tem caráter exclusivamente educativo. Não constitui recomendação de investimento, consultoria financeira, jurídica ou tributária individualizada. Exemplos e taxas são ilustrativos e não garantem resultados. Decisões financeiras envolvem riscos e devem considerar a sua situação pessoal; quando necessário, consulte profissionais habilitados. Leis e regras citadas podem mudar: confira as informações vigentes.');
  b.p('© Fôlego · folego.online. Você pode compartilhar este eBook com quem você acha que vai gostar. Só não o venda.');
}
