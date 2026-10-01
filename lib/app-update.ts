import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

export type HerLinkUpdateInfo = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256?: string;
  commit?: string;
};

const UPDATE_INFO_URL =
  "https://github.com/wer930821/HerLink/releases/download/latest/update-info.json";

function currentBuildVersion() {
  const value = Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAvailableHerLinkUpdate() {
  if (Platform.OS !== "android") return null;

  const response = await fetch(`${UPDATE_INFO_URL}?t=${Date.now()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`UPDATE_INFO_HTTP_${response.status}`);
  }

  const info = (await response.json()) as Partial<HerLinkUpdateInfo>;
  if (
    typeof info.versionCode !== "number" ||
    typeof info.versionName !== "string" ||
    typeof info.apkUrl !== "string"
  ) {
    throw new Error("UPDATE_INFO_INVALID");
  }

  return info.versionCode > currentBuildVersion()
    ? (info as HerLinkUpdateInfo)
    : null;
}

export async function downloadAndInstallHerLinkUpdate(info: HerLinkUpdateInfo) {
  if (Platform.OS !== "android") {
    await Linking.openURL(info.apkUrl);
    return;
  }

  const target = `${FileSystem.cacheDirectory}HerLink-latest.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);

  const result = await FileSystem.downloadAsync(info.apkUrl, target);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`APK_DOWNLOAD_HTTP_${result.status}`);
  }

  try {
    const contentUri = await FileSystem.getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      flags: 1,
      type: "application/vnd.android.package-archive",
    });
  } catch {
    await Linking.openURL(info.apkUrl);
  }
}
