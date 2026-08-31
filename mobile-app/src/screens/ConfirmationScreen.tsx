import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import Card from "../components/Card";
import { useBookings } from "../context/BookingsContext";
import { formatTime12h } from "../data/timeSlots";
import { colors, fonts, spacing } from "../theme/theme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Confirmation">;

function formatFullDate(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function ConfirmationScreen() {
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === route.params.bookingId);

  if (!booking) {
    return (
      <View style={styles.screen}>
        <Text style={styles.notFound}>We couldn't find that booking.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✓</Text>
      </View>
      <Text style={styles.title}>You're booked!</Text>
      <Text style={styles.subtitle}>We've saved your appointment on this device.</Text>

      <Card style={{ marginTop: spacing.lg }}>
        <Row label="Service" value={booking.serviceName} />
        <Row label="Stylist" value={booking.stylistName} />
        <Row label="Date" value={formatFullDate(booking.dateISO)} />
        <Row label="Time" value={formatTime12h(booking.time)} />
        <Row label="Price" value={`$${booking.price}`} last />
      </Card>

      <Button
        label="Back to home"
        onPress={() => navigation.navigate("MainTabs")}
        style={{ marginTop: spacing.xl }}
      />
      <Button
        label="View my bookings"
        variant="secondary"
        onPress={() => navigation.navigate("MainTabs", { screen: "MyBookings" })}
        style={{ marginTop: spacing.sm }}
      />
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  notFound: { padding: spacing.lg, fontFamily: fonts.body, color: colors.ink60 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.sageDim,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: spacing.lg,
  },
  badgeText: { color: colors.white, fontSize: 26, fontFamily: fonts.bodySemiBold },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 26,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink60,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.ink60 },
  rowValue: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
});
