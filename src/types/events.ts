import { ConnectionState } from "./config";
import { Message, MessageType } from "./message";

export interface MessageHandler {
  (message: Message): void | Promise<void>;
}

export type EventHandlerMap = {
  [K in MessageType]?: MessageHandler;
} & {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onStateChange?: (state: ConnectionState, prevState: ConnectionState) => void;
};
