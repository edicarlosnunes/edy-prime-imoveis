import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/** Layout sóbrio compartilhado pelas páginas legais (privacidade e termos). */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-[820px] px-6 pt-36 pb-24 lg:px-8 lg:pt-44 lg:pb-32">
      <Link
        href="/"
        className="label-xs flex items-center gap-2 text-brass transition-colors hover:text-deep"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.6} />
        Voltar ao site
      </Link>

      <h1
        data-t="heading"
        className="display mt-8 text-[calc(clamp(2.2rem,5vw,3.4rem)*var(--h-scale,1))] text-deep"
      >
        {title}
      </h1>
      <p data-t="subheading" className="mt-4 text-base leading-relaxed text-muted">
        {intro}
      </p>
      <div className="mt-14 space-y-12">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 data-t="subheading" className="display text-2xl text-deep">
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return (
    <p data-t="body" className="text-[15px] leading-[1.85] text-muted">
      {children}
    </p>
  );
}
