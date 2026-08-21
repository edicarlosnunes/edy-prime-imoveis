# Tipografia no Editor do Site — progresso

## Feito
- [x] `src/web/lib/site-typography.ts` — tipos, 13 tipos de texto, 11 escopos, limites, resolver de cascata, gerador de CSS, fontes usadas.
- [x] `src/web/lib/site-content.ts` — campos `typography` + `typographyScopes` (defaults vazios = site igual ao atual).
- [x] `src/web/components/site/content.tsx` — `siteCss()` (tema + tipografia), `googleFontsHref(content)` com ital+pesos.
- [x] `data-sec` / `data-t` em: hero, header, showcase, about, faq, process, proof, final-cta, cta-final, footer, lead-form, pages/imovel.tsx.

## Fazendo
- [ ] `components/admin/editor/typography-controls.tsx` (controles + Restaurar padrão + badge Global/Personalizado)
- [ ] `components/admin/editor/tab-typography.tsx` (aba Textos: global + sub-abas por seção + preview ao vivo)
- [ ] nova aba em `pages/admin/site-editor.tsx`

## Depois
- [ ] tsc --noEmit + build
- [ ] QA banco temporário /tmp/qa6.db + Playwright python (sem full_page), antes/depois pixel-idêntico com defaults
- [ ] testar salvar/publicar (sanitize MAX_KEYS/MAX_DEPTH em src/api/routes/admin-site.ts)
- [ ] bun run build:api, commit, push main, validar produção, deliver
