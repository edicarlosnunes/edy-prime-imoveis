import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiteContentProvider } from "./site/content";

const queryClient = new QueryClient();

interface ProviderProps {
  children: React.ReactNode;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
// SiteContentProvider carrega o conteúdo publicado no Editor do Site (/admin/editor)
// e aplica os dados da imobiliária antes do primeiro render.
export function Provider({ children }: ProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SiteContentProvider>{children}</SiteContentProvider>
    </QueryClientProvider>
  );
}
