import type { HTMLAttributes, ReactNode } from "react";

type EmptyStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export function EmptyState({ title, description, action, children, className, ...rest }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ""}`} {...rest}>
      {title ? <div className="title">{title}</div> : null}
      {description ? <p className="muted">{description}</p> : null}
      {action ? <div>{action}</div> : null}
      {children}
    </div>
  );
}
