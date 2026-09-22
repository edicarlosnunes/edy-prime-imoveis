/**
 * Consulta de CEP (ViaCEP) com fallback manual obrigatório.
 *
 * Módulo puro de propósito: o `fetch` entra por parâmetro. Assim o caminho de
 * sucesso e TODOS os caminhos de falha (rede fora, timeout, CEP inexistente,
 * JSON quebrado, HTTP 500) são testáveis sem tocar a rede.
 *
 * Regra de ouro: a consulta NUNCA bloqueia o cadastro. Qualquer falha devolve
 * `ok: false` com motivo legível e a ficha segue em preenchimento manual — um
 * CEP novo, um condomínio sem logradouro cadastrado ou a ViaCEP fora do ar não
 * podem impedir a captação de um imóvel real.
 *
 * Nenhuma dependência nova: usa o `fetch` global.
 */
import { isValidCep, normalizeCep } from "./capture-address";

export interface CepAddress {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

export type CepLookupResult =
  | { ok: true; source: "viacep"; address: CepAddress }
  | { ok: false; reason: string; manual: true };

/** Endpoint público da ViaCEP. Somente leitura, sem chave de API. */
export const cepEndpoint = (cep: string) => `https://viacep.com.br/ws/${normalizeCep(cep)}/json/`;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Falha sempre cai no preenchimento manual — nunca em erro de tela. */
const manual = (reason: string): CepLookupResult => ({ ok: false, reason, manual: true });

/**
 * Traduz a resposta da ViaCEP.
 *
 * A ViaCEP responde HTTP 200 com `{"erro": true}` para CEP inexistente, então
 * o status sozinho não serve de critério.
 */
export function parseViaCep(payload: unknown, cep: string): CepLookupResult {
  if (!payload || typeof payload !== "object") return manual("Resposta inválida da consulta de CEP");
  const data = payload as Record<string, unknown>;

  // `erro` chega como boolean true ou como a string "true", conforme o caso.
  if (data.erro === true || data.erro === "true") return manual("CEP não encontrado");

  const city = text(data.localidade);
  const state = text(data.uf);
  // Sem cidade/UF não há o que preencher: melhor manual que meio preenchido.
  if (!city || !state) return manual("CEP sem cidade/UF na base consultada");

  return {
    ok: true,
    source: "viacep",
    address: {
      cep: normalizeCep(text(data.cep) || cep),
      /* Logradouro e bairro vêm vazios em CEP único de cidade e em alguns
         condomínios. Não é erro: o usuário completa na mão. */
      street: text(data.logradouro),
      district: text(data.bairro),
      city,
      state: state.toUpperCase(),
    },
  };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Consulta um CEP. Devolve o endereço ou o motivo do fallback manual.
 *
 * Nunca lança: quem chama trata só `ok`.
 */
export async function lookupCep(
  rawCep: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<CepLookupResult> {
  const cep = normalizeCep(rawCep);
  if (!isValidCep(cep)) return manual("CEP deve ter 8 dígitos");
  if (typeof fetchImpl !== "function") return manual("Consulta de CEP indisponível");

  try {
    const response = await fetchImpl(cepEndpoint(cep));
    if (!response.ok) return manual(`Consulta de CEP indisponível (HTTP ${response.status})`);
    const payload = await response.json();
    return parseViaCep(payload, cep);
  } catch {
    return manual("Não foi possível consultar o CEP agora");
  }
}
