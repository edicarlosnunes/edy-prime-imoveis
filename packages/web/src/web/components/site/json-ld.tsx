import { useEffect } from "react";

/**
 * Injeta um bloco JSON-LD (schema.org) no <head> enquanto o componente estiver
 * montado. Serve para o Google entender o imóvel e o corretor.
 */
export function JsonLd({ id, data }: { id: string; data: Record<string, unknown> | null }) {
  useEffect(() => {
    if (!data) return;
    const elementId = `jsonld-${id}`;
    let script = document.head.querySelector<HTMLScriptElement>(`script#${elementId}`);
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = elementId;
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
    return () => {
      script?.remove();
    };
  }, [id, data]);

  return null;
}
