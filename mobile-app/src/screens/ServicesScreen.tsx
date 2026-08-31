import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import services from "../data/services.json";
import { colors, fonts, spacing } from "../theme/theme";
import type { MainTabsParamList, RootStackParamList, Service } from "../types";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabsParamList, "Services">,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function ServicesScreen() {
  const navigation = useNavigation<Nav>();

  const sections = useMemo(() => {
    const byCategory = new Map<string, Service[]>();
    for (const service of services as Service[]) {
      const list = byCategory.get(service.category) ?? [];
      list.push(service);
      byCategory.set(service.category, list);
    }
    return Array.from(byCategory.entries()).map(([title, data]) => ({ title, data }));
  }, []);

  return (
    <View style={styles.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <ScreenHeader eyebrow="Menu" title="Services" subtitle="Tap a service to pick a stylist and time." />
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => navigation.navigate("ServiceDetail", { serviceId: item.id })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.durationMinutes} min</Text>
            </View>
            <Text style={styles.price}>${item.price}</Text>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.5,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.sageDim,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.sageLight },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink60, marginTop: 2 },
  price: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.sageDim },
});
