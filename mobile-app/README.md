# Heart & Soul Booking (mobile app)

A cross-platform booking app for Heart & Soul Hair Studio, built with
[Expo](https://expo.dev) / React Native so a single codebase ships to both the
Apple App Store and Google Play.

Clients can browse services, pick a stylist, pick an open date/time, and
confirm an appointment. Bookings are saved on-device (`AsyncStorage`) so the
app works fully offline with no backend to run — see **Going further** below
for wiring it to a real backend/calendar.

## What's included

- **Home** — salon intro + popular services with a one-tap "Book" shortcut.
- **Services** — full menu grouped by category (Cuts, Color, Styling, Treatments).
- **Booking flow** — choose stylist → choose date → choose an open time slot
  (computed from the salon's posted hours, in 30-min increments, blocking
  slots already taken for that stylist) → enter contact details → confirm.
- **My Bookings** — upcoming/past appointments, with cancel.
- **Salon Info** — hours, call, directions, Instagram.

All copy, services, stylists, hours, and colors live in `src/data/*.json` and
`src/theme/theme.ts` — edit those, no code changes needed, to reflect real
staff/pricing/hours before shipping.

## Run it locally

```
cd mobile-app
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (iOS/Android) for the fastest way
to see it on a real device, or press `a` / `i` in the terminal for an
Android/iOS simulator, or `w` for a web preview.

## Project structure

```
App.tsx                     font loading, providers, root render
src/theme/theme.ts           brand colors, fonts, spacing (matches the SEO dashboard's palette)
src/data/services.json       service menu (name, duration, price)
src/data/stylists.json       stylist roster
src/data/salonInfo.json      address, phone, hours, socials
src/data/timeSlots.ts        computes open slots from salonInfo.hours
src/context/BookingsContext  booking CRUD + AsyncStorage persistence
src/screens/                 Home, Services, ServiceDetail, Booking, Confirmation, MyBookings, SalonInfo
src/navigation/               bottom tabs + stack navigator
src/components/               Button, Card, ScreenHeader
```

## Before you submit to either store

1. **Replace the placeholder identifiers** in `app.json`:
   - `ios.bundleIdentifier` and `android.package` are currently
     `com.heartandsoulhairstudio.booking` — change the domain prefix if the
     studio doesn't own that reverse-DNS name.
2. **Replace the placeholder icons/splash** in `assets/` (currently the
   default Expo template graphics) with the studio's real logo — 1024×1024
   PNG for `icon.png`, plus adaptive-icon layers for Android. Canva/Figma
   export at that size works fine.
3. **Write a privacy policy** and host it somewhere public — both stores
   require a URL to one, even for an app with no backend (state what
   `AsyncStorage` keeps on-device and that nothing is transmitted, if that
   stays true).
4. **Decide on real scheduling data.** Right now "today's bookings" only
   exist on the device that made them — there's no shared calendar, so two
   clients could book the same slot with different stylists' phones and the
   salon wouldn't see it anywhere but each customer's own phone. Fine for a
   demo; not fine for real double-booking prevention. See **Going further**.

## Building for the stores (EAS)

This project includes `eas.json` with `development` / `preview` / `production`
build profiles. [EAS Build](https://docs.expo.dev/build/introduction/) builds
signed iOS/Android binaries in the cloud — no Mac required, even for iOS.

```
npm install -g eas-cli
eas login                      # your own Expo account
eas build:configure            # links this project to an EAS project
eas build --platform android --profile production
eas build --platform ios --profile production
```

You'll need, once, before the first real submission:

- An **Apple Developer Program** membership ($99/year) — required to submit
  to the App Store, and EAS will prompt you to log in with it during
  `ios` builds/submits.
- A **Google Play Console** developer account ($25 one-time) — required to
  submit to Play.

Both are studio-owned accounts; nothing in this codebase can create them for
you.

## Submitting

```
eas submit --platform android --profile production
eas submit --platform ios --profile production
```

`eas submit` uploads the signed binary from your last build. Play still
requires a first manual upload through the Play Console UI to create the
app listing (icon, screenshots, description, content rating questionnaire,
data-safety form, privacy policy URL) before automated submits work; the App
Store equivalent is filling out the listing in App Store Connect.

## Going further (optional, not required to ship v1)

- **Shared backend**: swap `BookingsContext`'s AsyncStorage calls for a real
  API (e.g. Firebase, Supabase, or a small REST service) so the salon has one
  shared calendar and slots are actually locked across devices.
- **Push notifications**: `expo-notifications` for booking reminders.
- **Admin view**: a simple staff screen/app to see and manage the day's
  bookings, instead of relying on the client-side "no preference" default.
