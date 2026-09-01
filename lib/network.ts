import { useMemo } from "react";
import * as Network from "expo-network";

export function useHerLinkNetworkState() {
  const networkState = Network.useNetworkState();

  return useMemo(() => {
    const isOffline =
      networkState.isConnected === false || networkState.isInternetReachable === false;

    return {
      ...networkState,
      isOffline,
      isOnline: !isOffline,
    };
  }, [networkState]);
}
