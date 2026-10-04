import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  MessageCircle,
  ClipboardList,
  ShieldCheck,
  Smartphone,
  Pizza,
} from "lucide-react";
export default function Home() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Image src="/logo.png" alt="Pedizza" width={88} height={80} priority />
        <span className="muted">Feito para pizzarias.</span>
        <Link className="btn secondary" href="/login">
          Entrar <ArrowRight size={16} />
        </Link>
      </header>
      <section className="hero">
        <div>
          <span className="eyebrow">
            <span className="dot" /> MAIS TEMPO PARA FAZER BOA PIZZA
          </span>
          <h1>
            Sua pizzaria.
            <br />
            Tudo no <em>ponto.</em>
          </h1>
          <p>
            Do primeiro “oi” no WhatsApp até a última entrega. Um lugar para
            cuidar dos seus pedidos, clientes e da sua operação.
          </p>
          <div className="hero-actions">
            <Link className="btn" href="/cadastro">
              Começar com o Pedizza <ArrowRight size={18} />
            </Link>
            <span className="muted">R$ 47 por mês</span>
          </div>
          <div className="hero-note">
            <ShieldCheck size={17} /> Cada loja com seu próprio espaço.
          </div>
        </div>
        <div className="hero-art">
          <div className="orbit" />
          <Image
            src="/logo.png"
            alt="Mascote oficial Pedizza"
            width={360}
            height={329}
            priority
          />
          <div className="floating-card">
            <span className="icon-box">
              <Pizza size={22} />
            </span>
            <div>
              <strong>Da cozinha à entrega</strong>
              <small>Uma operação bem organizada.</small>
            </div>
          </div>
        </div>
      </section>
      <section className="feature-grid">
        {[
          [
            ClipboardList,
            "Pedidos organizados",
            "Acompanhe cada etapa, do aceite à entrega.",
          ],
          [
            MessageCircle,
            "Atendimento próximo",
            "WhatsApp e equipe no mesmo lugar.",
          ],
          [
            Smartphone,
            "Sempre com você",
            "No computador, no tablet e no celular.",
          ],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Pizza;
          return (
            <article className="feature" key={String(title)}>
              <I size={23} />
              <h2>{String(title)}</h2>
              <p>{String(body)}</p>
            </article>
          );
        })}
      </section>
      <footer className="landing-footer">
        <span>Pedizza · Gestão que acompanha seu ritmo.</span>
        <div>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Privacidade</Link>
        </div>
      </footer>
    </main>
  );
}
