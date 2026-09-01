import type { ReactNode } from "react";

type PageHeroProps = {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function PageHero({ kicker, title, description, actions, children, compact = false, className }: PageHeroProps) {
  return (
    <section className={`hero${compact ? " hero-compact" : ""}${className ? ` ${className}` : ""}`}>
      {kicker ? <p className="muted small">{kicker}</p> : null}
      <h1 className="hero-title">{title}</h1>
      {description ? <p className="hero-copy">{description}</p> : null}
      {children}
      {actions ? <div className="row">{actions}</div> : null}
    </section>
  );
}
