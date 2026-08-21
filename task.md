# Edy Premi Imóveis — Expansão do Administrativo (Integrações, Portais, IA, Automações, Marca d'água, SEO)

Projeto: /home/user/edy-premi-imoveis (packages/web). Produção: https://www.edyprimeimoveis.com.br
Base intocada: site público, CRM, imóveis, leads, clientes, proprietários, agenda, propostas,
configurações, Editor do Site (CMS), mídia, autenticação. Commit anterior: cefc4fd.

## Regras
- Nenhuma integração falsa. Status real: nao_configurado / aguardando_credencial / configurando / conectado / erro.
- Secrets só no servidor (tabela `integrations.config`), nunca no frontend (API devolve mascarado).
- Nunca destruir a foto original (marca d'água gera versão derivada).
- Não alterar DATABASE_URL / DATABASE_AUTH_TOKEN. Nenhuma env nova obrigatória.
- Rotas de API < 500 linhas cada (lint).

## Fase 1 — Banco
- [ ] tabelas: integrations, integration_events, property_channels, conversations, messages,
      ai_agents, automations, automation_runs, watermark_settings, audit_log
- [ ] colunas: leads(portal, channel, campaign, utm_*, external_id), properties(slug, watermark_off),
      property_images(original_url), media(original_id, variant)
- [ ] scripts/migrate.ts aditivo + aplicado no banco real (dados preservados)

## Fase 2 — API
- [ ] lib/audit.ts, lib/integrations.ts (catálogo + status + mascaramento)
- [ ] admin-integrations.ts (list/get/save/test/sync/events)
- [ ] admin-channels.ts (portais por imóvel + feed status)
- [ ] feed XML + sitemap + robots (rotas HTTP públicas)
- [ ] properties.detail/related público + slug
- [ ] lead intake (webhook HTTP assinado + dedupe) → CRM existente
- [ ] admin-inbox.ts (conversas, mensagens, assumir/devolver IA)
- [ ] admin-agents.ts (CRUD + teste em sandbox, tools sobre imóveis reais)
- [ ] admin-automations.ts (CRUD + execuções)
- [ ] admin-watermark.ts (config + aplicar)
- [ ] admin-audit.ts + admin-ai-dashboard.ts

## Fase 3 — Painel
- [ ] /admin/integracoes
- [ ] /admin/conversas
- [ ] /admin/ia (agentes + dashboard IA/automações)
- [ ] /admin/automacoes
- [ ] /admin/marca-dagua
- [ ] /admin/auditoria
- [ ] aba "Publicação e Portais" na edição do imóvel

## Fase 4 — Público
- [ ] /imovel/:slug (galeria, características, CTA WhatsApp, formulário, relacionados,
      SEO/OG/JSON-LD, lead vinculado ao imóvel)
- [ ] links da vitrine para a página individual

## Fase 5 — Entrega
- [ ] tsc --noEmit, build, testes 1440/390, limpeza dos dados de teste
- [ ] build:api, commit, push main, validar produção

## Métodos oficiais confirmados (pesquisa 21/08/2026)
- ZAP/VivaReal (Canal Pro): importação por XML em URL pública, lida a cada ~12 h. → feed próprio.
- OLX Imóveis: importação por XML documentada (developers.olx.com.br/anuncio/xml/real_estate). → feed próprio.
- Imovelweb/Wimoveis: XML na Central do Anunciante + integração de leads. → feed próprio.
- Mercado Livre Imóveis: sem API pública oficial de publicação de imóveis para o Brasil → categoria C.
- WhatsApp: só Cloud API oficial (Meta app + número aprovado + token + webhook + templates).
- Meta Lead Ads / Instagram: webhook + token de página (OAuth) — estrutura pronta, aguardando credencial.

## Progresso (sessão atual)
- [x] agent/gateway.ts + agent/broker.ts (tools sobre imóveis reais, handoff)
- [x] lib/base-url.ts, lib/inbox.ts, lib/whatsapp.ts, lib/lead-intake.ts
- [x] routes/admin-integrations.ts, admin-channels.ts, admin-agents.ts, admin-inbox.ts
- [x] admin-properties.ts: slug + originalUrl + watermarkOff
- [x] leads.ts público via intakeLead; properties.detail por slug
- [x] admin-automations.ts, admin-watermark.ts, admin-audit.ts (+ aiDashboard)
- [x] rotas HTTP públicas (feed/sitemap/robots/webhooks/prerender) + vercel.json
- [x] frontend: /admin/integracoes, portais, conversas, ia, automacoes, marca-dagua, auditoria + /imovel/:slug
- [x] testes funcionais reais (feed, webhook + dedupe, whatsapp verify/assinatura, agente IA, handoff, automacao, prerender, screenshots 1440/390 sem erro de console)
- [x] limpeza dos dados de QA no banco real + remocao do usuario temporario de QA
- [ ] build:api, commit, push, validacao em producao
