import { colors } from "./colors";
import { spacing } from "./spacing";
import { typography } from "./typography";

export { colors, spacing, typography };

export const radii = {
  sm: 12,
  md: 16,
  lg: 22,
  pill: 999,
};

export const shadows = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
};

export const theme = {
  colors,
  spacing,
  typography,
  radii,
  shadows,
};

export type Theme = typeof theme;
