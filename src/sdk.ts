import { WebSocketConnectionManager } from "./core/connection";
import { EventDispatcher } from "./core/dispatcher";
import { MessageCallback, MessageQueueManager, QueueItem } from "./core/queue";
import { ConnectionState, DEFAULT_CONFIG, MessageBuilderOptions, WebSocketSDKConfig } from "./types/config";
import { EventHandlerMap, MessageHandler } from "./types/events";
import {
    AcknowledgeMessage,
    CommandAction,
    CommandPayload,
    CommandMessage,
    Message,
    MessagePriority,
    MessageType,
    SystemMessage
} from "./types/message";

type ResolvedConfig = typeof DEFAULT_CONFIG & WebSocketSDKConfig;

export class NotificationSDK {
    private readonly connectionManager: WebSocketConnectionManager;
    private readonly messageQueue: MessageQueueManager;
    private readonly eventDispatcher: EventDispatcher;
    private readonly config: ResolvedConfig;
    private readonly messageIdGenerator: Iterator<string>;
    private disposed = false;
    private processingQueue = false;

    public constructor(config: WebSocketSDKConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.connectionManager = new WebSocketConnectionManager(this.config);
        this.messageQueue = new MessageQueueManager(this.config.messageQueueSize);
        this.eventDispatcher = new EventDispatcher();
        this.messageIdGenerator = this.createMessageIdGenerator();

        this.setupInternalHandlers();

        if (this.config.autoConnect) {
            void this.connect();
        }
    }

    public async connect(): Promise<void> {
        this.assertNotDisposed();
        await this.connectionManager.connect();
    }

    public disconnect(reason?: string): void {
        this.connectionManager.disconnect(reason);
    }

    public isConnected(): boolean {
        return this.connectionManager.isConnected();
    }

    public getConnectionState(): ConnectionState {
        return this.connectionManager.getState();
    }

    public subscribe(
        messageTypes: MessageType[],
        handler: MessageHandler,
        options?: {
            id?: string;
            priority?: number;
            once?: boolean;
        }
    ): string {
        return this.eventDispatcher.subscribe(messageTypes, handler, options);
    }

    public unsubscribe(subscriptionId: string): boolean {
        return this.eventDispatcher.unsubscribe(subscriptionId);
    }

    public subscribeOnce(messageType: MessageType, handler: MessageHandler): string {
        return this.eventDispatcher.subscribeOnce(messageType, handler);
    }

    public onConnectionChange(
        callback: (state: ConnectionState, prevState: ConnectionState) => void
    ): () => void {
        this.connectionManager.addStateListener(callback);
        return () => this.connectionManager.removeStateListener(callback);
    }

