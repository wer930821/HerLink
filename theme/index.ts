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
    shadowColor: "#2F221E",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
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
