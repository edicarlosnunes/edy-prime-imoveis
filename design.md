# Edy Premi Imóveis — Design

Landing page (web) de captação de leads para corretor/imobiliária de imóveis de médio e alto padrão em Praia Grande/SP. Visual sofisticado, litorâneo e sóbrio: bege osso, verde-petróleo profundo e latão. Objetivo único: gerar contato qualificado (formulário + WhatsApp).

Estrutura: hero com foto + formulário curto → prova social → vitrine enxuta (6 imóveis) → como funciona (3 passos) → sobre o corretor → depoimentos → FAQ → CTA final. Header fixo com CTA e botão flutuante de WhatsApp.

## Brand & Colors

CSS variables em `packages/web/src/web/styles.css`.

| Token | Hex | Uso |
|-------|-----|-----|
| bone | #DCD8CD | Fundo alternado das seções |
| paper | #F4F1EA | Fundo base da página |
| deep | #17231F | Verde-petróleo escuro: header, footer, blocos escuros |
| ink | #12140F | Texto principal |
| muted | #6B6A62 | Texto secundário |
| brass | #A9834B | Acento: linhas, labels, hovers, preços |
| brass-soft | #C9A46A | Acento sobre fundo escuro |
| line | rgba(18,20,15,.12) | Fios/hairlines |

Sem dark mode (site institucional de página única).

## Typography

- **Display:** Cormorant Garamond (serif, 300/400/500) — títulos, números de prova social, preços.
- **Body/UI:** Jost (300/400/500) — parágrafos, botões, micro-labels em CAIXA ALTA com `tracking-[0.22em]`.
- Hierarquia: h1 `clamp(2.6rem,6vw,4.6rem)` serif; h2 `clamp(2rem,4vw,3.2rem)`; corpo 16–18px, `leading-relaxed`.

## Layout

- Container `max-w-[1240px]`, respiro vertical `py-24 md:py-32`.
- Grid assimétrico no hero (7/5) e no bloco Sobre (5/7), imagens sangrando para a borda.
- Cantos praticamente retos (`rounded-none`/`rounded-[2px]`) — sem cara de template.
- Botões: retângulo cheio deep/brass, uppercase, tracking largo.

## Motion

Reveal por scroll (IntersectionObserver + CSS transitions, stagger de 60ms). Hover em cards: zoom suave 1.04 na imagem + subida de 2px. Sem animações decorativas.

## Pages

- **Home** (`packages/web/src/web/pages/index.tsx`) — landing única com todas as seções; componentes em `src/web/components/site/`.

## API & Dados

- `leads.create` (oRPC) — grava nome, WhatsApp, interesse, mensagem na tabela `leads` (Turso/Drizzle).
- `properties.list` (oRPC) — 6 imóveis em destaque (dados editáveis em `src/api/routes/properties.ts`).

## Flows

1. Visitante chega → hero → preenche formulário curto → lead salvo → mensagem de confirmação + link direto do WhatsApp.
2. Visitante navega a vitrine → clica no card → CTA "Falar sobre este imóvel" abre WhatsApp com o código do imóvel preenchido.
