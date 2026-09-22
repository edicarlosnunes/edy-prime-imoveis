# CRM de Captação — ajuste estrutural (etapa atual)

Escopo: SOMENTE CRM de captação. Sem tocar no Agente IA, WhatsApp Cloud API,
webhook, tokens, layout do site público nem serial. Alterações ADITIVAS.

## Decisões fechadas com o usuário
- Área prioritária: Praia Grande, Mongaguá, Itanhaém, Peruíbe, São Vicente,
  Santos, Guarujá, Cubatão, Bertioga. Fora dela: cadastra normal + faixa vermelha.
- 12 meses sem venda: AUTOMÁTICO — sai da vitrine sozinho e gera ação de revisão.
- Status de cadastro e status comercial são EIXOS NOVOS, paralelos ao funil
  atual do Radar (novo_contato → documentacao → validacao → captado). Funil intacto.
- Entrega: preview local primeiro; deploy só com autorização.

## Reuso (já existe — não recriar)
- Telefone = identidade do proprietário: `lib/owner-identity.ts`
- Unidade = CEP + número + complementos: `lib/capture-address.ts#unitKey`
- Vários imóveis por dono + aviso de duplicidade: `lib/capture-intake.ts`
- Radar de captação: `property_captures` + `routes/admin-captures.ts`
- Revalidação 4 meses: `web/lib/property-revalidation.ts` + `property_revalidations`
- Histórico: `audit_log` (entity=capture) + `property_revalidations` + notes

## A implementar
- [ ] lib/street-normalize.ts — Rua/R./Av./Travessa, acentos, abreviações, similaridade
- [ ] lib/capture-address.ts — `addrKey` (identidade sem CEP) SEM mexer em unitKey
- [ ] lib/capture-registration.ts — status do cadastro + completude + retomada
- [ ] lib/priority-area.ts — cidades prioritárias + flag FORA_DA_AREA_PRIORITARIA
- [ ] lib/commercial-status.ts — status comercial + visibilidade na vitrine
- [ ] web/lib/property-revalidation.ts — regra dos 12 meses (pausa automática)
- [ ] schema.ts — colunas aditivas + tabela `streets`
- [ ] scripts/migrate.ts — idempotente, só ADD COLUMN / CREATE IF NOT EXISTS
- [ ] wiring: capture-intake, owner-intake, admin-captures, properties (vitrine)
- [ ] routes/admin-streets.ts — resolver/sugerir logradouro
- [ ] UI: faixa vermelha + badges + retomada (captacao.tsx, property-form.tsx)
- [ ] testes bun test (cenários da lista do usuário)
- [ ] tsc --noEmit + bun test + preview local

## Invariantes
- Nunca criar 2º contato para o mesmo telefone
- Nunca criar 2º imóvel se o anterior do mesmo dono está incompleto
- Mesmo prédio + unidade diferente = imóvel novo permitido
- Outro telefone no mesmo imóvel = POSSIVEL_DUPLICIDADE, nunca exclusão
- Fora da área prioritária = alerta, nunca bloqueio
- 12 meses = pausa + histórico preservado, nunca exclusão

## Fase — Agente IA de captação (conversa)
- [x] `api/agent/owner-capture.ts` — roteiro, estado lido da ficha, tools `salvarCadastroImovel`/`pedirAtendimentoHumano`
- [x] `api/agent/broker.ts` — prompt + tools de captação só quando há telefone do canal
- [x] `api/lib/inbox.ts` — passa `conversation.contactPhone` ao agente (telefone nunca perguntado)
- [x] correção: tipo/valor/nome sem endereço no envio não passam mais pela entrada única
      (chaves degeneradas abriam uma 2ª ficha do mesmo imóvel) — gravam direto na ficha
- [x] `owner-capture.e2e.test.ts` — 3 cenários (cadastro novo, abandono+retomada, humano): 7/7
- [x] tsc --noEmit limpo + 800 testes do pacote passando + preview 4200 de pé
- [ ] gaps a confirmar com o dono: agente único condicional por telefone, qualificação
      no bloco `[captacao-ia]` das observações, `source` caindo em `manual`
