import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { client } from "../lib/api";
import { configureSite } from "../lib/site";

const queryClient = new QueryClient();

interface ProviderProps {
  children: React.ReactNode;
}

/**
 * Aplica os dados da imobiliária salvos no painel (/admin → Configurações)
 * sobre os valores padrão antes de renderizar o site.
 */
function SiteConfigBridge({ children }: ProviderProps) {
  const [, bump] = useState(0);

  useEffect(() => {
    let active = true;
    client.siteConfig
      .get()
      .then((config) => {
        if (!active || !config) return;
        configureSite(config);
        bump((value) => value + 1);
      })
      .catch(() => {
        /* mantém os valores padrão do site */
      });
    return () => {
      active = false;
    };
  }, []);

  return <>{children}</>;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
export function Provider({ children }: ProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SiteConfigBridge>{children}</SiteConfigBridge>
    </QueryClientProvider>
  );
}
