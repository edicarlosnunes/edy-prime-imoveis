# Edy Prime Imóveis — Design

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
- `properties.list` (oRPC) — vitrine pública lendo a tabela `properties` do banco (`published = 1`,
  ordenado por destaque e data). Os imóveis são cadastrados no painel `/admin`, não mais no código.
- `siteConfig.get` (oRPC) — dados públicos da imobiliária (WhatsApp, e-mail, CRECI, endereço, redes)
  vindos de `/admin → Configurações`; `src/web/lib/site.ts` mantém os mesmos valores como padrão.

## Painel administrativo (`/admin`)

Área privada, mesma paleta do site em versão utilitária (sidebar `deep`, cards brancos sobre `paper`,
acento `brass`, cantos retos, labels em caixa alta).

- Autenticação: `POST /api/admin/login` (cookie `epi_admin`, httpOnly, 12h), senha com PBKDF2-SHA256
  no banco; todas as rotas de dados exigem sessão (`adminBase`). `AdminGuard` protege as telas.
- Telas: `/admin` (dashboard), `/admin/imoveis`, `/admin/leads`, `/admin/clientes`,
  `/admin/proprietarios`, `/admin/agenda`, `/admin/propostas`, `/admin/configuracoes`.
- Layout responsivo: sidebar fixa no desktop, menu hamburger no mobile (`components/admin/layout.tsx`).
- Fotos: upload em `POST /api/admin/upload` (redimensionado no navegador, máx 3 MB), guardado na
  tabela `media` e servido por `GET /api/media/:id` — sem storage externo.
- Funil do CRM: novo → primeiro contato → qualificado → imóvel apresentado → visita agendada →
  proposta enviada → negociação → venda fechada (kanban no desktop, lista no mobile).

## Flows

1. Visitante chega → hero → preenche formulário curto → lead salvo → mensagem de confirmação + link direto do WhatsApp.
2. Visitante navega a vitrine → clica no card → CTA "Falar sobre este imóvel" abre WhatsApp com o código do imóvel preenchido.

## Editor do Site (CMS) — /admin/editor

Todo o conteúdo do site é editável no painel e guardado no banco (`site_content`),
sem nada de texto/cor fixo no código de apresentação.

- **Contrato único:** `packages/web/src/web/lib/site-content.ts` define os tipos, o
  `defaultSiteContent` (o site como foi entregue) e o `mergeSiteContent` que funde o
  JSON do banco sobre os padrões. Se o banco estiver vazio ou a API falhar, o site
  renderiza exatamente o design padrão.
- **Versionamento:** uma linha por versão com `status = draft | published | archived`.
  Publicar arquiva a versão no ar e coloca o rascunho no lugar; o rascunho continua
  existindo. Histórico guarda até 20 versões; restaurar volta para o rascunho (não publica).
- **Tema:** `SiteChrome` injeta um `<style>` escopado em `.site-shell` sobrescrevendo os
  tokens do Tailwind (`--color-deep`, `--color-brass`, `--font-display`, `--h-scale`,
  `--btn-radius`…). O escopo é obrigatório: o painel `/admin` usa os mesmos tokens e não
  pode ser afetado. Cores e fontes passam por validação antes de entrar no CSS.
- **Botões do site:** classes `.site-btn` / `.site-btn-dark` (declaradas em `@layer base`
  para que as utilities do Tailwind continuem vencendo, ex. `hidden`).
- **Pré-visualização:** `/?preview=1` busca o rascunho por rota protegida e cai no
  publicado silenciosamente se não houver sessão.
- **Mídia:** upload em `POST /api/admin/upload` (máx 3 MB, resize client-side ~1600px),
  servida em `/api/media/:id`. A exclusão é bloqueada quando a imagem está em uso em um
  imóvel ou no conteúdo do site.
- **Ordem das seções:** `pages/index.tsx` renderiza via `orderedSections()`; a faixa
  "Não encontrou o que procurava?" virou a seção própria `cta-final.tsx`.
