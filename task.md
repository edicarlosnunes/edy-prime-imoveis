# EPI — Código Universal + Arquivo Morto básico

Branch: `feature/codigo-universal-epi` (criada de `origin/main` 5f1a2fd, já pushada).
Regras: não publicar, não fazer merge. Checkpoints com commit + push.
Não alterar: site público, capa, layout, WhatsApp, IA, LINK_CAPTACAO, Radar, funis, regras comerciais.

## Decisões fechadas com o usuário
- Formato: `EPI-1000/09-26` — sequência universal global desde 1000, nunca reinicia; `MM-AA` = mês/ano
  da criação ORIGINAL da ficha, timezone America/Sao_Paulo. Código nunca muda, nunca é reutilizado.
- Serial legado (`AP-2026-000001`) e `code` continuam existindo, só interno/histórico. EPI é o código exibido.
- Sem backfill: as fichas/imóveis que já existem ficam sem EPI (legado). Sequência começa na 1ª ficha nova.
- Dedup: mesma unidade = retoma ficha e mantém EPI; mesmo proprietário/outro imóvel = novo EPI;
  mesmo prédio/unidade diferente = novo EPI; captação promovida a imóvel = mesmo EPI.
- Arquivo Morto = soft delete. Excluir nunca apaga. Preserva tudo + EPI. Restauração básica.
  Dedup consulta arquivados: mesmo imóvel arquivado = restaurar/reabrir, sem novo EPI.
- EPI aparece: lista admin, ficha, busca do CRM, Arquivo Morto, documentos do sistema.
  NÃO aparece no site público nem em portais. Somente leitura.

## Etapas
- [x] 1. Branch + push
- [x] 2. Schema: `crm_epi_sequence`, `properties.epi_code/archived_*`, `property_captures.epi_code/archived_*`
- [x] 3. Lib pura `epi-code.ts` + testes (formato, parse, período SP, imutabilidade)
- [x] 4. Lib `epi-counter.ts` + testes de concorrência (UPDATE ... RETURNING atômico)
- [x] 5. Lib pura `archive-rules.ts` + testes (arquivar/restaurar preservando EPI)
- [ ] 6. API: EPI na criação de captação (admin-captures.create, owner-intake) e de imóvel
      (admin-properties.create herda da captação)
- [ ] 7. API: arquivar/restaurar imóvel + captação; listagens operacionais excluem arquivados
- [ ] 8. API: busca do CRM por EPI; dedup consulta arquivados e reabre sem novo EPI
- [ ] 9. UI: lista de imóveis (coluna EPI, busca, Arquivo Morto, restaurar), ficha (EPI read-only),
      Radar (EPI), documentos (EPI)
- [ ] 10. `db:push` no banco + `bun test` + `bun run build`
- [ ] 11. Commit + push final (sem merge, sem publish)
