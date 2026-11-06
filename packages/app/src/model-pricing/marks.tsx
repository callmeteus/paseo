import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { formatPriceMarks, type PriceTier } from "@/model-pricing/tier";

export function PriceMarks({ minTier, maxTier }: { minTier: PriceTier; maxTier: PriceTier }) {
  const { t } = useTranslation();
  return (
    <Text numberOfLines={1} style={styles.marks}>
      {formatPriceMarks({ min: minTier, max: maxTier }, t("modelSelector.priceFree"))}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  marks: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
