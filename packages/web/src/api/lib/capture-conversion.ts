/**
 * Regra do cadastro de imóvel aberto POR UMA CAPTAÇÃO
 * (`/admin/imoveis/novo?capture_id=<id>`).
 *
 * Módulo puro para que as três decisões que importam sejam testáveis sem banco:
 *  1. a captação pode virar imóvel? (mesmas negativas do Radar)
 *  2. o imóvel HERDA o serial-base da ficha ou precisa reservar um novo?
 *  3. o imóvel nasce fora do ar?
 *
 * A resposta 3 é sempre a mesma — `published: 0`. Está aqui, e não só no
 * front, porque o backend não confia no formulário: publicar é ato separado,
 * depois de foto oficial e revisão.
 */
import { checkConversionStart } from "./capture-rules";

export interface ConversionCapture {
  id: number;
  stage: string;
  docStatus: string | null | undefined;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
  serial: string | null | undefined;
  /** Código universal EPI já emitido na ficha, quando existe. */
  epiCode?: string | null;
  propertyType?: string | null;
}

export type ConversionPlan =
  | {
      ok: false;
      code: "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST";
      message: string;
    }
  | {
      ok: true;
      /** serial-base a herdar; `null` = reservar novo sequencial global */
      serial: string | null;
      /** `true` quando o serial precisa ser gravado de volta na captação */
      writeBackSerial: boolean;
      /**
       * EPI a HERDAR da ficha; `null` = a ficha é legada (sem EPI) e o imóvel
       * reserva um código novo, que volta para a captação.
       *
       * Captação promovida a imóvel NUNCA gera um segundo código: ou herda o
       * da ficha, ou o código emitido agora passa a ser o das duas.
       */
      epiCode: string | null;
      /** `true` quando o EPI precisa ser gravado de volta na captação */
      writeBackEpi: boolean;
      /** valor gravado em `properties.published` — sempre 0 nesta rota */
      published: 0;
      captureId: number;
      propertyType: string | null;
    };

export function planPropertyFromCapture(capture: ConversionCapture): ConversionPlan {
  const allowed = checkConversionStart({
    stage: capture.stage,
    docStatus: capture.docStatus,
    estimatedPrice: capture.estimatedPrice,
    convertedPropertyId: capture.convertedPropertyId,
  });
  if (!allowed.ok) return { ok: false, code: allowed.code, message: allowed.message };

  /* Serial já emitido na ficha (o mesmo impresso na FC/AV) é HERDADO. Só quando
     a captação é antiga e nunca teve serial é que um novo é reservado — e nesse
     caso ele volta para a captação, para ficha e imóvel mostrarem o MESMO
     número. Nada é renumerado. */
  const inherited = String(capture.serial ?? "").trim();
  /* Mesma lógica para o EPI, que é o código OFICIAL: ficha com EPI passa o
     código ao imóvel; ficha legada sem EPI recebe de volta o que for emitido
     na criação do imóvel. Em nenhum dos dois casos existem dois códigos. */
  const inheritedEpi = String(capture.epiCode ?? "").trim();
  return {
    ok: true,
    serial: inherited || null,
    writeBackSerial: inherited.length === 0,
    epiCode: inheritedEpi || null,
    writeBackEpi: inheritedEpi.length === 0,
    published: 0,
    captureId: capture.id,
    propertyType: capture.propertyType ?? null,
  };
}
