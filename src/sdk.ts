import { ConnectionManager } from "./core/connection";
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

/**
 * WebSocket 通知 SDK 的门面类。
 *
 * 主要职责：
 * 1) 通过 ConnectionManager 管理连接生命周期。
 * 2) 在连接不可用时缓存待发送消息。
 * 3) 将接收消息分发到用户订阅的处理器。
 * 4) 跟踪需要 ACK 的消息并驱动重试与队列推进。
 */
export class NotificationSDK {
    private readonly connectionManager: ConnectionManager;
    private readonly messageQueue: MessageQueueManager;
    private readonly eventDispatcher: EventDispatcher;
    private readonly config: ResolvedConfig;
    private readonly messageIdGenerator: Iterator<string>;
    private readonly pendingAckDeadlines: Map<string, number> = new Map();
    private readonly commandAckIndex: Map<string, string> = new Map();
    private pendingSweepTimer: ReturnType<typeof setInterval> | null = null;
    // 标记 SDK 是否已释放，防止释放后继续调用。
    private disposed = false;
    // 防止并发执行队列消费循环。
    private processingQueue = false;

    /**
     * 初始化 SDK 内部组件，并在开启 autoConnect 时自动发起首次连接。
     */
    public constructor(config: WebSocketSDKConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.connectionManager = new ConnectionManager(this.config);
        this.messageQueue = new MessageQueueManager(this.config.messageQueueSize);
        this.eventDispatcher = new EventDispatcher();
        this.messageIdGenerator = this.createMessageIdGenerator();

        this.setupInternalHandlers();
        this.startPendingSweep();

        if (this.config.autoConnect) {
            void this.connect();
        }
    }

    /**
        * 建立 WebSocket 连接。
        * 当 SDK 已被 dispose 时会抛出异常。
     */
    public async connect(): Promise<void> {
        this.assertNotDisposed();
        await this.connectionManager.connect();
    }

    /**
        * 关闭当前 WebSocket 连接。
     */
    public disconnect(reason?: string): void {
        this.connectionManager.disconnect(reason);
    }

    /**
        * 返回当前是否处于已连接状态。
     */
    public isConnected(): boolean {
        return this.connectionManager.isConnected();
    }

    /**
        * 返回当前连接状态枚举值。
     */
    public getConnectionState(): ConnectionState {
        return this.connectionManager.getState();
    }

    /**
        * 订阅一个或多个消息类型。
        * 返回订阅 ID，可用于后续取消订阅。
     */
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

    /**
        * 按订阅 ID 取消订阅。
     */
    public unsubscribe(subscriptionId: string): boolean {
        return this.eventDispatcher.unsubscribe(subscriptionId);
    }

    /**
        * 订阅只触发一次的处理器。
     */
    public subscribeOnce(messageType: MessageType, handler: MessageHandler): string {
        return this.eventDispatcher.subscribeOnce(messageType, handler);
    }

    /**
        * 注册连接状态监听器，并返回取消监听函数。
     */
    public onConnectionChange(
        callback: (state: ConnectionState, prevState: ConnectionState) => void
    ): () => void {
        this.connectionManager.addStateListener(callback);
        return () => this.connectionManager.removeStateListener(callback);
    }

    /**
        * 注册错误监听器，并返回取消监听函数。
     */
    public onError(callback: (error: Error) => void): () => void {
        this.connectionManager.addErrorListener(callback);
        return () => this.connectionManager.removeErrorListener(callback);
    }

