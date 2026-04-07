import { decode, encode } from "@msgpack/msgpack";
import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import { MessageHandler } from "../types/events";
import { ConnectionState, DEFAULT_CONFIG, WebSocketSDKConfig } from "../types/config";
import { Message, MessagePriority, MessageType } from "../types/message";

type StateListener = (state: ConnectionState, prevState: ConnectionState) => void;
type ErrorListener = (error: Error) => void;

type ResolvedConfig = typeof DEFAULT_CONFIG & WebSocketSDKConfig;

export class WebSocketConnectionManager {
  private socket: Socket | null = null;
  private readonly config: ResolvedConfig;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private stateListeners: StateListener[] = [];
  private messageListeners: MessageHandler[] = [];
  private errorListeners: ErrorListener[] = [];
  private lastPongTime = 0;
  private lastPingSentAt = 0;
  private heartbeatIntervalMs = DEFAULT_CONFIG.heartbeatInterval ?? 30000;
  private heartbeatFailureStreak = 0;
  private outboundBatch: Message[] = [];
  private outboundBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;
  private connectPromise: Promise<void> | null = null;

  public constructor(config: WebSocketSDKConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.heartbeatIntervalMs = this.getBaseHeartbeatInterval();
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED && this.socket !== null && this.socket.connected;
  }

  public addStateListener(listener: StateListener): void {
    this.stateListeners.push(listener);
  }

  public removeStateListener(listener: StateListener): void {
    this.stateListeners = this.stateListeners.filter((item) => item !== listener);
  }

  public addMessageListener(listener: MessageHandler): void {
    this.messageListeners.push(listener);
  }

  public removeMessageListener(listener: MessageHandler): void {
    this.messageListeners = this.messageListeners.filter((item) => item !== listener);
  }

  public addErrorListener(listener: ErrorListener): void {
    this.errorListeners.push(listener);
  }

  public removeErrorListener(listener: ErrorListener): void {
    this.errorListeners = this.errorListeners.filter((item) => item !== listener);
  }

