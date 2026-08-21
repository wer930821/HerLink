import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

const DEVICE_ID_KEY = "herlink.device.installation-id";

function createInstallationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function getDeviceHash() {
  let installationId = await AsyncStorage.getItem(DEVICE_ID_KEY);

  if (!installationId) {
    installationId = createInstallationId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, installationId);
  }

  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, installationId);
}

export async function registerCurrentDevice() {
  const deviceHash = await getDeviceHash();
  const { data, error } = await supabase.rpc("register_device", {
    p_device_hash: deviceHash,
  });

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}
