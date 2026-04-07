import { MessagePriority, MessageType } from "./message";
import type { ManagerOptions, SocketOptions } from "socket.io-client";

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error"
}

export interface HeartbeatAdaptiveConfig {
  enabled?: boolean;
  minInterval?: number;
  maxInterval?: number;
  increaseFactor?: number;
  decreaseFactor?: number;
  lowLatencyThreshold?: number;
  highLatencyThreshold?: number;
}

export interface MessageBatchConfig {
  enabled?: boolean;
  maxBatchSize?: number;
  flushInterval?: number;
  eventName?: string;
}

export interface WebSocketSDKConfig {
  endpoint: string;
  clientId: string;
  authToken?: string;
  preferWebSocketTransport?: boolean;
  ackTimeout?: number;
  pendingSweepInterval?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  connectionTimeout?: number;
  debug?: boolean;
  headers?: Record<string, string>;
  protocols?: string | string[];
  messageQueueSize?: number;
  autoConnect?: boolean;
  useBinary?: boolean;
  heartbeatAdaptive?: HeartbeatAdaptiveConfig;
  messageBatch?: MessageBatchConfig;
  socketIOOptions?: Omit<Partial<ManagerOptions & SocketOptions>, 'extraHeaders'>;
}

export const DEFAULT_CONFIG: Omit<WebSocketSDKConfig, "endpoint" | "clientId"> = {
  preferWebSocketTransport: true,
  ackTimeout: 30000,
  pendingSweepInterval: 1000,
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  connectionTimeout: 10000,
  debug: false,
  messageQueueSize: 100,
  autoConnect: true,
  useBinary: false,
  heartbeatAdaptive: {
    enabled: false,
    minInterval: 10000,
    maxInterval: 60000,
    increaseFactor: 1.2,
    decreaseFactor: 0.8,
    lowLatencyThreshold: 50,
    highLatencyThreshold: 200
  },
  messageBatch: {
    enabled: false,
    maxBatchSize: 50,
    flushInterval: 40,
    eventName: "batch_messages"
  }
};

export interface MessageBuilderOptions<TPayload = unknown> {
  type: MessageType;
  priority?: MessagePriority;
  target?: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
