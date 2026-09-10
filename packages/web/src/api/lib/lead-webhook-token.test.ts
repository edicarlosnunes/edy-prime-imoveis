/**
 * Correção de segurança 10/09/2026 — webhook de leads.
 *
 * O endpoint POST /api/webhooks/leads/:token aceitava os literais "zap",
 * "olx" e "imovelweb". Estes testes existem para que eles nunca voltem a
 * autenticar, nem por regressão nem por configuração legada.
 */
import { describe, expect, test } from "bun:test";
import {
  LEAD_WEBHOOK_SLOTS,
  MIN_TOKEN_LENGTH,
  REVOKED_TOKENS,
  createRateLimiter,
  ensureWebhookTokens,
  isRevokedToken,
  isStrongToken,
  randomWebhookToken,
  resolveWebhookPortal,
  safeEqual,
  tokenHint,
} from "./lead-webhook-token";

/** Config realista: um token forte por origem. */
function configComTokensFortes() {
  const { config } = ensureWebhookTokens({});
  return config;
}

describe("tokens fixos previsíveis foram revogados", () => {
  test('"zap" é rejeitado', () => {
    expect(resolveWebhookPortal(configComTokensFortes(), "zap")).toBeNull();
  });

  test('"olx" é rejeitado', () => {
    expect(resolveWebhookPortal(configComTokensFortes(), "olx")).toBeNull();
  });

  test('"imovelweb" é rejeitado', () => {
    expect(resolveWebhookPortal(configComTokensFortes(), "imovelweb")).toBeNull();
  });

  test("são rejeitados mesmo em maiúsculas ou com espaços", () => {
    const config = configComTokensFortes();
    for (const variação of [" ZAP ", "Olx", "IMOVELWEB", "imovelweb "]) {
      expect(resolveWebhookPortal(config, variação)).toBeNull();
    }
  });

  test("continuam rejeitados mesmo se alguém gravar o literal no config", () => {
    // config legada envenenada: o valor fraco NÃO pode autenticar
    const config = { token: "zap", tokenOlx: "olx", tokenImovelweb: "imovelweb" };
    expect(resolveWebhookPortal(config, "zap")).toBeNull();
    expect(resolveWebhookPortal(config, "olx")).toBeNull();
    expect(resolveWebhookPortal(config, "imovelweb")).toBeNull();
  });

  test("a lista de revogados cobre exatamente os três literais", () => {
    expect([...REVOKED_TOKENS].sort()).toEqual(["imovelweb", "olx", "zap"]);
    for (const fixo of REVOKED_TOKENS) {
      expect(isRevokedToken(fixo)).toBe(true);
      expect(isStrongToken(fixo)).toBe(false);
    }
  });
});

describe("token inexistente ou fraco", () => {
  test("token vazio é rejeitado", () => {
    expect(resolveWebhookPortal(configComTokensFortes(), "")).toBeNull();
    expect(resolveWebhookPortal(configComTokensFortes(), null)).toBeNull();
    expect(resolveWebhookPortal(configComTokensFortes(), undefined)).toBeNull();
  });

  test("token aleatório que não está no config é rejeitado", () => {
    expect(resolveWebhookPortal(configComTokensFortes(), randomWebhookToken())).toBeNull();
  });

  test("token curto é rejeitado antes de qualquer comparação", () => {
    const curto = "a".repeat(MIN_TOKEN_LENGTH - 1);
    expect(resolveWebhookPortal({ token: curto }, curto)).toBeNull();
  });

  test("config vazia não autentica nada", () => {
    expect(resolveWebhookPortal({}, randomWebhookToken())).toBeNull();
  });

  test("token quase certo (1 caractere trocado) é rejeitado", () => {
    const config = configComTokensFortes();
    const valido = config.token!;
    const quase = `${valido.slice(0, -1)}${valido.endsWith("a") ? "b" : "a"}`;
    expect(resolveWebhookPortal(config, quase)).toBeNull();
  });
});

describe("token seguro válido é aceito e identifica a origem", () => {
  test("cada slot autentica e devolve o portal certo", () => {
    const config = configComTokensFortes();
    for (const slot of LEAD_WEBHOOK_SLOTS) {
      expect(resolveWebhookPortal(config, config[slot.configKey]!)).toBe(slot.portal);
    }
  });

  test("o token do ZAP não autentica como OLX", () => {
    const config = configComTokensFortes();
    expect(resolveWebhookPortal(config, config.tokenZap!)).toBe("zap");
    expect(resolveWebhookPortal(config, config.tokenZap!)).not.toBe("olx");
  });

  test("cada origem recebe um token diferente", () => {
    const config = configComTokensFortes();
    const valores = LEAD_WEBHOOK_SLOTS.map((slot) => config[slot.configKey]);
    expect(new Set(valores).size).toBe(LEAD_WEBHOOK_SLOTS.length);
  });
});

