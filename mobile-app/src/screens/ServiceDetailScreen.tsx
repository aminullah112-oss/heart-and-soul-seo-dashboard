import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import Card from "../components/Card";
import services from "../data/services.json";
import { colors, fonts, spacing } from "../theme/theme";
import type { RootStackParamList, Service } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "ServiceDetail">;

export default function ServiceDetailScreen() {
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const service = (services as Service[]).find((s) => s.id === route.params.serviceId);

  if (!service) {
    return (
      <View style={styles.screen}>
        <Text style={styles.notFound}>This service is no longer available.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.category}>{service.category}</Text>
      <Text style={styles.name}>{service.name}</Text>
      <Card style={{ marginTop: spacing.md }}>
        <Text style={styles.description}>{service.description}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaValue}>{service.durationMinutes} min</Text>
          <Text style={styles.metaValue}>${service.price}</Text>
        </View>
      </Card>
      <Button
        label="Choose stylist & time"
        onPress={() => navigation.navigate("Booking", { serviceId: service.id })}
        style={{ marginTop: spacing.xl }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  notFound: { padding: spacing.lg, fontFamily: fonts.body, color: colors.ink60 },
  category: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.5,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.sageDim,
  },
  name: { fontFamily: fonts.headingBold, fontSize: 26, color: colors.ink, marginTop: spacing.xs },
  description: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, lineHeight: 22 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metaValue: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
});
