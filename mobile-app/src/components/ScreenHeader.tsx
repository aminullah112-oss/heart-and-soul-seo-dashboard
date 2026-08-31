import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../theme/theme";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
};

export default function ScreenHeader({ eyebrow, title, subtitle }: Props) {
  return (
    <View style={styles.wrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.5,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.sageDim,
    marginBottom: spacing.xs,
  },
  title: { fontFamily: fonts.headingBold, fontSize: 26, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.ink60, marginTop: spacing.xs },
});