describe("geração de token", () => {
  test("tem 48 caracteres hex e passa no critério de força", () => {
    for (let i = 0; i < 50; i += 1) {
      const token = randomWebhookToken();
      expect(token).toMatch(/^[0-9a-f]{48}$/);
      expect(isStrongToken(token)).toBe(true);
    }
  });

  test("não repete em 500 gerações", () => {
    const vistos = new Set(Array.from({ length: 500 }, () => randomWebhookToken()));
    expect(vistos.size).toBe(500);
  });

  test("ensureWebhookTokens preserva token forte já existente (compatibilidade)", () => {
    const existente = randomWebhookToken();
    const { config, rotated } = ensureWebhookTokens({ token: existente });
    expect(config.token).toBe(existente);
    expect(rotated).not.toContain("token");
    expect(rotated).toEqual(["tokenZap", "tokenOlx", "tokenImovelweb"]);
  });

  test("ensureWebhookTokens substitui token legado revogado (migração)", () => {
    const { config, rotated } = ensureWebhookTokens({ token: "zap" });
    expect(config.token).not.toBe("zap");
    expect(isStrongToken(config.token!)).toBe(true);
    expect(rotated).toContain("token");
  });

  test("ensureWebhookTokens é idempotente", () => {
    const primeira = ensureWebhookTokens({});
    const segunda = ensureWebhookTokens(primeira.config);
    expect(segunda.rotated).toEqual([]);
    expect(segunda.config).toEqual(primeira.config);
  });

  test("não descarta outros campos do config", () => {
    const { config } = ensureWebhookTokens({ dedupeHours: "48" });
    expect(config.dedupeHours).toBe("48");
  });
});

describe("nenhum token completo vaza", () => {
  test("tokenHint mostra só os 4 últimos caracteres", () => {
    const token = randomWebhookToken();
    const hint = tokenHint(token);
    expect(hint).toBe(`••••${token.slice(-4)}`);
    expect(hint).not.toContain(token);
    expect(hint.length).toBe(8);
  });

  test("tokenHint não expõe token curto", () => {
    expect(tokenHint("abc")).toBe("••••");
  });

  test("a mensagem de erro do endpoint não contém o token", () => {
    // é literalmente a string montada em webhook-routes.ts
    const ip = "203.0.113.7";
    const mensagem = `Token inválido (${ip})`;
    expect(mensagem).not.toContain("zap");
    expect(mensagem).not.toContain(randomWebhookToken());
    expect(mensagem).toBe("Token inválido (203.0.113.7)");
  });

  test("os slots rotacionados são registrados por NOME, nunca por valor", () => {
    const { config, rotated } = ensureWebhookTokens({});
    const log = `tokens gerados: ${rotated.join(", ")}`;
    for (const slot of LEAD_WEBHOOK_SLOTS) {
      expect(log).toContain(slot.configKey);
      expect(log).not.toContain(config[slot.configKey]!);
    }
  });
});

describe("comparação em tempo constante", () => {
  test("safeEqual concorda com === para strings de mesmo tamanho", () => {
    expect(safeEqual("abcdef", "abcdef")).toBe(true);
    expect(safeEqual("abcdef", "abcdeg")).toBe(false);
    expect(safeEqual("abcdef", "zbcdef")).toBe(false);
  });

  test("tamanhos diferentes nunca são iguais", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });

  test("strings vazias são iguais", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("rate limit preservado", () => {
  test("deixa passar até o limite e bloqueia a partir dele", () => {
    const limitar = createRateLimiter(60, 60_000);
    const base = 1_000_000;
    for (let i = 0; i < 60; i += 1) {
      expect(limitar("1.2.3.4", base)).toBe(false);
    }
    expect(limitar("1.2.3.4", base)).toBe(true);
  });

  test("a janela reabre depois de expirar", () => {
    const limitar = createRateLimiter(2, 60_000);
    const base = 1_000_000;
    expect(limitar("1.2.3.4", base)).toBe(false);
    expect(limitar("1.2.3.4", base)).toBe(false);
    expect(limitar("1.2.3.4", base)).toBe(true);
    expect(limitar("1.2.3.4", base + 60_001)).toBe(false);
  });

  test("um IP bloqueado não afeta outro IP", () => {
    const limitar = createRateLimiter(1, 60_000);
    const base = 1_000_000;
    expect(limitar("1.1.1.1", base)).toBe(false);
    expect(limitar("1.1.1.1", base)).toBe(true);
    expect(limitar("2.2.2.2", base)).toBe(false);
  });

  test("força bruta de token não escapa do limite", () => {
    const limitar = createRateLimiter(60, 60_000);
    const config = configComTokensFortes();
    const base = 1_000_000;
    let bloqueios = 0;
    for (let i = 0; i < 200; i += 1) {
      if (limitar("9.9.9.9", base)) bloqueios += 1;
      else expect(resolveWebhookPortal(config, randomWebhookToken())).toBeNull();
    }
    expect(bloqueios).toBe(140);
  });
});
