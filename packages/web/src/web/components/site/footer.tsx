import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import { site, whatsappLink } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

export function Footer() {
  const { footer, menu, theme } = useSiteContent();
  const logoUrl = (menu.logoUrl || theme.logoUrl).trim();

  return (
    <footer data-sec="footer" className="bg-[#0a0a0a] text-[#c8c5bd]">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${menu.logoText || site.brand} ${menu.logoSuffix || site.brandSuffix}`}
                style={{ height: `${theme.logoHeight || 34}px` }}
                className="w-auto object-contain"
              />
            ) : (
              <p className="flex items-baseline gap-2 text-[#f5f5f0]">
                <span className="display text-2xl">{menu.logoText || site.brand}</span>
                <span className="label-xs text-[#c9a46a]">
                  {menu.logoSuffix || site.brandSuffix}
                </span>
              </p>
            )}
            <p data-t="body" className="mt-5 max-w-sm text-sm leading-relaxed">
              <Lines text={footer.about} /> {site.creci}.
            </p>
          </div>

          {footer.links.length > 0 && (
            <div>
              <p data-t="caption" className="label-xs flex items-center gap-3 text-[#f5f5f0]">
                <span aria-hidden="true" className="h-px w-6 bg-[#a9834b]" />
                {footer.navLabel}
              </p>
              <ul data-t="footer" className="mt-5 space-y-3 text-sm">
                {footer.links.map((link) => (
                  <li key={link.id}>
                    <a href={link.href} className="transition-colors hover:text-[#c9a46a]">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p data-t="caption" className="label-xs flex items-center gap-3 text-[#f5f5f0]">
              <span aria-hidden="true" className="h-px w-6 bg-[#a9834b]" />
              {footer.contactLabel}
            </p>
            <ul data-t="footer" className="mt-5 space-y-3 text-sm">
              <li>
                <a
                  href={whatsappLink(`Olá, ${site.broker}. Vim pelo site.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 transition-colors hover:text-[#c9a46a]"
                >
                  <MessageCircle className="h-4 w-4 text-[#a9834b]" strokeWidth={1.5} />
                  {site.whatsappLabel}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="flex items-center gap-2 transition-colors hover:text-[#c9a46a]"
                >
                  <Mail className="h-4 w-4 text-[#a9834b]" strokeWidth={1.5} />
                  E-mail
                </a>
              </li>
              {footer.showSocial && site.instagram && (
                <li>
                  <a
                    href={site.instagram}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 transition-colors hover:text-[#c9a46a]"
                  >
                    <Instagram className="h-4 w-4 text-[#a9834b]" strokeWidth={1.5} />
                    Instagram
                  </a>
                </li>
              )}
              {footer.showSocial && site.facebook && (
                <li>
                  <a
                    href={site.facebook}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 transition-colors hover:text-[#c9a46a]"
                  >
                    <Facebook className="h-4 w-4 text-[#a9834b]" strokeWidth={1.5} />
                    Facebook
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div data-t="caption" className="mt-14 flex flex-col gap-3 border-t border-white/12 pt-8 text-xs md:flex-row md:items-center md:justify-between">
          <ul data-t="footer" className="order-2 flex flex-wrap items-center gap-x-6 gap-y-2 md:order-3">
            <li>
              <Link href="/privacidade" className="transition-colors hover:text-[#c9a46a]">
                Política de Privacidade
              </Link>
            </li>
            <li>
              <Link href="/termos" className="transition-colors hover:text-[#c9a46a]">
                Termos de Uso
              </Link>
            </li>
          </ul>
          <p className="order-1">
            © {new Date().getFullYear()} {menu.logoText || site.brand}{" "}
            {menu.logoSuffix || site.brandSuffix}. {site.creci}. {footer.copyright}
          </p>
          {footer.note.trim() && <p className="order-4">{footer.note}</p>}
        </div>
      </div>
    </footer>
  );
}
