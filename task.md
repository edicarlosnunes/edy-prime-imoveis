# Painel administrativo — Edy Premi Imóveis

## Objetivo
Painel completo em /admin (login seguro, dashboard, imóveis, CRM, clientes, proprietários, agenda, propostas, configurações),
usando o banco Turso existente. Vitrine pública passa a ler os imóveis do banco (migrando os 6 atuais).

## Regras
- Não quebrar o site público (design/menu/WhatsApp/formulário).
- Não apagar leads reais. Migrations aditivas e idempotentes.
- Sem novas variáveis de ambiente (evitar bloqueio externo na Vercel):
  - senha admin: hash PBKDF2 no banco
  - sessão: token aleatório, hash sha256 no banco, cookie httpOnly
  - fotos: upload guardado no próprio banco (tabela media) e servido em /api/media/:id
- API de produção = bundle `bun run build:api` (ESM .mjs) — rodar antes do commit.

## Passos
1. [x] schema.ts com todas as tabelas
2. [x] script de migração idempotente + aplicar no banco real
3. [x] seed: 6 imóveis atuais + usuário admin + settings
4. [x] auth (pbkdf2 + sessões + middleware adminBase) e rotas de login/logout
5. [x] rotas API: properties(publica), admin-properties, admin-leads, admin-clients, admin-owners,
       admin-tasks, admin-deals, admin-dashboard, admin-settings, media/upload
6. [x] UI /admin (layout + 9 telas) e integração da vitrine pública
7. [x] build + testes locais (desktop/mobile, login, CRUD, CRM, vitrine)
8. [x] build:api + commit + push main + testes em produção
