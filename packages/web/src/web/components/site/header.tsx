import { useEffect, useState } from "react";
import { Menu, X, Phone } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";

const links = [
  { href: "#imoveis", label: "Imóveis" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#sobre", label: "Sobre" },
  { href: "#duvidas", label: "Dúvidas" },
  { href: "#contato", label: "Contato" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Destaca no menu a seção que está na tela
  useEffect(() => {
    const sections = links
      .map((link) => document.querySelector<HTMLElement>(link.href))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "border-b border-white/10 bg-deep/95 py-3 backdrop-blur-md"
          : "bg-gradient-to-b from-black/55 via-black/25 to-transparent py-5"
      }`}
    >
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 lg:px-8">
        <a href="#top" className="flex shrink-0 items-baseline gap-2 text-white">
          <span className="display text-2xl tracking-tight">{site.brand}</span>
          <span className="label-xs text-brass-soft">{site.brandSuffix}</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => {
            const isActive = active === link.href;
            return (
              <a
                key={link.href}
                href={link.href}
                className={`relative py-1 text-[13px] tracking-[0.08em] uppercase transition-colors after:absolute after:-bottom-0.5 after:left-0 after:h-px after:bg-brass-soft after:transition-all after:duration-300 hover:text-white ${
                  isActive
                    ? "text-white after:w-full"
                    : "text-white/85 after:w-0 hover:after:w-full"
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <a
            href={whatsappLink(
              `Olá, ${site.broker}. Vi seu site e quero informações sobre imóveis em ${site.city}.`,
            )}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 bg-brass px-6 py-3 text-[12px] tracking-[0.14em] text-white uppercase transition-colors hover:bg-brass-soft sm:flex"
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={1.6} />
            WhatsApp
          </a>
          <button
            type="button"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 border border-white/25 px-3 py-2.5 text-white transition-colors hover:border-white/60 md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="text-[12px] tracking-[0.14em] uppercase">Menu</span>
          </button>
        </div>
      </div>

      {open && (
        <nav className="mt-3 border-t border-white/10 bg-deep px-6 pt-2 pb-5 md:hidden">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block border-b border-white/8 py-4 text-[14px] tracking-[0.1em] text-white/85 uppercase"
            >
              {link.label}
            </a>
          ))}
          <a
            href={whatsappLink(
              `Olá, ${site.broker}. Quero informações sobre imóveis em ${site.city}.`,
            )}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block bg-brass px-6 py-4 text-center text-[12px] tracking-[0.14em] text-white uppercase"
          >
            Falar no WhatsApp
          </a>
        </nav>
      )}
    </header>
  );
}
