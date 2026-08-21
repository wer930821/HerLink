import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenState } from "../../components/ScreenState";
import { TagChip } from "../../components/TagChip";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { useAuth } from "../../context/auth";
import {
  createVerificationSubmissionFromUri,
  deleteOwnProfilePhoto,
  fetchLatestVerification,
  fetchOwnProfilePhotos,
  pickSingleImage,
  reorderProfilePhotos,
  setPrimaryProfilePhoto,
  takeSinglePhoto,
  uploadProfilePhotoFromUri,
} from "../../lib/media";
import {
  getErrorMessage,
  getVerificationLabel,
  saveEditableProfile,
} from "../../lib/social";
import {
  interestOptions,
  normalizeStringArray,
  normalizeText,
  relationshipGoalOptions,
} from "../../lib/profile-options";
import { ProfilePhoto, Verification } from "../../lib/supabase";
import { colors } from "../../theme/colors";
import { radii, shadows, spacing, typography } from "../../theme";

interface EditableProfileState {
  displayName: string;
  city: string;
  bio: string;
  orientation: string;
  identityLabel: string;
  relationshipGoals: string[];
  interests: string[];
}

function calculateAge(birthday: string | null) {
  if (!birthday) {
    return null;
  }

  const birth = new Date(`${birthday}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age > 0 ? age : null;
}

function buildEditableState(profile: ReturnType<typeof useAuth>["profile"]): EditableProfileState {
  return {
    displayName: profile?.display_name ?? "",
    city: profile?.city ?? "",
    bio: profile?.bio ?? "",
    orientation: profile?.orientation ?? "",
    identityLabel: profile?.identity_label ?? "",
    relationshipGoals: normalizeStringArray(profile?.relationship_goals),
    interests: normalizeStringArray(profile?.interests),
  };
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, loading: authLoading, refreshProfile, signOut } = useAuth();
  const [form, setForm] = useState<EditableProfileState>(buildEditableState(profile));
  const [photos, setPhotos] = useState<Array<{ photo: ProfilePhoto; signedUrl: string }>>([]);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (showRefreshing = false) => {
      if (!user?.id) {
        return;
      }

      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const [photoRows, latestVerification] = await Promise.all([
          fetchOwnProfilePhotos(),
          fetchLatestVerification(),
          refreshProfile(),
        ]);
        setPhotos(photoRows);
        setVerification(latestVerification);
      } catch (loadFailure) {
        console.error(loadFailure);
        setError(getErrorMessage(loadFailure, "目前無法載入我的頁面。"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [refreshProfile, user?.id]
  );

  useEffect(() => {
    if (authLoading || !user?.id) {
      return;
    }

    void loadData();
  }, [authLoading, loadData, user?.id]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    setForm(buildEditableState(profile));
  }, [profile?.bio, profile?.city, profile?.display_name, profile?.identity_label, profile?.interests, profile?.orientation, profile?.relationship_goals]);

  const normalizedPayload = useMemo(
    () => ({
      display_name: normalizeText(form.displayName),
      city: normalizeText(form.city),
      bio: normalizeText(form.bio),
      orientation: normalizeText(form.orientation),
      identity_label: normalizeText(form.identityLabel),
      relationship_goals: normalizeStringArray(form.relationshipGoals),
      interests: normalizeStringArray(form.interests),
    }),
    [form]
  );

  const initialPayload = useMemo(
    () => ({
      display_name: normalizeText(profile?.display_name ?? ""),
      city: normalizeText(profile?.city ?? ""),
      bio: normalizeText(profile?.bio ?? ""),
      orientation: normalizeText(profile?.orientation ?? ""),
      identity_label: normalizeText(profile?.identity_label ?? ""),
      relationship_goals: normalizeStringArray(profile?.relationship_goals),
      interests: normalizeStringArray(profile?.interests),
    }),
    [profile]
  );

  const hasChanges = JSON.stringify(normalizedPayload) !== JSON.stringify(initialPayload);
  const age = calculateAge(profile?.birthday ?? null);
  const verificationLabel = getVerificationLabel(verification, profile?.verified ?? false);

  const saveProfile = async () => {
    if (!user?.id) {
      return;
    }

    if (!normalizedPayload.display_name) {
      Alert.alert("資料不完整", "請先填寫顯示名稱。");
      return;
    }

    if (normalizedPayload.bio.length > 280) {
      Alert.alert("自介過長", "自我介紹請控制在 280 字以內。");
      return;
    }

    if (!hasChanges) {
      Alert.alert("沒有變更", "目前沒有需要儲存的內容。");
      return;
    }

    setSaving(true);

    try {
      await saveEditableProfile(user.id, normalizedPayload);
      await refreshProfile();
      Alert.alert("已儲存", "個人資料已更新。");
    } catch (saveFailure) {
      console.error(saveFailure);
      Alert.alert("儲存失敗", getErrorMessage(saveFailure, "這次沒有成功更新個人資料。"));
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async () => {
    setUploadingPhoto(true);

    try {
      const selected = await pickSingleImage();
      if (!selected) {
        return;
      }

      await uploadProfilePhotoFromUri(selected.uri);
      await loadData(true);
      Alert.alert("照片已送出", "新照片已上傳，會依審核狀態決定是否公開顯示。");
    } catch (uploadFailure) {
      console.error(uploadFailure);
      Alert.alert("上傳失敗", getErrorMessage(uploadFailure, "照片上傳時發生錯誤。"));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const submitVerification = async (mode: "gallery" | "camera") => {
    setVerificationLoading(true);

    try {
      const asset = mode === "camera" ? await takeSinglePhoto() : await pickSingleImage();
      if (!asset) {
        return;
      }

      await createVerificationSubmissionFromUri(asset.uri, "selfie_manual");
      await loadData(true);
      Alert.alert("驗證已送出", "驗證照片已送交審核。");
    } catch (verificationFailure) {
      console.error(verificationFailure);
      Alert.alert("送出失敗", getErrorMessage(verificationFailure, "驗證資料送出時發生錯誤。"));
    } finally {
      setVerificationLoading(false);
    }
  };

  const movePhoto = async (index: number, direction: -1 | 1) => {
    const target = photos[index];
    const swap = photos[index + direction];
    if (!target || !swap) {
      return;
    }

    setPhotoBusyId(target.photo.id);

    try {
      const reordered = [...photos];
      reordered[index] = swap;
      reordered[index + direction] = target;
      await reorderProfilePhotos(reordered.map((entry) => entry.photo.id));
      await loadData(true);
    } catch (reorderFailure) {
      console.error(reorderFailure);
      Alert.alert("排序失敗", getErrorMessage(reorderFailure, "照片排序時發生錯誤。"));
    } finally {
      setPhotoBusyId(null);
    }
  };

  const handlePrimary = async (photoId: string) => {
    setPhotoBusyId(photoId);
    try {
      await setPrimaryProfilePhoto(photoId);
      await loadData(true);
    } catch (primaryFailure) {
      console.error(primaryFailure);
      Alert.alert("操作失敗", getErrorMessage(primaryFailure, "設定主照片時發生錯誤。"));
    } finally {
      setPhotoBusyId(null);
    }
  };

  const handleDelete = (index: number) => {
    const target = photos[index];
    if (!target) {
      return;
    }

    Alert.alert("刪除照片", "刪除後這張照片將不再顯示在個人資料中。", [
      { text: "取消", style: "cancel" },
      {
        text: "確認刪除",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setPhotoBusyId(target.photo.id);
            try {
              await deleteOwnProfilePhoto(target.photo);
              await loadData(true);
            } catch (deleteFailure) {
              console.error(deleteFailure);
              Alert.alert("刪除失敗", getErrorMessage(deleteFailure, "刪除照片時發生錯誤。"));
            } finally {
              setPhotoBusyId(null);
            }
          })(),
      },
    ]);
  };

  if (loading || authLoading) {
    return <ScreenState loading title="整理我的資料中..." body="我們正在同步個人資料、照片與驗證狀態。" />;
  }

  if (error) {
    return (
      <ScreenState
        title="我的頁面暫時無法載入"
        body={error}
        actionLabel="重新載入"
        onAction={() => void loadData(true)}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroAvatar}>
            <Text style={styles.heroAvatarText}>{(profile?.display_name?.slice(0, 1) || "我").toUpperCase()}</Text>
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroName}>{profile?.display_name || "尚未設定名稱"}</Text>
            <Text style={styles.heroMeta}>
              {profile?.city || "未填寫城市"}
              {age ? ` ・ ${age} 歲` : ""}
            </Text>
          </View>
          <VerifiedBadge verified={profile?.verified ?? false} />
        </View>

        <View style={styles.statusStrip}>
          <Text style={styles.statusStripTitle}>帳號狀態</Text>
          <Text style={styles.statusStripBody}>
            {verificationLabel} ・ 帳號狀態由安全流程管理，生日若需修改請由 support / moderation 協助。
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>編輯個人資料</Text>
        <TextInput
          style={styles.input}
          value={form.displayName}
          onChangeText={(value) => setForm((current) => ({ ...current, displayName: value }))}
          placeholder="顯示名稱"
        />
        <TextInput
          style={styles.input}
          value={form.city}
          onChangeText={(value) => setForm((current) => ({ ...current, city: value }))}
          placeholder="城市"
        />
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={form.bio}
          onChangeText={(value) => setForm((current) => ({ ...current, bio: value }))}
          placeholder="簡單介紹自己"
          multiline
          maxLength={280}
        />
        <Text style={styles.helperText}>{form.bio.length}/280</Text>
        <TextInput
          style={styles.input}
          value={form.orientation}
          onChangeText={(value) => setForm((current) => ({ ...current, orientation: value }))}
          placeholder="性向"
        />
        <TextInput
          style={styles.input}
          value={form.identityLabel}
          onChangeText={(value) => setForm((current) => ({ ...current, identityLabel: value }))}
          placeholder="身份標籤（可選）"
        />

        <Text style={styles.sectionTitle}>交友目的</Text>
        <View style={styles.chipRow}>
          {relationshipGoalOptions.map((goal) => (
            <TagChip
              key={goal}
              label={goal}
              selected={form.relationshipGoals.includes(goal)}
              onPress={() =>
                setForm((current) => ({
                  ...current,
                  relationshipGoals: current.relationshipGoals.includes(goal)
                    ? current.relationshipGoals.filter((item) => item !== goal)
                    : [...current.relationshipGoals, goal],
                }))
              }
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>興趣</Text>
        <View style={styles.chipRow}>
          {interestOptions.map((interest) => (
            <TagChip
              key={interest}
              label={interest}
              selected={form.interests.includes(interest)}
              onPress={() =>
                setForm((current) => ({
                  ...current,
                  interests: current.interests.includes(interest)
                    ? current.interests.filter((item) => item !== interest)
                    : [...current.interests, interest],
                }))
              }
            />
          ))}
        </View>

        <Pressable
          style={[styles.primaryButton, (!hasChanges || saving) && styles.buttonDisabled]}
          disabled={!hasChanges || saving}
          onPress={() => void saveProfile()}
        >
          <Text style={styles.primaryButtonText}>{saving ? "儲存中..." : "儲存變更"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.cardTitle}>公開照片</Text>
            <Text style={styles.helperText}>只有 approved 照片會出現在探索與聊天中。</Text>
          </View>
          <Pressable
            style={[styles.secondaryButton, uploadingPhoto && styles.buttonDisabled]}
            disabled={uploadingPhoto}
            onPress={() => void uploadPhoto()}
          >
            <Text style={styles.secondaryButtonText}>{uploadingPhoto ? "上傳中..." : "新增照片"}</Text>
          </Pressable>
        </View>

        {photos.length === 0 ? (
          <Text style={styles.emptyText}>目前還沒有照片，至少新增一張會更容易讓對方認識妳。</Text>
        ) : (
          photos.map((entry, index) => (
            <View key={entry.photo.id} style={styles.photoRow}>
              <Image source={{ uri: entry.signedUrl }} style={styles.photoImage} resizeMode="cover" />
              <View style={styles.photoBody}>
                <Text style={styles.photoTitle}>
                  {entry.photo.is_primary ? "主照片" : `照片 ${index + 1}`} ・ {entry.photo.moderation_status}
                </Text>
                <View style={styles.inlineActions}>
                  <Pressable
                    disabled={photoBusyId === entry.photo.id || entry.photo.is_primary}
                    onPress={() => void handlePrimary(entry.photo.id)}
                  >
                    <Text style={styles.inlineActionText}>{entry.photo.is_primary ? "目前主照片" : "設為主照片"}</Text>
                  </Pressable>
                  <Pressable disabled={photoBusyId === entry.photo.id || index === 0} onPress={() => void movePhoto(index, -1)}>
                    <Text style={styles.inlineActionText}>上移</Text>
                  </Pressable>
                  <Pressable
                    disabled={photoBusyId === entry.photo.id || index === photos.length - 1}
                    onPress={() => void movePhoto(index, 1)}
                  >
                    <Text style={styles.inlineActionText}>下移</Text>
                  </Pressable>
                  <Pressable disabled={photoBusyId === entry.photo.id} onPress={() => handleDelete(index)}>
                    <Text style={styles.inlineDangerText}>刪除</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>真人驗證</Text>
        <Text style={styles.helperText}>目前狀態：{verificationLabel}</Text>
        <View style={styles.inlineActions}>
          <Pressable
            style={[styles.secondaryButton, verificationLoading && styles.buttonDisabled]}
            disabled={verificationLoading}
            onPress={() => void submitVerification("gallery")}
          >
            <Text style={styles.secondaryButtonText}>從相簿送出</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, verificationLoading && styles.buttonDisabled]}
            disabled={verificationLoading}
            onPress={() => void submitVerification("camera")}
          >
            <Text style={styles.primaryButtonText}>{verificationLoading ? "送出中..." : "拍照送出"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>安全與帳號</Text>
        <Text style={styles.helperText}>
          帳號狀態、verified、trust score 都由系統與 moderation 控制，不在一般編輯頁開放修改。
        </Text>
        <View style={styles.inlineActions}>
          <Pressable style={styles.secondaryButton} onPress={() => router.push("/(tabs)/safety")}>
            <Text style={styles.secondaryButtonText}>安全中心</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
            <Text style={styles.secondaryButtonText}>登出</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  heroCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadows.card,
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  heroAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  heroAvatarText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
  },
  heroBody: {
    flex: 1,
  },
  heroName: {
    color: colors.text,
    ...typography.sectionTitle,
  },
  heroMeta: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    ...typography.body,
  },
  statusStrip: {
    borderRadius: radii.md,
    backgroundColor: colors.infoSurface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statusStripTitle: {
    color: colors.verified,
    ...typography.bodyStrong,
  },
  statusStripBody: {
    color: colors.textMuted,
    ...typography.body,
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.card,
  },
  cardTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  helperText: {
    color: colors.textSoft,
    ...typography.caption,
  },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.text,
    ...typography.bodyStrong,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButtonText: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  emptyText: {
    color: colors.textMuted,
    ...typography.body,
  },
  photoRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  photoImage: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  photoBody: {
    flex: 1,
    gap: spacing.sm,
  },
  photoTitle: {
    color: colors.text,
    ...typography.bodyStrong,
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    alignItems: "center",
  },
  inlineActionText: {
    color: colors.primary,
    ...typography.bodyStrong,
  },
  inlineDangerText: {
    color: colors.error,
    ...typography.bodyStrong,
  },
});
