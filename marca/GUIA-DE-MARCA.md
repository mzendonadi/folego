# Guia de marca — Fôlego e Prumo

Versão 1.0 · 2026-10-03 · Fonte única da identidade. Os arquivos citados estão em `marca/svg` (vetores) e `marca/png` (imagens prontas). O que o site usa vive em `apps/web/assets`.

## 1. Ideia

**Fôlego** é o alívio de quem está apertado: respirar, enxergar a conta com calma e então decidir. **Prumo** é o app que acompanha depois: "estar no prumo" é estar em ordem, de pé, na direção certa. Dois nomes, uma família: mesma paleta, mesmo traço arredondado, mesma voz.

**Tom de voz:** 80% amiga esperta, 20% consultoria. Frases curtas, sem culpa, sem jargão, sem urgência artificial. Nunca prometemos resultado; mostramos conta.

## 2. As marcas

### Fôlego
Um **anel aberto** (a respiração) com um **ponto de ar âmbar** saindo pela abertura e um **centro menta** (a pessoa, em paz). Funciona em 16 px (favicon) e em 3 m (impresso).

| Arquivo | Uso |
|---|---|
| `svg/folego-marca.svg` | marca colorida, fundo claro |
| `svg/folego-marca-negativo.svg` | marca sobre quadrado verde (ícone de app, avatar) |
| `svg/folego-marca-mono.svg` | uma cor só (usa `currentColor`): carimbo, marca d'água, impressão P&B |
| `svg/folego-horizontal.svg`, `-negativo.svg` | marca + palavra "fôlego" |

A palavra "fôlego" é sempre em minúsculas, com o circunflexo, na fonte **Fraunces** peso 560. Nos SVG horizontais a palavra é texto (cai em Georgia sem a fonte); para materiais finais use os PNG já renderizados ou converta o texto em curvas no editor.

### Prumo
Um **monograma P** em traço arredondado, a mesma linguagem do anel do Fôlego: a haste do P é o fio de prumo e o peso (menta) fica pendurado na ponta por um fio fino; um ponto âmbar marca o ponto de fixação. É a marca que continua nítida em 16 px (favicon e ícone do app).

| Arquivo | Uso |
|---|---|
| `svg/prumo-marca.svg`, `prumo-marca-negativo.svg`, `prumo-horizontal.svg` | idem acima |

No site, a marca do Prumo aparece ao lado do título da área de assinatura.

## 3. Espaço e tamanho

- **Área de respiro:** meia altura da marca em todos os lados (a altura do "ô" no logotipo horizontal).
- **Tamanho mínimo:** marca sozinha 16 px (tela) / 6 mm (impresso); horizontal 80 px / 25 mm.
- Não girar, não esticar, não aplicar sombra ou contorno, não trocar as cores do ponto de ar, não escrever o nome em maiúsculas.

## 4. Cores

| Papel | Nome | Hex | Contraste (WCAG) |
|---|---|---|---|
| Principal | Verde Fôlego | `#0E5B49` | 7,26 sobre papel · 8,04 sobre branco |
| Fundo escuro | Verde profundo | `#0A3D31` | papel sobre ele: 10,99 |
| Apoio | Menta | `#8FE0BE` | 7,87 sobre verde profundo |
| Fundo | Papel | `#F6F3EC` | fundo padrão do site |
| Texto | Tinta | `#13231D` | 14,74 sobre papel |
| Texto secundário | Tinta 2 | `#3F514A` | 7,62 sobre papel |
| Destaque | Âmbar | `#A55F00` (claro `#F2B24A` no escuro) | 4,47 sobre papel; 6,52 do claro sobre o verde profundo |

**Âmbar:** só para o ponto de ar, o gancho do prumo, selos e títulos grandes (acima de 24 px ou 19 px em negrito). Para texto pequeno de aviso use a tinta âmbar do site (`--amber-ink #6E4100`).

## 5. Tipografia

- **Títulos e logotipo:** Fraunces (variável), pesos 500–600. Já está no site, hospedada no próprio domínio.
- **Texto e interface:** Figtree (variável), 400–700.
- Escala usada no site: 1,0 / 1,125 / 1,35 / 2 / 3 rem; entrelinha 1,5 no texto, 1,1 nos títulos.

## 6. Imagens prontas (`marca/png`)

| Arquivo | Onde usar |
|---|---|
| `avatar-folego-1024.png`, `avatar-prumo-1024.png` | foto de perfil (Instagram, X, LinkedIn, YouTube, TikTok, WhatsApp Business) |
| `capa-x-1500x500.png`, `capa-linkedin-1584x396.png`, `capa-facebook-1640x624.png` | capas de perfil |
| `post-dica-1080.png`, `post-numero-1080.png`, `story-1080x1920.png` | modelos de publicação (trocar o texto e exportar) |
| `og-image.png` (1200×630) | prévia ao compartilhar o link (já no site) |
| `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`, `favicon-32/48.png` | ícones do site e do app instalável (`site.webmanifest`) |

### Logo para vídeo e reels (`marca/reels`)
PNG com fundo transparente, símbolo + palavra "fôlego" em Fraunces: `folego-logo-horizontal-para-fundo-claro.png` (verde) e `-para-fundo-escuro.png` (creme), `folego-simbolo-para-fundo-claro/escuro.png` (2000×2000) e telas de reel 1080×1920 (`reel-1080x1920-fundo-papel.png` e `-fundo-verde.png`). Os SVG oficiais estão em `reels/svg-oficiais`. Para regerar: `node marca/_build/receber-reels.mjs` e abrir `http://localhost:3201/`.

**Como regerar:** `node marca/_build/receber.mjs`, abrir `http://localhost:3200/` no navegador e esperar "feito". Os PNG são redesenhados com as fontes da marca; edite `marca/_build/render.html` para mudar textos ou formatos.

## 7. Componentes no produto

- Botão principal: verde Fôlego com texto branco; arredondamento 999 px nos botões, 16–20 px nos cartões.
- Tons de estado: ok (verde), atenção (âmbar), apertado (laranja), crítico (vermelho). O âmbar da marca **não** é o tom de erro.
- Movimento: suave e curto (200–450 ms, `ease-out`), respeitando "reduzir movimento".

## 8. Fala e escrita

Sim: "Respira.", "Vamos olhar isso com calma.", "Você só paga se gostar."
Não: "Limpe seu nome já!", "Última chance", promessas de redução de dívida, linguagem de ameaça, jargão sem explicação.
Sempre: deixar claro que somos **ferramenta de organização**, não banco, financeira, escritório de advocacia nem consultoria de investimentos.
