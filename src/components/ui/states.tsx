import { Inbox, LoaderCircle } from "lucide-react";
export function EmptyState({
  title = "Nada por aqui ainda",
  description = "Os registros aparecerão aqui quando você começar a usar este módulo.",
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="icon-box">
        <Inbox size={23} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="stack" role="status" aria-label="Carregando">
      <div className="row muted">
        <LoaderCircle size={18} className="animate-spin" />
        Carregando sua loja…
      </div>
      <div className="stats">
        {[1, 2, 3, 4].map((n) => (
          <div className="skeleton" key={n} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 300 }} />
    </div>
  );
}
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
