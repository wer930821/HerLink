import { createElement, type FormHTMLAttributes, type ReactNode } from "react";

export type SurfaceElevation = 1 | 2 | "inset";
export type SurfaceTone = "default" | "accent" | "success" | "warning" | "danger";
export type SurfaceElement = "section" | "div" | "form";

type SurfaceProps = {
  as?: SurfaceElement;
  elevation?: SurfaceElevation;
  tone?: SurfaceTone;
  className?: string;
  children: ReactNode;
} & FormHTMLAttributes<HTMLFormElement>;

export function Surface({
  as = "section",
  elevation = 1,
  tone = "default",
  className,
  children,
  ...rest
}: SurfaceProps) {
  const classes = ["surface", `surface-elevation-${elevation}`];
  if (tone !== "default") {
    classes.push(`surface-tone-${tone}`);
  }
  if (className) {
    classes.push(className);
  }
  return createElement(as as string, { className: classes.join(" "), ...rest }, children);
}
