import { useEffect } from "react";

/**
 * Revela elementos com a classe `.reveal` quando entram na viewport.
 * Aplica `.is-visible` com stagger baseado no atributo data-reveal-delay.
 * Também observa o DOM: cards que chegam depois (dados da API) entram na conta.
 */
export function useReveal() {
  useEffect(() => {
    const tracked = new WeakSet<Element>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const delay = Number(el.dataset.revealDelay ?? 0);
          window.setTimeout(() => el.classList.add("is-visible"), delay);
          observer.unobserve(el);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    const scan = () => {
      for (const node of document.querySelectorAll<HTMLElement>(".reveal")) {
        if (tracked.has(node) || node.classList.contains("is-visible")) continue;
        tracked.add(node);
        observer.observe(node);
      }
    };

    scan();
    const mutations = new MutationObserver(() => scan());
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);
}
