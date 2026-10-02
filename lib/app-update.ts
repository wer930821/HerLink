import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, NativeModules, Platform } from "react-native";

export type HerLinkUpdateInfo = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256?: string;
  commit?: string;
};

export type HerLinkUpdateDownload = {
  uri: string;
  reused: boolean;
};

const UPDATE_INFO_URL =
  "https://github.com/wer930821/HerLink/releases/download/latest/update-info.json";
const APK_FILE_NAME = "HerLink-latest.apk";

function currentBuildVersion() {
  const value = Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apkTarget() {
  if (!FileSystem.documentDirectory) throw new Error("APK_STORAGE_UNAVAILABLE");
  return `${FileSystem.documentDirectory}${APK_FILE_NAME}`;
}

async function sha256File(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

async function isDownloadedApkValid(info: HerLinkUpdateInfo, uri: string) {
  const file = await FileSystem.getInfoAsync(uri);
  if (!file.exists || !info.sha256) return false;
  const digest = await sha256File(uri);
  return digest.toLowerCase() === info.sha256.toLowerCase();
}

export async function getAvailableHerLinkUpdate() {
  if (Platform.OS !== "android") return null;

  const response = await fetch(`${UPDATE_INFO_URL}?t=${Date.now()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`UPDATE_INFO_HTTP_${response.status}`);

  const info = (await response.json()) as Partial<HerLinkUpdateInfo>;
  if (
    typeof info.versionCode !== "number" ||
    typeof info.versionName !== "string" ||
    typeof info.apkUrl !== "string"
  ) {
    throw new Error("UPDATE_INFO_INVALID");
  }

  return info.versionCode > currentBuildVersion() ? (info as HerLinkUpdateInfo) : null;
}

export async function downloadHerLinkUpdate(
  info: HerLinkUpdateInfo,
  onProgress?: (progress: number) => void
): Promise<HerLinkUpdateDownload> {
  if (Platform.OS !== "android") throw new Error("ANDROID_ONLY");

  const target = apkTarget();
  if (await isDownloadedApkValid(info, target)) {
    onProgress?.(1);
    return { uri: target, reused: true };
  }

  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  const resumable = FileSystem.createDownloadResumable(
    info.apkUrl,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) {
        onProgress?.(Math.min(1, totalBytesWritten / totalBytesExpectedToWrite));
      }
    }
  );

  const result = await resumable.downloadAsync();
  if (!result?.uri) throw new Error("APK_DOWNLOAD_FAILED");

  if (info.sha256 && !(await isDownloadedApkValid(info, result.uri))) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error("APK_SHA256_MISMATCH");
  }

  onProgress?.(1);
  return { uri: result.uri, reused: false };
}

export async function canInstallUnknownApps() {
  if (Platform.OS !== "android") return true;
  const installer = NativeModules.HerLinkApkInstaller;
  if (installer?.canRequestPackageInstalls) {
    return Boolean(await installer.canRequestPackageInstalls());
  }
  return false;
}

export async function openInstallPermissionSettings() {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", {
      data: `package:${Constants.expoConfig?.android?.package ?? "com.wer93.herlink"}`,
    });
  } catch {
    await Linking.openSettings();
  }
}

export async function installDownloadedHerLinkApk(uri: string) {
  if (Platform.OS !== "android") return;
  const installer = NativeModules.HerLinkApkInstaller;
  if (installer?.installApk) {
    await installer.installApk(uri);
    return;
  }

  const contentUri = await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1,
    type: "application/vnd.android.package-archive",
  });
}

export async function downloadAndInstallHerLinkUpdate(
  info: HerLinkUpdateInfo,
  onProgress?: (progress: number) => void
) {
  if (Platform.OS !== "android") {
    await Linking.openURL(info.apkUrl);
    return;
  }
  const download = await downloadHerLinkUpdate(info, onProgress);
  const allowed = await canInstallUnknownApps();
  if (!allowed) {
    await openInstallPermissionSettings();
    throw Object.assign(new Error("APK_INSTALL_PERMISSION_REQUIRED"), {
      code: "APK_INSTALL_PERMISSION_REQUIRED",
      apkUri: download.uri,
    });
  }
  await installDownloadedHerLinkApk(download.uri);
}
