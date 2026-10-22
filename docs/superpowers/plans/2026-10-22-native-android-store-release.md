# HerLink Native Android Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a redesigned native Android HerLink app that is functionally production-ready and can be submitted to Google Play.

**Architecture:** Keep the existing Expo Router and Supabase data layer. Replace the mobile presentation layer with a shared native design system and focused screen components, while preserving existing chat/recovery RPCs and anonymous identity data.

**Tech Stack:** Expo 57, React Native, expo-router, Supabase Realtime/RPC, expo-notifications, GitHub Actions, Android AAB/APK.

**Spec:** docs/superpowers/specs/2026-10-22-native-android-store-design.md

## Global Constraints

- Keep anonymous chat as the product boundary.
- Do not create a second backend or migrate existing chat data.
- Use Traditional Chinese for user-facing text.
- Build Android releases only with GitHub Actions; do not use EAS Build.
- Do not commit credentials, APKs, certificates, service keys, or user chat content.
- Preserve applicationId `com.wer93.herlink`.

## Review Focus

- Existing anonymous identities and sessions must remain visible after app updates; test update/install against the same Supabase account.
- Realtime disconnect and app resume must resync messages; test by disabling and restoring network.
- Notification permission denial must not block chat; test first launch with permission denied.
- A 5MB image and an oversized image must produce the correct result; test both picker paths.
- Back navigation from chat, modal menus, and keyboard must not exit the wrong screen; test Android system back.

### Task 1: Native design system

**Files:**
- Create/modify: `theme/*`, `components/native-ui/*`
- Test: `tests/mobile-design-system.test.cjs`

**Interfaces:**
- Produce shared colors, spacing, typography, card, button, badge, empty-state, and modal primitives.
- Use a single seasonal theme configuration so Halloween decorations can be disabled without changing screen logic.

- [ ] Define the production color tokens, typography scale, spacing, radii, and minimum touch target.
- [ ] Add component tests for primary/secondary/destructive buttons and disabled/loading states.
- [ ] Verify no component contains Web-only DOM or CSS.
- [ ] Commit: `feat(app): add native production design system`.

### Task 2: Native navigation shell

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Create/modify: `components/native-ui/AppTabBar.tsx`
- Test: `tests/mobile-navigation.test.cjs`

**Interfaces:**
- Consume the design system from Task 1.
- Produce stable routes for Home, Chats, Contacts, Mailbox, and Settings.
- Hide the tab bar only inside `random-session/[sessionId]`.

- [ ] Implement the five-tab shell with active state, unread badge, safe-area padding, and Traditional Chinese labels.
- [ ] Test route selection, tab persistence, and chat-screen tab hiding.
- [ ] Verify Android back behavior for nested routes.
- [ ] Commit: `feat(app): add production navigation shell`.

### Task 3: Home and matching flow

**Files:**
- Modify: `app/(tabs)/index.tsx`, `app/random.tsx`
- Create/modify: `components/home/*`
- Test: `tests/mobile-home-matching.test.cjs`

**Interfaces:**
- Consume presence APIs, anonymous-name APIs, and existing matching functions.
- Produce the new home cards, presence counts, name change action, matching state, and waiting state.

- [ ] Build the new home screen with primary matching action, anonymous identity card, online/waiting counts, and recovery entry.
- [ ] Implement loading, no-network, no-match, and matched states without replacing existing identity data.
- [ ] Test starting a match, returning from waiting, and replacing a stale session.
- [ ] Commit: `feat(app): redesign home and matching`.

### Task 4: Halloween native chat

**Files:**
- Modify: `app/random-session/[sessionId].tsx`
- Create/modify: `components/chat/*`
- Test: `tests/mobile-chat-flow.test.cjs`

**Interfaces:**
- Consume existing random-chat functions and Supabase Realtime channel.
- Produce the redesigned chat header, message list, reply composer, image flow, typing state, action menu, and safety banner.

- [ ] Extract message bubble, reply preview, composer, typing indicator, and action menu into focused components.
- [ ] Preserve send text, send image, reply, recall, next, leave, block, report, contact request, recovery code, and link-opening behavior.
- [ ] Add Halloween background effects as non-interactive decoration only.
- [ ] Test message send, reply fallback when target is missing, image size validation, Realtime reconnect, and Android keyboard/back behavior.
- [ ] Commit: `feat(app): redesign native Halloween chat`.

### Task 5: Chats, contacts, mailbox, and settings

**Files:**
- Modify: `app/chats.tsx`, `app/contacts.tsx`, `app/mailbox.tsx`, `app/account-login.tsx`, `app/account-signup.tsx`, `app/recovery.tsx`
- Create/modify: `components/account/*`, `components/mailbox/*`
- Test: `tests/mobile-account-surfaces.test.cjs`

**Interfaces:**
- Consume existing account, recovery, mailbox, contacts, and collection APIs.
- Produce unified list cards, unread badges, empty states, and account actions.

- [ ] Apply the new design system to all non-chat screens.
- [ ] Ensure account binding, login, signup, password recovery, anonymous recovery, contact approval, mailbox read state, privacy, terms, and support remain reachable.
- [ ] Test authenticated, anonymous, empty, expired-link, and error states.
- [ ] Commit: `feat(app): redesign account and utility screens`.

### Task 6: Notifications and store compliance

**Files:**
- Modify: `app.json`, notification modules, `.github/workflows/mobile-build.yml`
- Create/modify: `app/settings.tsx`, `docs/store/*`
- Test: `tests/mobile-release.test.cjs`

**Interfaces:**
- Consume Firebase configuration through GitHub Actions secrets only.
- Produce notification permission flow, deep-link handling, AAB, APK, and update manifest.

- [ ] Request notification permission without blocking app use.
- [ ] Route notification taps to the correct chat or mailbox.
- [ ] Add release workflow output for signed/submit-ready AAB while retaining APK test output.
- [ ] Verify monotonic versionCode/versionName, applicationId, permissions, privacy URL, account deletion path, and no secret files in the repository.
- [ ] Commit: `feat(release): prepare Android store build`.

### Task 7: End-to-end verification

**Files:**
- Modify: `tests/*` only when a discovered regression needs coverage.
- Verify: GitHub Actions workflow and release assets.

- [ ] Run the mobile test suite and TypeScript/Expo validation available in the repository.
- [ ] Trigger GitHub Actions and inspect the Android build job.
- [ ] Confirm both APK and AAB are produced; do not publish if the build fails.
- [ ] Install the APK on a real Android device and verify the core anonymous-chat path.
- [ ] Publish the final release only after successful verification.
- [ ] Commit: `chore: verify Android store release`.
