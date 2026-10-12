# Migração do Asaas para a conta da empresa (Emegetech)

Plano B escolhido pelo dono em 2026-10-12: **criar uma conta nova de Pessoa Jurídica e só migrar quando ela estiver aprovada**. A conta atual (Pessoa Física) continua recebendo até lá. Motivo: trocar o tipo da conta atual no Asaas **exclui as chaves Pix**, exige reenviar todos os documentos e cadastrar novas contas bancárias, e deixaria os Pix do Mapa parados até a aprovação.

## 1. Dados para o cadastro (do cartão CNPJ emitido em 12/10/2026)
| Campo | Valor |
|---|---|
| Tipo da conta | Pessoa Jurídica · Empresa Limitada |
| CNPJ | 08.896.800/0001-44 (matriz) |
| Nome da empresa | EMEGETECH SOLUCOES EM TECNOLOGIA LTDA |
| Nome fantasia | EMEGETECH SOLUTIONS |
| Abertura | 30/05/2007 · porte ME · situação ATIVA |
| Natureza jurídica | 206-2 Sociedade Empresária Limitada |
| Regime tributário | Simples Nacional |
| Faturamento mensal | cerca de R$ 20.000,00 |
| Atividade principal | 95.11-8-00 Reparação e manutenção de computadores e periféricos; secundárias incluem 62.01-5-01 (programas sob encomenda), 62.04-0-00 (consultoria em TI), 62.09-1-00 (suporte técnico em TI) e 63.11-9-00 (tratamento de dados, aplicações e hospedagem) |
| Endereço | R João Polak, 150 · Pilarzinho · Curitiba/PR · CEP 82.115-020 |
| E-mail | suporte@folego.online |
| Celular | (41) 98412-9797 |
| Site | https://folego.online |
| O que faz | Ofereço serviços · Desenvolvimento e Suporte tecnológico · "Desenvolvimento de sistemas de gestão e operação da plataforma Fôlego e Prumo (organização financeira pessoal), vendida como software por assinatura e diagnóstico digital." |

O cartão CNPJ lista como e-mail da contabilidade `societario@argcontabilidade.com.br`; o e-mail de cadastro no Asaas é o `suporte@folego.online`, como pedido.

## 2. O que só o dono pode fazer (o sistema não cria contas nem digita senhas)
1. Criar a conta em asaas.com com os dados acima e definir a senha.
2. Enviar os documentos que o Asaas pedir para PJ (em geral cartão CNPJ, contrato social e documento com foto do responsável) e cadastrar a **conta bancária da empresa** (titularidade do CNPJ).
3. Cadastrar o computador como **dispositivo confiável** (sem isso o limite fica em R$ 200 por transação e não dá para criar chave Pix).
4. Esperar a aprovação ("Aprovação geral: Aprovado" em Minha conta).

## 3. Depois de aprovada: preparar a conta nova (ainda sem trocar nada no sistema)
1. Criar a **chave Pix** da conta (aleatória) e anotar.
2. Em Minha conta > Integrações: gerar a **chave de API de produção** (começa com `$aact_`). Não envie por chat nem e-mail.
3. Cadastrar o **site** `https://folego.online` (é o que permite o retorno automático da tela de pagamento ao Prumo).
4. Criar o **webhook**: URL `https://folego.online/webhooks/pix`, com um token novo de 32+ caracteres; eventos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`.
5. Conferir que a conta aceita **cartão de crédito** recorrente (assinatura) e Pix.

## 4. Virada (um momento só, com backup antes)
Antes: rodar **backup_agora** e conferir quantas assinaturas no cartão estão ativas (`prontidao`). **Cartão guardado no Asaas não migra para outra conta**: quem assina hoje precisará assinar de novo na conta nova. Se houver assinantes reais, avise-os e deixe a conta antiga viva até o fim do último mês pago.

1. Atualizar os **Secrets do GitHub** (nunca no Git): `ASAAS_API_KEY`, `ASAAS_PIX_KEY`, `ASAAS_WEBHOOK_TOKEN` e, se mudou, `ASAAS_BASE_URL`.
2. Publicar o texto do recebedor (seção 5) e rodar **Publicar em produção**.
3. Rodar **prontidao** e conferir as chaves.
4. Testar de ponta a ponta com valores baixos: gerar um Pix do Mapa e pagar; assinar o plano Controle no cartão; trocar de plano (pró-rata) e cancelar.
5. Só então desligar a conta antiga (cancelar as assinaturas lá e retirar o webhook antigo).

## 5. Texto do recebedor (só publicar na virada, junto com a troca de chaves)
Hoje o Pix sai em nome de Matheus Zendonadi dos Santos. Se o texto do modal mudar antes da chave, o nome na tela não bate com o do banco e parece golpe. Na virada, em `apps/web/assets/js/checkout.js` (bloco `pix-trust`), trocar para:

> **Este Pix é em nome de Emegetech Soluções em Tecnologia LTDA.** Empresa especializada em sistemas de gestão. Antes de confirmar, confira o nome do recebedor no app do banco (ele pode aparecer abreviado).

A página do cartão (assinatura) é do próprio Asaas e passa a mostrar o nome da conta nova sozinha.

## 6. Pendências de texto e legal para a virada
- Termos e privacidade: o "responsável pelos dados" e o recebedor passam a ser a empresa.
- Nota fiscal: conferir com a contabilidade a emissão para vendas do Mapa e do Prumo.