  public connect(): Promise<void> {
    if (this.isConnected()) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();

    this.connectPromise = new Promise((resolve, reject) => {
      this.setState(
        this.reconnectAttempt > 0 ? ConnectionState.RECONNECTING : ConnectionState.CONNECTING
      );

      let settled = false;

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.connectPromise = null;
        resolve();
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.connectPromise = null;
        reject(error);
      };

      let wsUrl: string;
      try {
        wsUrl = this.buildConnectionUrl();
      } catch (error) {
        const buildError = error instanceof Error ? error : new Error("Invalid endpoint URL");
        this.setState(ConnectionState.ERROR);
        this.notifyError(buildError);
        settleReject(buildError);
        return;
      }

      this.debug("Connecting: " + wsUrl);

      try {
        this.socket = this.createSocketConnection(wsUrl);

        const timeout = setTimeout(() => {
          if (
            (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.RECONNECTING) &&
            !this.isConnected()
          ) {
            this.debug("Connection timeout");
            this.socket?.disconnect();
            this.socket = null;
            const timeoutError = new Error("Connection timeout");
            this.setState(ConnectionState.ERROR);
            this.notifyError(timeoutError);
            settleReject(timeoutError);
          }
        }, this.config.connectionTimeout);

        this.socket.on("connect", () => {
          clearTimeout(timeout);
          this.debug("Connected");
          this.reconnectAttempt = 0;
          this.lastPongTime = Date.now();
          this.lastPingSentAt = 0;
          this.heartbeatFailureStreak = 0;
          this.heartbeatIntervalMs = this.getBaseHeartbeatInterval();
          this.setState(ConnectionState.CONNECTED);
          this.startHeartbeat();
          settleResolve();
        });

        this.socket.on("message", (data: unknown) => {
          void this.handleIncomingData(data);
        });

        const batchEventName = this.getBatchEventName();
        if (batchEventName !== "message") {
          this.socket.on(batchEventName, (data: unknown) => {
            void this.handleIncomingData(data);
          });
        }

        this.socket.on("connect_error", (error: unknown) => {
          clearTimeout(timeout);
          const connectError =
            error instanceof Error ? error : new Error("Socket.IO connection error");
          this.notifyError(connectError);
          this.debug(connectError.message);

          if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.RECONNECTING) {
            this.setState(ConnectionState.ERROR);
            settleReject(connectError);
          }
        });

        this.socket.on("disconnect", (reason: string) => {
          clearTimeout(timeout);
          this.stopHeartbeat();
          this.clearOutboundBatch();

          this.debug("Closed: " + reason);
          this.socket = null;

          if (!settled && (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.RECONNECTING)) {
            const disconnectError = new Error("Disconnected before connection established: " + reason);
            this.setState(ConnectionState.ERROR);
            this.notifyError(disconnectError);
            settleReject(disconnectError);
          }

          if (this.manualDisconnect) {
            this.setState(ConnectionState.DISCONNECTED);
            return;
          }

          if (this.state !== ConnectionState.DISCONNECTED) {
            this.handleDisconnect(reason || "Connection closed");
          }
        });
      } catch (error) {
        const connectError = error instanceof Error ? error : new Error("Failed to connect");
        this.debug("Connect failed: " + connectError.message);
        this.setState(ConnectionState.ERROR);
        this.notifyError(connectError);
        settleReject(connectError);
      }
    });

    return this.connectPromise;
  }

  public disconnect(reason = "Manual disconnect"): void {
    this.debug("Disconnect: " + reason);
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.clearOutboundBatch();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectPromise = null;
    this.setState(ConnectionState.DISCONNECTED);
  }

  public async reconnect(): Promise<void> {
    this.manualDisconnect = false;
    this.disconnect("Force reconnect");
    this.manualDisconnect = false;
    await this.connect();
  }

  public send(message: Message): boolean {
    if (!this.socket || !this.socket.connected) {
      this.debug("Send ignored: socket not open");
      return false;
    }

    if (this.shouldBatchMessage(message)) {
      return this.enqueueBatchedMessage(message);
    }

    return this.emitMessage(message);
  }

  private emitMessage(message: Message): boolean {
    if (!this.socket || !this.socket.connected) {
      this.debug("Send ignored: socket not open");
      return false;
    }

    try {
      console.log("Raw incoming data:1", message);
      const payload = this.serializeToBinary(message);
      this.socket.emit("message", payload);
      this.debug("Sent message: " + message.id + " type=" + message.type);
      return true;
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("Failed to send message");
      this.notifyError(sendError);
      this.debug(sendError.message);
      return false;
    }
  }

  private shouldBatchMessage(message: Message): boolean {
    const batchConfig = this.config.messageBatch;
    if (!batchConfig?.enabled) {
      return false;
    }

    if (
      message.type === MessageType.PING ||
      message.type === MessageType.PONG ||
      message.type === MessageType.COMMAND ||
      message.type === MessageType.ACKNOWLEDGE
    ) {
      return false;
    }

    return message.priority < MessagePriority.HIGH;
  }

  private enqueueBatchedMessage(message: Message): boolean {
    this.outboundBatch.push(message);

    const maxBatchSize = this.config.messageBatch?.maxBatchSize ??
      DEFAULT_CONFIG.messageBatch?.maxBatchSize ??
      50;

    if (this.outboundBatch.length >= maxBatchSize) {
      return this.flushOutboundBatch();
    }

    this.scheduleBatchFlush();
    this.debug("Queued for batch send: " + message.id + " size=" + this.outboundBatch.length);
    return true;
  }

  private scheduleBatchFlush(): void {
    if (this.outboundBatchTimer) {
      return;
    }

    const flushInterval = this.config.messageBatch?.flushInterval ??
      DEFAULT_CONFIG.messageBatch?.flushInterval ??
      40;

    this.outboundBatchTimer = setTimeout(() => {
      this.flushOutboundBatch();
    }, flushInterval);
  }

  private flushOutboundBatch(): boolean {
    this.clearOutboundBatchTimer();

    if (this.outboundBatch.length === 0) {
      return true;
    }

    if (!this.socket || !this.socket.connected) {
      this.debug("Batch flush skipped: socket not open");
      return false;
    }

    const messages = this.outboundBatch.splice(0, this.outboundBatch.length);
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      const sent = this.emitMessage(message);
      if (!sent) {
        this.outboundBatch.unshift(...messages.slice(i));
        return false;
      }
    }

    this.debug("Flushed batched messages: " + messages.length);
    return true;
  }

  private clearOutboundBatch(): void {
    this.outboundBatch = [];
    this.clearOutboundBatchTimer();
  }

  private clearOutboundBatchTimer(): void {
    if (this.outboundBatchTimer) {
      clearTimeout(this.outboundBatchTimer);
      this.outboundBatchTimer = null;
    }
  }

  private buildConnectionUrl(): string {
    const url = new URL(this.config.endpoint);
    url.searchParams.set("clientId", this.config.clientId);

    if (this.config.authToken) {
      url.searchParams.set("token", this.config.authToken);
    }

    const protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    url.protocol = protocol;
    return url.toString();
  }

  private createSocketConnection(url: string): Socket {
    const options: Partial<ManagerOptions & SocketOptions> = {
      autoConnect: false,
      reconnection: false,
      extraHeaders: this.config.headers,
      ...this.config.socketIOOptions
    };

    options.autoConnect = false;
    options.reconnection = false;

    const socket = io(url, options);
    socket.connect();
    return socket;
  }

  private async handleIncomingData(data: unknown): Promise<void> {
    try {
      console.log("Raw incoming data:2", data);
      const messages = await this.parseMessages(data);
      for (const message of messages) {
        this.debug("Received message: " + message.id + " type=" + message.type);

        if (message.type === MessageType.PONG) {
          this.onPongMessage(message);
          continue;
        }

        if (message.type === MessageType.PING) {
          this.sendPong(message.payload);
          continue;
        }

        for (const listener of this.messageListeners) {
          await listener(message);
        }
      }
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error("Failed to parse incoming message");
      this.notifyError(parseError);
      this.debug(parseError.message);
    }
  }

  private async parseMessages(data: unknown): Promise<Message[]> {
    const decoded = await this.decodeIncomingData(data);
    return this.extractMessages(decoded);
  }

  private async decodeIncomingData(data: unknown): Promise<unknown> {
    if (data instanceof ArrayBuffer) {
      return decode(new Uint8Array(data));
    }

    if (ArrayBuffer.isView(data)) {
      return decode(new Uint8Array(this.copyArrayBufferView(data)));
    }

    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      return decode(new Uint8Array(buffer));
    }

    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        throw new Error("Invalid JSON message payload");
      }
    }

    return data;
  }

  private extractMessages(data: unknown): Message[] {
    if (this.isMessage(data)) {
      return [data];
    }

    if (Array.isArray(data)) {
      const messages: Message[] = [];
      for (const item of data) {
        messages.push(...this.extractMessages(item));
      }
      return messages;
    }

    if (data && typeof data === "object" && "messages" in data) {
      const batch = data as { messages?: unknown };
      if (!Array.isArray(batch.messages)) {
        throw new Error("Batch payload must contain a messages array");
      }
      return this.extractMessages(batch.messages);
    }

    throw new Error("Unsupported message data type");
  }

  private handleDisconnect(reason: string): void {
    this.debug("Handle disconnect: " + reason);

    const maxAttempts = this.config.maxReconnectAttempts ?? DEFAULT_CONFIG.maxReconnectAttempts ?? 10;

    if (this.reconnectAttempt >= maxAttempts) {
      this.debug("Max reconnect attempts reached");
      this.setState(ConnectionState.DISCONNECTED);
      return;
    }

    this.setState(ConnectionState.RECONNECTING);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = this.calculateReconnectDelay(this.reconnectAttempt);
    this.debug("Reconnect attempt " + this.reconnectAttempt + " in " + delay + "ms");

    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((error: unknown) => {
        const reconnectError =
          error instanceof Error ? error : new Error("Reconnect attempt failed");
        this.notifyError(reconnectError);
        this.handleDisconnect(reconnectError.message);
      });
    }, delay);
  }

  private calculateReconnectDelay(attempt: number): number {
    const base = this.config.reconnectBaseDelay ?? DEFAULT_CONFIG.reconnectBaseDelay ?? 1000;
    const max = this.config.reconnectMaxDelay ?? DEFAULT_CONFIG.reconnectMaxDelay ?? 30000;
    const exp = Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max);
    const jitter = exp * 0.1 * Math.random();
    return Math.floor(exp + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalMs = this.getBaseHeartbeatInterval();
    this.scheduleHeartbeat(this.heartbeatIntervalMs);
  }

  private scheduleHeartbeat(delayMs: number): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.heartbeatTimer = setTimeout(() => {
      this.runHeartbeatTick();
    }, Math.max(1000, delayMs));
  }

  private runHeartbeatTick(): void {
    if (!this.isConnected()) {
      return;
    }

    const now = Date.now();
    this.lastPingSentAt = now;

    const ping: Message = {
      id: this.generateMessageId(),
      type: MessageType.PING,
      priority: MessagePriority.LOW,
      timestamp: now,
      source: this.config.clientId,
      payload: { clientTime: now }
    };

    const ok = this.emitMessage(ping);
    if (!ok) {
      this.heartbeatFailureStreak += 1;
      this.adjustHeartbeatIntervalOnFailure();
      this.scheduleHeartbeat(this.heartbeatIntervalMs);
      return;
    }

    this.clearHeartbeatTimeout();
    this.heartbeatTimeoutTimer = setTimeout(() => {
      const idleFor = Date.now() - this.lastPongTime;
      const heartbeatTimeout = this.getHeartbeatTimeout();
      if (this.isConnected() && idleFor >= heartbeatTimeout) {
        this.debug("Heartbeat timeout");
        this.socket?.disconnect();
      }
    }, this.getHeartbeatTimeout());

    this.scheduleHeartbeat(this.heartbeatIntervalMs);
  }

  private onPongMessage(message: Message): void {
    const now = Date.now();
    const payload = message.payload;
    const payloadClientTime =
      payload && typeof payload === "object" && "clientTime" in payload
        ? (payload as { clientTime?: unknown }).clientTime
        : undefined;

    const sentAt =
      typeof payloadClientTime === "number" && Number.isFinite(payloadClientTime)
        ? payloadClientTime
        : this.lastPingSentAt;

    if (sentAt > 0 && now >= sentAt) {
      const latency = now - sentAt;
      this.adjustHeartbeatIntervalOnSuccess(latency);
    }

    this.heartbeatFailureStreak = 0;
    this.lastPongTime = now;
    this.clearHeartbeatTimeout();
  }

  private adjustHeartbeatIntervalOnSuccess(latency: number): void {
    const adaptiveConfig = this.config.heartbeatAdaptive;
    if (!adaptiveConfig?.enabled) {
      this.heartbeatIntervalMs = this.getBaseHeartbeatInterval();
      return;
    }

    const min = adaptiveConfig.minInterval ?? DEFAULT_CONFIG.heartbeatAdaptive?.minInterval ?? 10000;
    const max = adaptiveConfig.maxInterval ?? DEFAULT_CONFIG.heartbeatAdaptive?.maxInterval ?? 60000;
    const inc =
      adaptiveConfig.increaseFactor ?? DEFAULT_CONFIG.heartbeatAdaptive?.increaseFactor ?? 1.2;
    const dec =
      adaptiveConfig.decreaseFactor ?? DEFAULT_CONFIG.heartbeatAdaptive?.decreaseFactor ?? 0.8;
    const low =
      adaptiveConfig.lowLatencyThreshold ??
      DEFAULT_CONFIG.heartbeatAdaptive?.lowLatencyThreshold ??
      50;
    const high =
      adaptiveConfig.highLatencyThreshold ??
      DEFAULT_CONFIG.heartbeatAdaptive?.highLatencyThreshold ??
      200;

    if (latency <= low) {
      this.heartbeatIntervalMs = Math.min(max, Math.floor(this.heartbeatIntervalMs * inc));
      return;
    }

    if (latency >= high) {
      this.heartbeatIntervalMs = Math.max(min, Math.floor(this.heartbeatIntervalMs * dec));
      return;
    }

    this.heartbeatIntervalMs = Math.max(min, Math.min(max, this.heartbeatIntervalMs));
  }

  private adjustHeartbeatIntervalOnFailure(): void {
    const adaptiveConfig = this.config.heartbeatAdaptive;
    if (!adaptiveConfig?.enabled) {
      this.heartbeatIntervalMs = this.getBaseHeartbeatInterval();
      return;
    }

    const min = adaptiveConfig.minInterval ?? DEFAULT_CONFIG.heartbeatAdaptive?.minInterval ?? 10000;
    const dec =
      adaptiveConfig.decreaseFactor ?? DEFAULT_CONFIG.heartbeatAdaptive?.decreaseFactor ?? 0.8;

    const penalty = Math.max(0.5, dec - Math.min(this.heartbeatFailureStreak, 3) * 0.1);
    this.heartbeatIntervalMs = Math.max(min, Math.floor(this.heartbeatIntervalMs * penalty));
  }

  private getBaseHeartbeatInterval(): number {
    return this.config.heartbeatInterval ?? DEFAULT_CONFIG.heartbeatInterval ?? 30000;
  }

  private getHeartbeatTimeout(): number {
    return this.config.heartbeatTimeout ?? DEFAULT_CONFIG.heartbeatTimeout ?? 10000;
  }

  private getBatchEventName(): string {
    return this.config.messageBatch?.eventName ?? DEFAULT_CONFIG.messageBatch?.eventName ?? "batch_messages";
  }

  private isMessage(data: unknown): data is Message {
    if (!data || typeof data !== "object") {
      return false;
    }

    const candidate = data as Partial<Message>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.type === "string" &&
      typeof candidate.timestamp === "number"
    );
  }

  private copyArrayBufferView(view: ArrayBufferView): ArrayBuffer {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return bytes.slice().buffer;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private sendPong(pingPayload?: unknown): void {
    const payload =
      pingPayload && typeof pingPayload === "object"
        ? { ...(pingPayload as Record<string, unknown>) }
        : {};

    const pong: Message = {
      id: this.generateMessageId(),
      type: MessageType.PONG,
      priority: MessagePriority.LOW,
      timestamp: Date.now(),
      source: this.config.clientId,
      payload: {
        ...payload,
        clientTime: Date.now()
      }
    };

    this.emitMessage(pong);
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) {
      return;
    }

    const prev = this.state;
    this.state = next;

    for (const listener of this.stateListeners) {
      listener(next, prev);
    }
  }

  private notifyError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private generateMessageId(): string {
    return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  private serializeToBinary(message: Message): Uint8Array {
    return encode(message);
  }

  private debug(message: string): void {
    if (this.config.debug) {
      console.log("[WebSocketConnectionManager] " + message);
    }
  }
}
