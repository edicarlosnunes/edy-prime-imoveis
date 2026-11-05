import type { ConfigMap } from "./integrations";
import type { TestResult } from "./integration-tests";

/** Only validates read access. Never creates campaigns or changes spend. */
export async function testLinkedInAds(config: ConfigMap, request: typeof fetch = fetch): Promise<TestResult> {
  const accountId = config.accountId?.trim() ?? "";
  const token = config.accessToken?.trim() ?? "";
  if (!accountId || !token) return { ok: false, status: "aguardando_credencial", message: "Informe o ID da conta e o token autorizado pelo LinkedIn na configuração." };
  if (!/^\d+$/.test(accountId)) return { ok: false, status: "erro", message: "O ID da conta de anúncios deve conter apenas números." };
  const version = config.apiVersion?.trim() || "202609";
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(version)) return { ok: false, status: "erro", message: "Informe uma versão válida da API no formato AAAAMM." };
  try {
    const response = await request(`https://api.linkedin.com/rest/adAccounts/${accountId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null) as { id?: number | string; status?: string; servingStatuses?: string[] } | null;
    if (!response.ok) {
      const message = response.status === 401 ? "Token expirado ou inválido. Autorize novamente no LinkedIn." : response.status === 403 ? "LinkedIn recusou o acesso. Confira aprovação da Advertising API, permissão r_ads e função na conta." : `LinkedIn respondeu HTTP ${response.status}. Confira a versão da API e a conta.`;
      return { ok: false, status: "erro", message };
    }
    if (String(body?.id ?? "") !== accountId) return { ok: false, status: "erro", message: "O LinkedIn não confirmou o ID da conta solicitada." };
    const holds = body?.servingStatuses?.filter((item) => item !== "RUNNABLE") ?? [];
    if (body?.status !== "ACTIVE" || holds.length) return { ok: false, status: "configurando", message: "A conta respondeu, mas não está liberada para veiculação. Confira cobrança, limites e situação no Campaign Manager." };
    return { ok: true, status: "configurando", message: "Acesso de leitura à conta confirmado. O envio automático e a permissão de escrita ainda precisam ser concluídos. Nenhum anúncio foi criado ou impulsionado." };
  } catch {
    return { ok: false, status: "erro", message: "Não foi possível consultar o LinkedIn. Tente novamente; nenhum anúncio foi enviado." };
  }
}