    /**
        * 按消息类型注册默认处理器。
        * 当没有更高优先级的显式订阅处理该消息时，会回落到这些默认处理器。
     */
    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.eventDispatcher.setDefaultHandlers(handlers);
    }

    /**
        * 返回消息分发历史，可按消息类型过滤。
     */
    public getMessageHistory(type?: MessageType): Message[] {
        return this.eventDispatcher.getHistory(type);
    }

    /**
        * 返回运行时统计信息：连接、队列与分发器状态。
     */
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

    /**
        * 更新认证 Token。
        * 新 Token 会在后续 connect/reconnect 时生效。
     */
    public setAuthToken(token: string): void {
        this.config.authToken = token;
    }

    /**
        * 主动触发一次重连流程。
     */
    public async reconnect(): Promise<void> {
        this.assertNotDisposed();
        await this.connectionManager.reconnect();
    }

    /**
        * 释放 SDK 资源并阻止后续继续使用。
        * 可重复调用，具备幂等性。
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.disconnect("SDK disposed");
        this.stopPendingSweep();
        this.pendingAckDeadlines.clear();
        this.commandAckIndex.clear();
        this.messageQueue.clear();
        this.eventDispatcher.clear();
    }

    /**
        * 发送消息（带队列兜底策略）：
        * 1) 未连接时直接入队。
        * 2) 发送失败时重新入队。
        * 3) 对需要 ACK 的消息，发送后转入 pending 集合等待确认。
     */
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
            const pendingItem: QueueItem = {
                message,
                callback,
                enqueuedAt: Date.now(),
                availableAt: Date.now(),
                priority: message.priority,
                retryCount: 0
            };
            this.messageQueue.markAsPendingByItem(pendingItem);
            this.trackPendingAck(pendingItem);
        } else {
            callback?.onSuccess?.(message);
        }
    }

    /**
        * 发送文本消息的便捷方法。
     */
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

    /**
        * 发送任意 JSON 数据的便捷方法。
     */
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

    /**
        * 发送命令消息并返回生成的 commandId。
        * 命令消息默认需要 ACK，除非显式设置 requireAck=false。
     */
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

    /**
        * 发送低优先级命令以查询任务进度。
     */
    public async queryProgress(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.QUERY, { taskId }, { priority: MessagePriority.LOW });
    }

    /**
        * 发送任务取消命令。
     */
    public async cancelTask(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.CANCEL, { taskId });
    }

    /**
        * 使用 SDK 统一默认值创建消息对象。
     */
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

    /**
        * 绑定底层传输事件与上层 SDK 行为之间的内部桥接逻辑。
        *
        * 消息路径：
        * - ACKNOWLEDGE -> 推进队列状态流转。
        * - 其他消息 -> 交给分发器。
        *
        * 状态路径：
        * - CONNECTED -> 发送系统事件并尝试清空待发送队列。
        * - RECONNECTING / DISCONNECTED -> 发送对应系统事件。
     */
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
                this.recoverPendingMessages();
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

    /**
        * 根据 ACK 结果更新队列账本，并继续推进队列消费。
     */
    private handleAcknowledge(message: AcknowledgeMessage): void {
        const id = this.resolveAcknowledgeMessageId(message.payload);
        if (!id) {
            return;
        }

        this.clearPendingTracking(id);

        if (message.payload.success) {
            this.messageQueue.acknowledge(id);
            void this.processQueue();
            return;
        }

        this.messageQueue.retry(id);
        void this.processQueue();
    }

    /**
        * 在连接可用期间按顺序消费队列中的消息。
     *
        * 说明：
        * - 使用 processingQueue 保护，避免重入执行。
        * - 发送失败时会提前结束本轮，并将当前消息重新入队。
        * - 需要 ACK 的消息发送后进入 pending 跟踪，而非直接判定成功。
     */
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
                    this.trackPendingAck(item);
                    continue;
                }

                item.callback?.onSuccess?.(item.message);
            }
        } finally {
            this.processingQueue = false;
        }
    }

    /**
        * 将未发送成功的消息重新入队，并应用指数退避延迟。
     */
    private requeue(item: QueueItem): void {
        const nextRetryCount = item.retryCount + 1;
        const queued = this.messageQueue.enqueue(item.message, {
            callback: item.callback,
            priority: item.priority,
            retryCount: nextRetryCount,
            availableAt: Date.now() + this.messageQueue.getRetryDelay(Math.max(0, nextRetryCount - 1))
        });

        if (!queued) {
            item.callback?.onError?.(new Error("Message queue is full while requeueing"), item.message);
        }
    }

    /**
        * 判断消息是否需要 ACK 跟踪。
        * 当前仅命令消息走 ACK 机制。
     */
    private requiresAck(message: Message): boolean {
        if (message.type !== MessageType.COMMAND) {
            return false;
        }

        const command = message as CommandMessage;
        return command.payload.requireAck !== false;
    }

    private resolveAcknowledgeMessageId(payload: AcknowledgeMessage["payload"]): string | null {
        if (payload.messageId) {
            return payload.messageId;
        }

        if (payload.commandId) {
            const indexed = this.commandAckIndex.get(payload.commandId);
            if (indexed) {
                return indexed;
            }

            const pendingItem = this.messageQueue.getPendingItems().find((item) => {
                if (item.message.type !== MessageType.COMMAND) {
                    return false;
                }

                const commandPayload = (item.message as CommandMessage).payload;
                return commandPayload.commandId === payload.commandId;
            });

            if (pendingItem) {
                return pendingItem.message.id;
            }
        }

        return null;
    }

    private trackPendingAck(item: QueueItem): void {
        const timeoutAt = Date.now() + this.getAckTimeout(item.message);
        this.pendingAckDeadlines.set(item.message.id, timeoutAt);

        if (item.message.type !== MessageType.COMMAND) {
            return;
        }

        const commandPayload = (item.message as CommandMessage).payload;
        if (commandPayload.commandId) {
            this.commandAckIndex.set(commandPayload.commandId, item.message.id);
        }
    }

    private clearPendingTracking(messageId: string): void {
        this.pendingAckDeadlines.delete(messageId);

        for (const [commandId, trackedMessageId] of this.commandAckIndex.entries()) {
            if (trackedMessageId === messageId) {
                this.commandAckIndex.delete(commandId);
            }
        }
    }

    private getAckTimeout(message: Message): number {
        if (message.type === MessageType.COMMAND) {
            const commandPayload = (message as CommandMessage).payload;
            if (typeof commandPayload.timeout === "number" && commandPayload.timeout > 0) {
                return commandPayload.timeout;
            }
        }

        return this.config.ackTimeout || 0.5 * 60 * 1000;
    }

    private startPendingSweep(): void {
        if (this.pendingSweepTimer) {
            return;
        }

        this.pendingSweepTimer = setInterval(() => {
            this.sweepPendingTimeouts();
        }, this.config.pendingSweepInterval);
    }

    private stopPendingSweep(): void {
        if (!this.pendingSweepTimer) {
            return;
        }

        clearInterval(this.pendingSweepTimer);
        this.pendingSweepTimer = null;
    }

    private sweepPendingTimeouts(): void {
        if (!this.messageQueue.hasPendingMessages() || this.pendingAckDeadlines.size === 0) {
            return;
        }

        const now = Date.now();
        const expiredMessageIds: string[] = [];

        for (const [messageId, timeoutAt] of this.pendingAckDeadlines.entries()) {
            if (timeoutAt <= now) {
                expiredMessageIds.push(messageId);
            }
        }

        if (expiredMessageIds.length === 0) {
            return;
        }

        let queueChanged = false;
        for (const messageId of expiredMessageIds) {
            const item = this.messageQueue.getPendingItems().find((pending) => pending.message.id === messageId);
            this.clearPendingTracking(messageId);

            if (!item) {
                continue;
            }

            item.callback?.onTimeout?.(item.message);
            const retried = this.messageQueue.retry(messageId);
            queueChanged = queueChanged || retried;
        }

        if (queueChanged && this.isConnected()) {
            void this.processQueue();
        }
    }

    private recoverPendingMessages(): void {
        const pendingItems = this.messageQueue.getPendingItems();
        if (pendingItems.length === 0) {
            return;
        }

        for (const item of pendingItems) {
            this.clearPendingTracking(item.message.id);
            this.messageQueue.retry(item.message.id);
        }
    }

    /**
        * 创建轻量级递增消息 ID 生成器。
        * 由时间戳 + 随机段 + 实例内计数组成。
     */
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

    /**
        * 返回下一个生成的消息 ID。
     */
    private generateMessageId(): string {
        return this.messageIdGenerator.next().value as string;
    }

    /**
        * 保护必须在 dispose 前调用的方法。
     */
    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error("SDK is already disposed");
        }
    }

    /**
        * 仅在 debug 模式启用时输出调试日志。
     */
    private debug(message: string): void {
        if (this.config.debug) {
            console.log("[NotificationSDK] " + message);
        }
    }
}

/**
 * 创建 SDK 实例的便捷工厂函数。
 */
export function createWebSocketSDK(config: WebSocketSDKConfig): NotificationSDK {
    return new NotificationSDK(config);
}
