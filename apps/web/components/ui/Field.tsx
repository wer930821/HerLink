import { Children, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

type FieldProps = {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactElement;
};

export function Field({ label, htmlFor, hint, error, className, style, children }: FieldProps) {
  const child = Children.only(children);
  const childId = (isValidElement(child) ? (child.props as { id?: string }).id : undefined) ?? htmlFor;
  const hintId = hint && childId ? `${childId}-hint` : undefined;
  const errorId = error && childId ? `${childId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const control = cloneElement(child as ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>, {
    ...(childId ? { id: childId } : {}),
    ...(error ? { "aria-invalid": true } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  });

  return (
    <div className={`field${className ? ` ${className}` : ""}`} style={style}>
      <label className="label" htmlFor={childId}>
        {label}
      </label>
      {control}
      {hint && hintId ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error && errorId ? (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
