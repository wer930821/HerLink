// Play Console 要求 release 建置的 DEX 模糊化比例：開啟 R8 minify + shrinkResources。
// 只改 gradle.properties，不改任何程式邏輯。直向手機不受影響，
// R8 誤刪原生模組的風險要靠合併後側載 APK 實機驗證（聊天、選照片、通知）。
const { withGradleProperties } = require("@expo/config-plugins");

const PROPS = {
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

module.exports = function withAndroidMinify(config) {
  return withGradleProperties(config, (config) => {
    const results = config.modResults.filter(
      (prop) => prop.type !== "property" || !(prop.key in PROPS),
    );
    for (const [key, value] of Object.entries(PROPS)) {
      results.push({ type: "property", key, value });
    }
    config.modResults = results;
    return config;
  });
};
