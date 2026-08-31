import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Button from "../components/Button";
import ScreenHeader from "../components/ScreenHeader";
import { useBookings } from "../context/BookingsContext";
import services from "../data/services.json";
import stylists from "../data/stylists.json";
import { formatTime12h, getSlotsForDate, isSalonOpenOnDate, nextNDates } from "../data/timeSlots";
import { colors, fonts, radius, spacing } from "../theme/theme";
import type { RootStackParamList, Service, Stylist } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Booking">;

function formatDateLabel(dateISO: string): { weekday: string; day: string } {
  const date = new Date(`${dateISO}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    day: date.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

export default function BookingScreen() {
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { addBooking, isSlotTaken } = useBookings();

  const service = (services as Service[]).find((s) => s.id === route.params.serviceId);
  const dates = useMemo(() => nextNDates(21).filter(isSalonOpenOnDate), []);

  const [stylistId, setStylistId] = useState<string>((stylists as Stylist[])[0].id);
  const [dateISO, setDateISO] = useState<string>(dates[0]);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const slots = useMemo(
    () => (service ? getSlotsForDate(dateISO, service.durationMinutes) : []),
    [dateISO, service]
  );

  if (!service) {
    return (
      <View style={styles.screen}>
        <Text style={styles.notFound}>This service is no longer available.</Text>
      </View>
    );
  }

  const canSubmit = !!time && name.trim().length > 1 && phone.trim().length >= 7;

  const handleConfirm = async () => {
    if (!time) return;
    if (isSlotTaken(stylistId, dateISO, time)) {
      Alert.alert("That time was just taken", "Please pick another time slot.");
      return;
    }
    setSubmitting(true);
    try {
      const stylist = (stylists as Stylist[]).find((s) => s.id === stylistId)!;
      const booking = await addBooking({
        serviceId: service.id,
        serviceName: service.name,
        price: service.price,
        durationMinutes: service.durationMinutes,
        stylistId: stylist.id,
        stylistName: stylist.name,
        dateISO,
        time,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        notes: notes.trim() || undefined,
      });
      navigation.replace("Confirmation", { bookingId: booking.id });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <ScreenHeader eyebrow={service.category} title={service.name} subtitle={`${service.durationMinutes} min · $${service.price}`} />

      <Text style={styles.label}>Stylist</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {(stylists as Stylist[]).map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              setStylistId(s.id);
              setTime(null);
            }}
            style={[styles.chip, stylistId === s.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, stylistId === s.id && styles.chipTextActive]}>{s.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>Date</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {dates.map((d) => {
          const { weekday, day } = formatDateLabel(d);
          const active = d === dateISO;
          return (
            <Pressable
              key={d}
              onPress={() => {
                setDateISO(d);
                setTime(null);
              }}
              style={[styles.dateChip, active && styles.chipActive]}
            >
              <Text style={[styles.dateWeekday, active && styles.chipTextActive]}>{weekday}</Text>
              <Text style={[styles.dateDay, active && styles.chipTextActive]}>{day}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>Time</Text>
      {slots.length === 0 ? (
        <Text style={styles.emptyText}>No openings that day — try another date.</Text>
      ) : (
        <View style={styles.timeGrid}>
          {slots.map((slot) => {
            const taken = isSlotTaken(stylistId, dateISO, slot);
            const active = time === slot;
            return (
              <Pressable
                key={slot}
                disabled={taken}
                onPress={() => setTime(slot)}
                style={[styles.timeChip, active && styles.chipActive, taken && styles.timeChipDisabled]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive, taken && styles.timeChipTextDisabled]}>
                  {formatTime12h(slot)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={styles.label}>Your details</Text>
      <TextInput
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor={colors.ink60}
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Phone number"
        placeholderTextColor={colors.ink60}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={[styles.input, styles.notesInput]}
        placeholder="Notes for your stylist (optional)"
        placeholderTextColor={colors.ink60}
        multiline
        value={notes}
        onChangeText={setNotes}
      />

      <Button
        label={submitting ? "Booking…" : "Confirm booking"}
        onPress={handleConfirm}
        disabled={!canSubmit}
        loading={submitting}
        style={{ marginHorizontal: spacing.lg, marginTop: spacing.xl }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  notFound: { padding: spacing.lg, fontFamily: fonts.body, color: colors.ink60 },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.sageDim, borderColor: colors.sageDim },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  chipTextActive: { color: colors.white },
  dateChip: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    marginRight: spacing.sm,
  },
  dateWeekday: { fontFamily: fonts.body, fontSize: 11, color: colors.ink60, textTransform: "uppercase" },
  dateDay: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginTop: 2 },
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  timeChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  timeChipDisabled: { backgroundColor: colors.cream, borderStyle: "dashed" },
  timeChipTextDisabled: { color: colors.ink60, textDecorationLine: "line-through" },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink60, marginHorizontal: spacing.lg },
  input: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  notesInput: { minHeight: 80, textAlignVertical: "top" },
});
