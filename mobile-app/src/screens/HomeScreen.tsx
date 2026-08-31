import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import Card from "../components/Card";
import salonInfo from "../data/salonInfo.json";
import services from "../data/services.json";
import { colors, fonts, spacing } from "../theme/theme";
import type { MainTabsParamList, RootStackParamList } from "../types";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabsParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const featured = services.slice(0, 3);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>{salonInfo.name}</Text>
        <Text style={styles.heroTitle}>{salonInfo.tagline}</Text>
        <Button
          label="Book an appointment"
          onPress={() => navigation.navigate("Services")}
          style={styles.heroButton}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Popular services</Text>
        {featured.map((service) => (
          <Card key={service.id} style={styles.serviceCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.serviceName}>{service.name}</Text>
              <Text style={styles.serviceMeta}>
                {service.durationMinutes} min · ${service.price}
              </Text>
            </View>
            <Button
              label="Book"
              variant="secondary"
              onPress={() => navigation.navigate("Booking", { serviceId: service.id })}
            />
          </Card>
        ))}
        <Button
          label="See all services"
          variant="secondary"
          onPress={() => navigation.navigate("Services")}
          style={{ marginTop: spacing.sm }}
        />
      </View>

      <View style={styles.section}>
        <Card>
          <Text style={styles.infoTitle}>Visit us</Text>
          <Text style={styles.infoLine}>{salonInfo.address}</Text>
          <Text style={styles.infoLine}>{salonInfo.phone}</Text>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  hero: {
    backgroundColor: colors.midnight,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroEyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.sageLight,
  },
  heroTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 30,
    color: colors.white,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  heroButton: { alignSelf: "flex-start" },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  serviceName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  serviceMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink60, marginTop: 2 },
  infoTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, marginBottom: spacing.xs },
  infoLine: { fontFamily: fonts.body, fontSize: 14, color: colors.ink60, marginTop: 2 },
});
