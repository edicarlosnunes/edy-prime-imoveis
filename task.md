# Edy Premi Imóveis — Editor do Site (CMS) no /admin

Projeto: /home/user/edy-premi-imoveis (packages/web). Produção: https://www.edyprimeimoveis.com.br

## Fase 1 — Banco e API (CONCLUÍDO)
- [x] Tabela `site_content` (draft/published/archived, coluna `data` JSON) + índice em schema.ts
- [x] Colunas `media.name` e `media.alt`
- [x] `scripts/migrate.ts` atualizado e APLICADO no banco real (leads preservados)
- [x] `src/web/lib/site-content.ts` — contrato/tipos + `defaultSiteContent` (site atual) + `mergeSiteContent`
- [x] `src/api/routes/site-content.ts` — `siteContent.get` (público)
- [x] `src/api/routes/admin-site.ts` — state / saveDraft / publish / history / restore / discardDraft
- [x] `src/api/routes/admin-media.ts` — list / update / remove (bloqueia exclusão em uso)
- [x] `src/api/index.ts` — router + `name` no upload
- [x] `src/web/lib/site.ts` — `configureSite` ampliado

## Fase 2 — Frontend público editável
- [x] `queries/site.ts` (usePublishedContent, useDraftContent)
- [x] `queries/admin-site.ts` (state/draft/publish/history/restore/media)
- [x] `components/site/content.tsx` (contexto, SiteContentProvider, SiteChrome, PreviewBanner)
- [x] `components/provider.tsx` → SiteContentProvider
- [x] `styles.css` → `.site-btn`, `--btn-radius`, `--btn-transform`
- [x] header.tsx
- [x] hero.tsx, proof.tsx (diferenciais), showcase.tsx (imóveis), cta-final.tsx (novo), process.tsx,
      about.tsx, faq.tsx, final-cta.tsx (contato), footer.tsx
- [x] `pages/index.tsx` → `.site-shell` + `orderedSections()` + SiteChrome

## Fase 3 — Editor no painel
- [x] `pages/admin/site-editor.tsx` + `components/admin/editor/*`
      abas: Identidade, Capa, Menu, Seções, Empresa, Rodapé, SEO, Mídia, Histórico
      barra fixa: Salvar rascunho / Pré-visualizar / Publicar / data da última alteração
- [x] rota `/admin/editor` em app.tsx (dentro do AdminGuard) + item no menu do layout

## Fase 4 — Validação e entrega
- [x] `bunx tsc --noEmit` + `bun run build` (exit 0)
- [x] Testes Playwright 1440px e 390px — 22 checagens, todas verdes (scripts/test-editor.py)
- [x] `bun run build:api`
- [ ] commit e push em `main`, validar produção

## Notas
- Tema aplicado por `<style>` escopado em `.site-shell` (NÃO afetar /admin, mesmos tokens).
- `configureSite` roda no `useMemo` do provider (síncrono), nunca em useEffect.
- `bun run lint` falha por erro pré-existente em packages/mobile/app/_layout.tsx — ignorar.
- Não alterar DATABASE_URL / DATABASE_AUTH_TOKEN nem criar env nova.

## Resultado dos testes (21/08/2026)
Executado em http://localhost:4200 com usuário admin temporário (removido depois):
site padrão · login · editor abre · cores · textos da capa · item do menu oculto ·
ordem/visibilidade de seções · contatos · rodapé · SEO · biblioteca de imagens ·
salvar rascunho · rascunho NÃO vaza para o site público · pré-visualização mostra o rascunho ·
publicar · site público reflete o publicado (cor, título, WhatsApp, seção oculta) ·
painel /admin com tema e CRM intactos · upload de imagem · imagem trocada no site ·
exclusão de imagem em uso bloqueada (409) · histórico restaura no rascunho sem mexer no ar ·
mobile 390px (home + menu).

Banco após os testes: `site_content` com 1 versão publicada ("Conteúdo inicial do site",
idêntica ao design atual) + 1 rascunho. Mídia e usuário de teste removidos.
