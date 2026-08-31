import React, { useMemo } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import Card from "../components/Card";
import ScreenHeader from "../components/ScreenHeader";
import { useBookings } from "../context/BookingsContext";
import { formatTime12h } from "../data/timeSlots";
import { colors, fonts, spacing } from "../theme/theme";
import type { Booking } from "../types";

function formatFullDate(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function MyBookingsScreen() {
  const { bookings, cancelBooking, loading } = useBookings();

  const upcoming = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return bookings
      .filter((b) => b.status === "upcoming" && b.dateISO >= todayISO)
      .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  }, [bookings]);

  const past = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return bookings
      .filter((b) => b.status === "cancelled" || b.dateISO < todayISO)
      .sort((a, b) => (b.dateISO + b.time).localeCompare(a.dateISO + a.time));
  }, [bookings]);

  const handleCancel = (booking: Booking) => {
    Alert.alert("Cancel appointment?", `${booking.serviceName} on ${formatFullDate(booking.dateISO)}`, [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel booking", style: "destructive", onPress: () => cancelBooking(booking.id) },
    ]);
  };

  if (!loading && bookings.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader eyebrow="Your appointments" title="My Bookings" />
        <Text style={styles.emptyText}>No bookings yet — book a service from the Services tab.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={[...upcoming, ...past]}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={<ScreenHeader eyebrow="Your appointments" title="My Bookings" />}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.serviceName}>{item.serviceName}</Text>
              <Text style={[styles.status, item.status === "cancelled" && styles.statusCancelled]}>
                {item.status === "cancelled" ? "Cancelled" : item.dateISO < new Date().toISOString().slice(0, 10) ? "Past" : "Upcoming"}
              </Text>
            </View>
            <Text style={styles.meta}>
              {formatFullDate(item.dateISO)} · {formatTime12h(item.time)}
            </Text>
            <Text style={styles.meta}>with {item.stylistName}</Text>
            {item.status === "upcoming" && item.dateISO >= new Date().toISOString().slice(0, 10) && (
              <Button
                label="Cancel"
                variant="danger"
                onPress={() => handleCancel(item)}
                style={{ marginTop: spacing.sm, alignSelf: "flex-start", paddingHorizontal: spacing.md, minHeight: 36 }}
              />
            )}
          </Card>
        )}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink60,
    paddingHorizontal: spacing.lg,
  },
  card: { marginTop: spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  serviceName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.sageDim,
  },
  statusCancelled: { color: colors.rose },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink60, marginTop: 4 },
});
