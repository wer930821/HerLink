import { spacing } from "../theme";

export function getScreenTopPadding(insetTop: number, basePadding = spacing.lg) {
  return Math.max(basePadding, insetTop + spacing.sm);
}

export function getScreenBottomPadding(insetBottom: number, basePadding = spacing.xl) {
  return Math.max(basePadding, insetBottom + spacing.lg);
}

export function getTabBarMetrics(insetBottom: number) {
  const paddingTop = 8;
  const paddingBottom = Math.max(8, insetBottom);
  return {
    height: 60 + paddingBottom,
    paddingTop,
    paddingBottom,
  };
}
