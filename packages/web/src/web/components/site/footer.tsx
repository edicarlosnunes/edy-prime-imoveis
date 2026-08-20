import { Instagram, Mail, MessageCircle } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";

export function Footer() {
  return (
    <footer className="bg-ink text-white/60">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="flex items-baseline gap-2 text-white">
              <span className="display text-2xl">{site.brand}</span>
              <span className="label-xs text-brass-soft">{site.brandSuffix}</span>
            </p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed">
              Assessoria em compra, venda e locação de imóveis de médio e alto padrão em {site.city}{" "}
              e região. {site.creci}.
            </p>
          </div>

          <div>
            <p className="label-xs text-white">Navegar</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>
                <a href="#imoveis" className="transition-colors hover:text-brass-soft">
                  Imóveis em destaque
                </a>
              </li>
              <li>
                <a href="#como-funciona" className="transition-colors hover:text-brass-soft">
                  Como funciona
                </a>
              </li>
              <li>
                <a href="#sobre" className="transition-colors hover:text-brass-soft">
                  Sobre
                </a>
              </li>
              <li>
                <a href="#duvidas" className="transition-colors hover:text-brass-soft">
                  Dúvidas frequentes
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="label-xs text-white">Contato</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>
                <a
                  href={whatsappLink(`Olá, ${site.broker}. Vim pelo site.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                >
                  <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
                  {site.whatsappLabel}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                >
                  <Mail className="h-4 w-4" strokeWidth={1.5} />
                  E-mail
                </a>
              </li>
              <li>
                <a
                  href={site.instagram}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 transition-colors hover:text-brass-soft"
                >
                  <Instagram className="h-4 w-4" strokeWidth={1.5} />
                  Instagram
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-8 text-xs md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {site.brand} {site.brandSuffix}. Todos os direitos
            reservados.
          </p>
          <p>
            Imagens ilustrativas. Valores e disponibilidade sujeitos a alteração sem aviso prévio.
          </p>
        </div>
      </div>
    </footer>
  );
}
