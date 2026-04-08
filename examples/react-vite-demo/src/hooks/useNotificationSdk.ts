import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  MessageType,
  NotificationSDK,
  createWebSocketSDK,
  type Message,
  type WebSocketSDKConfig
} from "@soratani-code/notification-sdk";

export type SDKStats = ReturnType<NotificationSDK["getStats"]>;
export type LogLevel = "info" | "warn" | "error" | "sent" | "recv";

type UseNotificationSdkOptions = {
  createSdkConfig: () => WebSocketSDKConfig;
  selectedTypes: Record<MessageType, boolean>;
  guardAuth: (actionLabel: string) => boolean;
  onLog: (level: LogLevel, message: string) => void;
  onMessage: (message: Message) => void;
};

type UseNotificationSdkResult = {
  canUseSdk: boolean;
  connectionState: ConnectionState;
  stats: SDKStats | null;
  ensureSdk: () => NotificationSDK | null;
  initializeSdk: () => void;
  connectNow: () => Promise<void>;
  disconnectNow: () => void;
  reconnectNow: () => Promise<void>;
  disposeSdk: () => void;
  refreshSubscription: () => void;
  subscribeNextSystemMessage: () => void;
};

export function useNotificationSdk(options: UseNotificationSdkOptions): UseNotificationSdkResult {
  const sdkRef = useRef<NotificationSDK | null>(null);
  const stateDisposerRef = useRef<(() => void) | null>(null);
  const errorDisposerRef = useRef<(() => void) | null>(null);
  const subscriptionRef = useRef<string | null>(null);

  const [canUseSdk, setCanUseSdk] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [stats, setStats] = useState<SDKStats | null>(null);

  const cleanupListeners = useCallback((): void => {
    if (sdkRef.current && subscriptionRef.current) {
      sdkRef.current.unsubscribe(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    if (stateDisposerRef.current) {
      stateDisposerRef.current();
      stateDisposerRef.current = null;
    }

    if (errorDisposerRef.current) {
      errorDisposerRef.current();
      errorDisposerRef.current = null;
    }
  }, []);

  const subscribeWithCurrentTypes = useCallback((sdk: NotificationSDK): void => {
    if (subscriptionRef.current) {
      sdk.unsubscribe(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    const types = (Object.values(MessageType) as MessageType[]).filter((item) => options.selectedTypes[item]);
    if (types.length === 0) {
      options.onLog("warn", "未选择任何订阅类型，已跳过订阅。");
      return;
    }

    subscriptionRef.current = sdk.subscribe(types, async (message: Message) => {
      options.onMessage(message);
      options.onLog("recv", `收到消息 ${message.type} (${message.id})`);
    });

    options.onLog("info", `已订阅 ${types.length} 种消息类型。`);
  }, [options]);

  const createAndBindSdk = useCallback((): NotificationSDK => {
    const sdk = createWebSocketSDK(options.createSdkConfig());
    sdkRef.current = sdk;
    setCanUseSdk(true);

    stateDisposerRef.current = sdk.onConnectionChange((next: ConnectionState, prev: ConnectionState) => {
      setConnectionState(next);
      options.onLog("info", `连接状态: ${prev} -> ${next}`);
    });

    errorDisposerRef.current = sdk.onError((error: Error) => {
      options.onLog("error", `连接错误: ${error.message}`);
    });

    setConnectionState(sdk.getConnectionState());
    subscribeWithCurrentTypes(sdk);
    options.onLog("info", "SDK 已初始化。");
    return sdk;
  }, [options, subscribeWithCurrentTypes]);

  const ensureSdk = useCallback((): NotificationSDK | null => {
    if (!options.guardAuth("使用 SDK")) {
      return null;
    }

    if (sdkRef.current) {
      return sdkRef.current;
    }

    const config = options.createSdkConfig();
    if (!config.endpoint.trim() || !config.clientId.trim()) {
      options.onLog("error", "SDK 尚未初始化，且 endpoint/clientId 为空。");
      return null;
    }

    return createAndBindSdk();
  }, [createAndBindSdk, options]);

  const initializeSdk = useCallback((): void => {
    if (!options.guardAuth("初始化 SDK")) {
      return;
    }

    const config = options.createSdkConfig();
    if (!config.endpoint.trim() || !config.clientId.trim()) {
      options.onLog("error", "请先填写 endpoint 与 clientId。");
      return;
    }

    if (sdkRef.current) {
      cleanupListeners();
      sdkRef.current.dispose();
      sdkRef.current = null;
    }

    setStats(null);
    createAndBindSdk();
  }, [cleanupListeners, createAndBindSdk, options]);

  const connectNow = useCallback(async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      options.onLog("info", "开始连接...");
      await sdk.connect();
      options.onLog("info", "连接成功。");
    } catch (error) {
      const connectError = error instanceof Error ? error : new Error("连接失败");
      options.onLog("error", connectError.message);
    }
  }, [ensureSdk, options]);

  const disconnectNow = useCallback((): void => {
    if (!options.guardAuth("断开连接")) {
      return;
    }

    if (!sdkRef.current) {
      return;
    }

    sdkRef.current.disconnect("UI manual disconnect");
    options.onLog("warn", "已手动断开连接。");
  }, [options]);

  const reconnectNow = useCallback(async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      options.onLog("info", "触发重连...");
      await sdk.reconnect();
      options.onLog("info", "重连成功。");
    } catch (error) {
      const reconnectError = error instanceof Error ? error : new Error("重连失败");
      options.onLog("error", reconnectError.message);
    }
  }, [ensureSdk, options]);

  const disposeSdk = useCallback((): void => {
    if (!sdkRef.current) {
      return;
    }

    cleanupListeners();
    sdkRef.current.dispose();
    sdkRef.current = null;
    setCanUseSdk(false);
    setConnectionState(ConnectionState.DISCONNECTED);
    setStats(null);
    options.onLog("warn", "SDK 已销毁。");
  }, [cleanupListeners, options]);

  const refreshSubscription = useCallback((): void => {
    if (!options.guardAuth("应用订阅配置")) {
      return;
    }

    if (!sdkRef.current) {
      options.onLog("warn", "SDK 未初始化，无法重置订阅。");
      return;
    }

    subscribeWithCurrentTypes(sdkRef.current);
  }, [options, subscribeWithCurrentTypes]);

  const subscribeNextSystemMessage = useCallback((): void => {
    if (!options.guardAuth("订阅一次性消息")) {
      return;
    }

    if (!sdkRef.current) {
      options.onLog("warn", "SDK 未初始化，无法订阅一次性消息。");
      return;
    }

    sdkRef.current.subscribeOnce(MessageType.SYSTEM, async (message: Message) => {
      options.onLog("recv", `一次性订阅收到 SYSTEM 消息: ${message.id}`);
      options.onMessage(message);
    });

    options.onLog("info", "已开启下一条 SYSTEM 消息的一次性订阅。");
  }, [options]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!sdkRef.current) {
        return;
      }

      setStats(sdkRef.current.getStats());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupListeners();
      sdkRef.current?.dispose();
      sdkRef.current = null;
    };
  }, [cleanupListeners]);

  return {
    canUseSdk,
    connectionState,
    stats,
    ensureSdk,
    initializeSdk,
    connectNow,
    disconnectNow,
    reconnectNow,
    disposeSdk,
    refreshSubscription,
    subscribeNextSystemMessage
  };
}
