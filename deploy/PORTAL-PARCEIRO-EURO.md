# Portal "Euro Multiplan & Fôlego": guia de operação

Endereço: `https://folego.online/parceiros` (sem link público no site; o endereço e a senha vão do Fôlego para a Euro).

## Primeiro acesso (dono do Fôlego)

1. Backoffice > Parcerias > **Euro Multiplan** > Editar > **Gerar nova senha do portal**. A senha aparece uma vez só. Login: `julhanaeuroemprestimos@hotmail.com`.
2. Parcerias > campanha **Consignado: Euro Multiplan & Fôlego** > Editar: defina **Valor por contato (R$)** e **Comissão do Fôlego (% por contrato)**. Os dois começam em zero. O % vale para os contatos enviados depois de definido e fica congelado em cada contato na hora do envio.
3. Para enviar contatos: Parcerias > Envios (já existente). Como a campanha não tem webhook, o contato aparece direto na tela da Euro.
4. Comissão: Parcerias > card da Euro > **Contratos e comissão** > **Dar baixa** quando a Euro pagar.

## Regras

- **Contatos do Fôlego** (pessoas que autorizaram) e **Minha base** (planilhas da Euro) são tabelas separadas e nunca se misturam.
- Comissão só vale para contrato fechado com contato do Fôlego. Contrato da base própria não gera comissão.
- Se o titular revogar a autorização, o nome some do contrato e do histórico; o valor continua nos totais.
- A planilha é lida no navegador. Só os dados já organizados vão para o servidor, em lotes de 200.
- CPF é a chave: o mesmo CPF nunca vira dois contatos. Reimportar o mesmo arquivo não muda nada. Arquivo novo só acrescenta contatos e soma telefone, e-mail ou margem que faltava; etapa e anotações ficam como estavam.
- Dados pessoais da base ficam criptografados no banco (AES-256-GCM); o CPF também é guardado como HMAC para achar repetidos.

## Mapa das colunas da planilha da Euro (sem cabeçalho, A a BO)

O significado é o mais provável pelos dados. As marcadas "a confirmar" ficam guardadas, mas sem uso na tela.

| Coluna | Campo | Observação |
|---|---|---|
| A | CPF | Excel perde o zero à esquerda; completamos para 11 dígitos e validamos |
| B | Nome | |
| C | Data de nascimento | número de data do Excel |
| D | Idade | |
| E | Sexo | F ou M |
| F | Nome da mãe | |
| G | Tipo de conta | |
| H, I | Agência e conta | de recebimento |
| J | Banco pagador | |
| K | Data de ingresso | provável (a confirmar) |
| M | Matrícula | única por pessoa |
| O | UF do órgão | filtro "Estados" |
| P | Código do órgão | |
| Q, R, S, T, U | a confirmar | guardadas em "dados extras" |
| AA | Base de cálculo da margem | |
| AB a AD | Margem de cartão 5%: total, usada, livre | AD é a margem livre do cartão |
| AH a AJ | Margem consignável 35%: total, usada, livre | |
| AK a AM | Teto de 70%: total, comprometido, livre | |
| AU | Situação funcional | ATIVO PERMANENTE, APOSENTADO, PENSÃO etc. (filtro) |
| AV | **Margem livre efetiva** | a menor entre AJ e AM; usada na tela e nos filtros |
| AX a BD | Endereço | logradouro, número, complemento, bairro, cidade, UF, CEP |
| BE a BI | Telefones (celulares) 1 a 5 | |
| BJ a BL | Telefones fixos 1 a 3 | |
| BM a BO | E-mails 1 a 3 | |

Planilhas com cabeçalho também funcionam: basta ter "CPF" e "Nome", e opcionalmente Nascimento, Sexo, Mãe, Matrícula, UF do órgão, Situação funcional, Margem livre, Telefone/Celular, E-mail, Endereço, Número, Bairro, Cidade, UF, CEP.

## Privacidade

A planilha original não entra no repositório nem no servidor como arquivo. Tem CPF, nome da mãe e conta bancária de terceiros: a Euro é a controladora desses dados e o Fôlego só os guarda, criptografados, para uso dela. Cabe à Euro a base legal para tratá-los.
