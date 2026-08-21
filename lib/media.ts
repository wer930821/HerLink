import * as ImagePicker from "expo-image-picker";
import {
  CreateProfilePhotoResult,
  CreateVerificationResult,
  ProfilePhoto,
  PublicProfilePhoto,
  supabase,
  Verification,
} from "./supabase";

export interface SignedPhoto {
  photoId: string;
  userId: string;
  storagePath: string;
  signedUrl: string;
}

const SIGNED_URL_TTL_MS = 55 * 60 * 1000;
const signedPhotoUrlCache = new Map<string, { signedUrl: string; expiresAt: number }>();

export async function pickSingleImage() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("需要照片權限才能上傳圖片。");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 0.85,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  return result.assets[0];
}

export async function takeSinglePhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error("需要相機權限才能拍攝驗證照片。");
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.85,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  return result.assets[0];
}

function extensionFromUri(uri: string) {
  const match = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return match?.[1] || "jpg";
}

async function uriToArrayBuffer(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("讀取本機圖片失敗。");
  }
  return response.arrayBuffer();
}

export async function createSignedProfilePhotoUrl(storagePath: string) {
  const cached = signedPhotoUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.signedUrl;
  }

  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    throw error;
  }

  signedPhotoUrlCache.set(storagePath, {
    signedUrl: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS,
  });

  return data.signedUrl;
}

export async function resolveSignedProfilePhotoUrls(
  photos: Array<{ id: string; user_id: string; storage_path: string }>
) {
  const signedEntries = await Promise.all(
    photos.map(async (photo) => ({
      photoId: photo.id,
      userId: photo.user_id,
      storagePath: photo.storage_path,
      signedUrl: await createSignedProfilePhotoUrl(photo.storage_path),
    }))
  );

  return new Map(signedEntries.map((entry) => [entry.userId, entry]));
}

export async function fetchPublicPrimaryPhotoMap(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, SignedPhoto>();
  }

  const { data, error } = await supabase.rpc("get_public_primary_photos", {
    p_user_ids: [...new Set(userIds)],
  });

  if (error) {
    throw error;
  }

  return resolveSignedProfilePhotoUrls(data ?? []);
}

export async function fetchPublicPhotoGroups(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, SignedPhoto[]>();
  }

  const { data, error } = await supabase.rpc("get_public_profile_photos", {
    p_user_ids: [...new Set(userIds)],
  });

  if (error) {
    throw error;
  }

  const signedEntries = await Promise.all(
    ((data ?? []) as PublicProfilePhoto[]).map(async (photo) => ({
      photoId: photo.id,
      userId: photo.user_id,
      storagePath: photo.storage_path,
      signedUrl: await createSignedProfilePhotoUrl(photo.storage_path),
    }))
  );

  const grouped = new Map<string, SignedPhoto[]>();
  for (const entry of signedEntries) {
    grouped.set(entry.userId, [...(grouped.get(entry.userId) ?? []), entry]);
  }

  return grouped;
}

export async function fetchOwnProfilePhotos() {
  const { data, error } = await supabase
    .from("profile_photos")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const photos = (data ?? []) as ProfilePhoto[];
  const signedPhotos = await Promise.all(
    photos.map(async (photo) => ({
      photo,
      signedUrl: await createSignedProfilePhotoUrl(photo.storage_path),
    }))
  );

  return signedPhotos;
}

export async function uploadProfilePhotoFromUri(uri: string) {
  const extension = extensionFromUri(uri);
  const { data, error } = await supabase.rpc("create_profile_photo", {
    p_file_extension: extension,
  });

  if (error) {
    throw error;
  }

  const createdPhoto = data?.[0] as CreateProfilePhotoResult | undefined;
  if (!createdPhoto) {
    throw new Error("建立照片資料失敗。");
  }

  const fileBuffer = await uriToArrayBuffer(uri);
  const { error: uploadError } = await supabase.storage
    .from("profile-photos")
    .upload(createdPhoto.storage_path, fileBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  return createdPhoto;
}

export async function createVerificationSubmissionFromUri(
  uri: string,
  method: "liveness_manual" | "selfie_manual"
) {
  const extension = extensionFromUri(uri);
  const { data, error } = await supabase.rpc("create_verification_submission", {
    p_method: method,
    p_file_extension: extension,
  });

  if (error) {
    throw error;
  }

  const createdVerification = data?.[0] as CreateVerificationResult | undefined;
  if (!createdVerification) {
    throw new Error("建立驗證資料失敗。");
  }

  const fileBuffer = await uriToArrayBuffer(uri);
  const { error: uploadError } = await supabase.storage
    .from("verification-private")
    .upload(createdVerification.media_path, fileBuffer, {
      contentType: "image/jpeg",
    });

  if (uploadError) {
    throw uploadError;
  }

  return createdVerification;
}

export async function fetchLatestVerification() {
  const { data, error } = await supabase
    .from("verifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Verification | null) ?? null;
}

export async function setPrimaryProfilePhoto(photoId: string) {
  const { data, error } = await supabase.rpc("set_primary_profile_photo", {
    p_photo_id: photoId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function reorderProfilePhotos(photoIds: string[]) {
  const { data, error } = await supabase.rpc("reorder_profile_photos", {
    p_photo_ids: photoIds,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteOwnProfilePhoto(photo: Pick<ProfilePhoto, "id" | "storage_path">) {
  const { error: storageError } = await supabase.storage
    .from("profile-photos")
    .remove([photo.storage_path]);

  if (storageError) {
    throw storageError;
  }

  const { data, error } = await supabase.rpc("delete_profile_photo", {
    p_photo_id: photo.id,
  });

  if (error) {
    throw error;
  }

  return data;
}
