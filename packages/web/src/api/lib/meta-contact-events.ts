/**
 * Entrada de mensagens nativas da Meta (Messenger e Instagram Direct).
 * Não contém lógica de WhatsApp nem presume acesso ao telefone do visitante.
 * O identificador da conta Meta é preservado para o CRM evitar contatos soltos.
 */
export interface MetaContactEvent {
  platform: "facebook" | "instagram";
  senderId: string;
  text: string;
  messageId: string | null;
  referral: string | null;
  adId: string | null;
}

export function parseMetaContactEvents(payload: unknown): MetaContactEvent[] {
  const body = (payload ?? {}) as {
    object?: string;
    entry?: Array<{
      messaging?: Array<{
        sender?: { id?: string };
        message?: { mid?: string; text?: string; is_echo?: boolean; referral?: { ref?: string; ad_id?: string } };
        postback?: { title?: string; payload?: string; mid?: string; referral?: { ref?: string; ad_id?: string } };
        referral?: { ref?: string; ad_id?: string };
      }>;
    }>;
  };
  if (body.object !== "page" && body.object !== "instagram") return [];
  const platform = body.object === "instagram" ? "instagram" : "facebook";
  const events: MetaContactEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const item of entry.messaging ?? []) {
      if (!item.sender?.id || item.message?.is_echo) continue;
      const text = String(item.message?.text ?? item.postback?.title ?? "").trim();
      const referral = item.message?.referral ?? item.postback?.referral ?? item.referral;
      // Um referral sem texto NÃO é lead, mas é necessário preservar o imóvel
      // associado para identificar a mensagem que chegar em seguida.
      if (!text && !referral?.ref) continue;
      events.push({
        platform,
        senderId: item.sender.id,
        text,
        messageId: item.message?.mid ?? item.postback?.mid ?? null,
        referral: referral?.ref?.slice(0, 160) ?? null,
        adId: referral?.ad_id?.slice(0, 100) ?? null,
      });
    }
  }
  return events;
}

function normalized(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function classifyMetaContact(text: string): string {
  const value = normalized(text);
  if (/\b(nao quero|sem interesse|nao tenho interesse|desisti|nao estou interessado|nao estou interessada)\b/.test(value)) {
    return "Sem interesse atual";
  }
  if (/\b(repasse|repassar|repassei|transferir financiamento|transferencia de financiamento)\b/.test(value)) {
    return "Repasse de imóvel";
  }
  if (/\b(tenho|possuo|meu|minha|proprietari[oa]|colocar|anunciar)\b.{0,80}\b(alugar|alugo|locar|locacao|aluguel)\b|\b(alugo|vou alugar|quero alugar)\b.{0,60}\b(meu|minha|propriedade)\b/.test(value)) {
    return "Proprietário — oferecer para locação";
  }
  if (/\b(tenho|possuo|meu|minha|proprietari[oa]|colocar|anunciar)\b.{0,80}\b(vender|vendo|venda|venderia)\b|\b(quero vender|vou vender|vendo meu|vendo minha|vender meu|vender minha)\b/.test(value)) {
    return "Proprietário — vender";
  }
  if (/\b(alugar|alugarei|alugaria|aluguel|alugueis|locacao|locar|inquilino|arrendar)\b/.test(value)) {
    return "Procura locação";
  }
  if (/\b(comprar|compro|comprarei|compraria|compra|adquirir|financiar|visitar|visita|valor|preco|quanto custa|disponivel|detalhes|informacoes|interesse)\b/.test(value)) {
    return "Interesse em compra";
  }
  return "Contato — intenção a esclarecer";
}

/** Extrai apenas códigos explicitamente identificados, sem adivinhar matrícula/telefone. */
export function metaPropertyReference(text: string, referral: string | null): string | null {
  const combined = normalized([referral ?? "", text].join(" "));
  const match = combined.match(/(?:\bimovel\s*[:=#-]\s*|\bcodigo(?:\s+do\s+imovel)?\s*[:#-]?\s*|\bref(?:erencia)?\s*[:#-]\s*)([A-Za-z0-9][A-Za-z0-9_-]{1,23})/i);
  return match?.[1]?.toUpperCase() ?? null;
}
