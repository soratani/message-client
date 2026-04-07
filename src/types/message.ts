export enum MessageType {
  TEXT = "text",
  JSON = "json",
  SYSTEM = "system",
  COMMAND = "command",
  HEARTBEAT = "heartbeat",
  ACKNOWLEDGE = "ack",
  ERROR = "error",
  PROGRESS = "progress",
  PING = "ping",
  PONG = "pong"
}

export enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
}

export enum CommandAction {
  EXECUTE = "execute",
  CANCEL = "cancel",
  PAUSE = "pause",
  RESUME = "resume",
  QUERY = "query",
  SYNC = "sync"
}

export interface Message<TPayload = unknown> {
  id: string;
  type: MessageType;
  priority: MessagePriority;
  timestamp: number;
  source: string;
  target?: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export interface CommandPayload {
  commandId: string;
  action: CommandAction;
  taskId?: string;
  params?: Record<string, unknown>;
  timeout?: number;
  requireAck?: boolean;
}

export interface CommandMessage extends Message<CommandPayload> {
  type: MessageType.COMMAND;
}

export interface ProgressPayload {
  taskId: string;
  progress: number;
  description?: string;
  estimatedTimeRemaining?: number;
}

export interface ProgressMessage extends Message<ProgressPayload> {
  type: MessageType.PROGRESS;
}

export type SystemEventType = "connect" | "disconnect" | "reconnect" | "error" | "maintenance";

export interface SystemPayload {
  event: SystemEventType;
  detail?: unknown;
  recommendedAction?: string;
}

export interface SystemMessage extends Message<SystemPayload> {
  type: MessageType.SYSTEM;
}

export interface AcknowledgePayload {
  messageId?: string;
  commandId?: string;
  success: boolean;
  detail?: string;
}

export interface AcknowledgeMessage extends Message<AcknowledgePayload> {
  type: MessageType.ACKNOWLEDGE;
}
