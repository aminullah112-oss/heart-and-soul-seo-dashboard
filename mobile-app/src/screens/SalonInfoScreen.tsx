import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import Card from "../components/Card";
import ScreenHeader from "../components/ScreenHeader";
import salonInfo from "../data/salonInfo.json";
import { colors, fonts, spacing } from "../theme/theme";

export default function SalonInfoScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <ScreenHeader eyebrow="Visit us" title={salonInfo.name} subtitle={salonInfo.address} />

      <View style={styles.section}>
        <Card>
          <Text style={styles.cardTitle}>Hours</Text>
          {salonInfo.hours.map((h) => (
            <View key={h.day} style={styles.hourRow}>
              <Text style={styles.hourDay}>{h.day}</Text>
              <Text style={styles.hourValue}>{h.closed ? "Closed" : `${h.open} – ${h.close}`}</Text>
            </View>
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <Button label="Call the studio" onPress={() => Linking.openURL(`tel:${salonInfo.phone}`)} />
        <Button
          label="Get directions"
          variant="secondary"
          onPress={() => Linking.openURL(salonInfo.mapsUrl)}
          style={{ marginTop: spacing.sm }}
        />
        <Button
          label="Follow on Instagram"
          variant="secondary"
          onPress={() => Linking.openURL(salonInfo.instagramUrl)}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, marginBottom: spacing.sm },
  hourRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hourDay: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  hourValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink60 },
});