    public onError(callback: (error: Error) => void): () => void {
        this.connectionManager.addErrorListener(callback);
        return () => this.connectionManager.removeErrorListener(callback);
    }

    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.eventDispatcher.setDefaultHandlers(handlers);
    }

    public getMessageHistory(type?: MessageType): Message[] {
        return this.eventDispatcher.getHistory(type);
    }

    public getStats(): {
        connection: {
            state: ConnectionState;
            isConnected: boolean;
        };
        queue: ReturnType<MessageQueueManager["getStats"]>;
        dispatcher: ReturnType<EventDispatcher["getStats"]>;
    } {
        return {
            connection: {
                state: this.getConnectionState(),
                isConnected: this.isConnected()
            },
            queue: this.messageQueue.getStats(),
            dispatcher: this.eventDispatcher.getStats()
        };
    }

    public setAuthToken(token: string): void {
        this.config.authToken = token;
    }

    public async reconnect(): Promise<void> {
        this.assertNotDisposed();
        await this.connectionManager.reconnect();
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.disconnect("SDK disposed");
        this.messageQueue.clear();
        this.eventDispatcher.clear();
    }

    public async send(message: Message, callback?: MessageCallback): Promise<void> {
        this.assertNotDisposed();

        if (!this.isConnected()) {
            const queued = this.messageQueue.enqueue(message, { callback });
            if (!queued) {
                throw new Error("Message queue is full");
            }
            return;
        }

        const sent = this.connectionManager.send(message);
        if (!sent) {
            const queued = this.messageQueue.enqueue(message, { callback });
            if (!queued) {
                throw new Error("Message send failed and queue is full");
            }
            return;
        }

        if (this.requiresAck(message)) {
            this.messageQueue.markAsPendingByItem({
                message,
                callback,
                enqueuedAt: Date.now(),
                availableAt: Date.now(),
                priority: message.priority,
                retryCount: 0
            });
        } else {
            callback?.onSuccess?.(message);
        }
    }

    public async sendText(
        content: string,
        options?: {
            target?: string;
            metadata?: Record<string, unknown>;
            priority?: MessagePriority;
        }
    ): Promise<void> {
        await this.send(
            this.createMessage({
                type: MessageType.TEXT,
                payload: { content },
                target: options?.target,
                metadata: options?.metadata,
                priority: options?.priority
            })
        );
    }

    public async sendJSON(
        data: unknown,
        options?: {
            target?: string;
            metadata?: Record<string, unknown>;
            priority?: MessagePriority;
        }
    ): Promise<void> {
        await this.send(
            this.createMessage({
                type: MessageType.JSON,
                payload: data,
                target: options?.target,
                metadata: options?.metadata,
                priority: options?.priority
            })
        );
    }

    public async sendCommand(
        action: CommandAction,
        params?: Record<string, unknown>,
        options?: {
            taskId?: string;
            timeout?: number;
            requireAck?: boolean;
            priority?: MessagePriority;
            target?: string;
            metadata?: Record<string, unknown>;
        }
    ): Promise<string> {
        const commandId = this.generateMessageId();
        const commandPayload: CommandPayload = {
            commandId,
            action,
            taskId: options?.taskId,
            params,
            timeout: options?.timeout,
            requireAck: options?.requireAck ?? true
        };

        const command: CommandMessage = {
            ...this.createMessage({
                type: MessageType.COMMAND,
                priority: options?.priority ?? MessagePriority.HIGH,
                target: options?.target,
                metadata: options?.metadata,
                payload: commandPayload
            }),
            type: MessageType.COMMAND
        };

        await this.send(command);
        return commandId;
    }

    public async queryProgress(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.QUERY, { taskId }, { priority: MessagePriority.LOW });
    }

    public async cancelTask(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.CANCEL, { taskId });
    }

    public createMessage<TPayload>(options: MessageBuilderOptions<TPayload>): Message<TPayload> {
        return {
            id: this.generateMessageId(),
            type: options.type,
            priority: options.priority ?? MessagePriority.NORMAL,
            timestamp: Date.now(),
            source: this.config.clientId,
            target: options.target,
            payload: options.payload,
            metadata: options.metadata
        };
    }

    private setupInternalHandlers(): void {
        this.connectionManager.addMessageListener(async (message: Message) => {
            if (message.type === MessageType.ACKNOWLEDGE) {
                this.handleAcknowledge(message as AcknowledgeMessage);
                return;
            }

            await this.eventDispatcher.dispatch(message);
        });

        this.connectionManager.addStateListener((state, prevState) => {
            this.debug("State changed: " + prevState + " -> " + state);

            if (state === ConnectionState.CONNECTED) {
                const connectMessage: SystemMessage = {
                    ...this.createMessage({
                        type: MessageType.SYSTEM,
                        payload: { event: "connect" },
                        priority: MessagePriority.HIGH
                    }),
                    type: MessageType.SYSTEM,
                    payload: { event: "connect" }
                };

                void this.eventDispatcher.dispatch(connectMessage);
                void this.processQueue();
            }

            if (state === ConnectionState.RECONNECTING) {
                const reconnectMessage: SystemMessage = {
                    ...this.createMessage({
                        type: MessageType.SYSTEM,
                        payload: { event: "reconnect" },
                        priority: MessagePriority.HIGH
                    }),
                    type: MessageType.SYSTEM,
                    payload: { event: "reconnect" }
                };

                void this.eventDispatcher.dispatch(reconnectMessage);
            }

            if (state === ConnectionState.DISCONNECTED && prevState === ConnectionState.CONNECTED) {
                const disconnectMessage: SystemMessage = {
                    ...this.createMessage({
                        type: MessageType.SYSTEM,
                        payload: { event: "disconnect" },
                        priority: MessagePriority.HIGH
                    }),
                    type: MessageType.SYSTEM,
                    payload: { event: "disconnect" }
                };

                void this.eventDispatcher.dispatch(disconnectMessage);
            }
        });

        this.connectionManager.addErrorListener((error: Error) => {
            const errorMessage: SystemMessage = {
                ...this.createMessage({
                    type: MessageType.SYSTEM,
                    payload: {
                        event: "error",
                        detail: error.message
                    },
                    priority: MessagePriority.CRITICAL
                }),
                type: MessageType.SYSTEM,
                payload: {
                    event: "error",
                    detail: error.message
                }
            };

            void this.eventDispatcher.dispatch(errorMessage);
        });
    }

    private handleAcknowledge(message: AcknowledgeMessage): void {
        const id = message.payload.messageId;
        if (!id) {
            return;
        }

        if (message.payload.success) {
            this.messageQueue.acknowledge(id);
            void this.processQueue();
            return;
        }

        this.messageQueue.retry(id);
        void this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.processingQueue || !this.isConnected()) {
            return;
        }

        this.processingQueue = true;

        try {
            while (this.isConnected() && this.messageQueue.hasQueuedMessages()) {
                const item = this.messageQueue.dequeue();
                if (!item) {
                    break;
                }

                const sent = this.connectionManager.send(item.message);
                if (!sent) {
                    this.requeue(item);
                    break;
                }

                if (this.requiresAck(item.message)) {
                    this.messageQueue.markAsPendingByItem(item);
                    continue;
                }

                item.callback?.onSuccess?.(item.message);
            }
        } finally {
            this.processingQueue = false;
        }
    }

    private requeue(item: QueueItem): void {
        const queued = this.messageQueue.enqueue(item.message, {
            callback: item.callback,
            priority: item.priority,
            retryCount: item.retryCount,
            availableAt: Date.now() + this.messageQueue.getRetryDelay(item.retryCount)
        });

        if (!queued) {
            item.callback?.onError?.(new Error("Message queue is full while requeueing"), item.message);
        }
    }

    private requiresAck(message: Message): boolean {
        if (message.type !== MessageType.COMMAND) {
            return false;
        }

        const command = message as CommandMessage;
        return command.payload.requireAck !== false;
    }

    private createMessageIdGenerator(): Iterator<string> {
        let counter = 0;

        return {
            next: (): IteratorResult<string> => {
                counter += 1;
                return {
                    value:
                        Date.now().toString(36) +
                        "_" +
                        Math.random().toString(36).slice(2, 8) +
                        "_" +
                        counter.toString(36),
                    done: false
                };
            }
        };
    }

    private generateMessageId(): string {
        return this.messageIdGenerator.next().value as string;
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error("SDK is already disposed");
        }
    }

    private debug(message: string): void {
        if (this.config.debug) {
            console.log("[NotificationSDK] " + message);
        }
    }
}

export function createWebSocketSDK(config: WebSocketSDKConfig): NotificationSDK {
    return new NotificationSDK(config);
}
