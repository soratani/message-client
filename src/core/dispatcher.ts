import { EventHandlerMap, MessageHandler } from "../types/events";
import { Message, MessageType } from "../types/message";

/**
 * 单个订阅者定义。
 */
interface Subscriber {
    // 订阅唯一标识，用于取消订阅。
    id: string;
    // 该订阅者关注的消息类型集合。
    messageTypes: MessageType[];
    // 实际处理函数。
    handler: MessageHandler;
    // 优先级越高越先执行。
    priority: number;
    // 是否为一次性订阅（命中后自动移除）。
    once?: boolean;
}

/**
 * 事件分发器。
 *
 * 核心职责：
 * 1) 管理订阅与取消订阅。
 * 2) 按优先级分发消息给订阅者。
 * 3) 维护默认处理器与消息历史。
 * 4) 统计分发、处理与错误次数。
 */
export class EventDispatcher {
    // 所有订阅者，键为订阅 id。
    private subscribers = new Map<string, Subscriber>();
    // 按消息类型设置的默认处理器（兜底逻辑）。
    private defaultHandlers: EventHandlerMap = {};
    // 最近消息历史，用于调试与回放观察。
    private messageHistory: Message[] = [];
    // 历史消息上限，超出后从最旧项开始淘汰。
    private maxHistorySize = 50;
    // 分发统计。
    private stats = {
        totalDispatched: 0,
        totalHandled: 0,
        totalErrors: 0
    };

    /**
     * 注册订阅。
     *
     * 说明：
     * - 可指定订阅 id，不传则自动生成。
     * - 支持优先级，数值越大越先执行。
     * - once=true 时命中一次后自动移除。
     */
    public subscribe(
        messageTypes: MessageType[],
        handler: MessageHandler,
        options: {
            id?: string;
            priority?: number;
            once?: boolean;
        } = {}
    ): string {
        const id = options.id ?? this.generateId();

        this.subscribers.set(id, {
            id,
            messageTypes,
            handler,
            priority: options.priority ?? 0,
            once: options.once
        });

        return id;
    }

    /**
     * 根据订阅 id 取消订阅。
     */
    public unsubscribe(subscriptionId: string): boolean {
        return this.subscribers.delete(subscriptionId);
    }

    /**
     * 注册一次性订阅。
     */
    public subscribeOnce(messageType: MessageType, handler: MessageHandler): string {
        return this.subscribe([messageType], handler, { once: true });
    }

    /**
     * 设置默认处理器。
     *
     * 使用浅合并策略：新传入类型会覆盖同名旧处理器，其他类型保持不变。
     */
    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.defaultHandlers = { ...this.defaultHandlers, ...handlers };
    }

    /**
     * 分发单条消息。
     *
     * 流程：
     * 1) 更新分发统计并写入历史。
     * 2) 找到匹配该消息类型的订阅者，并按优先级降序执行。
     * 3) 若订阅者为 once，则执行后移除。
     * 4) 最后执行该类型的默认处理器（若存在）。
     *
     * 异常策略：
     * - 单个处理器异常不会中断整体分发流程。
     * - 异常仅计入 totalErrors。
     */
    public async dispatch(message: Message): Promise<void> {
        this.stats.totalDispatched += 1;
        this.addToHistory(message);

        const subscribers = this.getSortedSubscribers(message.type);

        for (const subscriber of subscribers) {
            try {
                await subscriber.handler(message);
                this.stats.totalHandled += 1;

                if (subscriber.once) {
                    this.subscribers.delete(subscriber.id);
                }
            } catch (_error) {
                this.stats.totalErrors += 1;
            }
        }

        const defaultHandler = this.defaultHandlers[message.type];
        if (defaultHandler) {
            try {
                await defaultHandler(message);
            } catch (_error) {
                this.stats.totalErrors += 1;
            }
        }
    }

    /**
     * 获取消息历史。
     *
     * - 传入 type 时返回该类型历史。
     * - 不传时返回全部历史的浅拷贝。
     */
    public getHistory(type?: MessageType): Message[] {
        if (type) {
            return this.messageHistory.filter((item) => item.type === type);
        }

        return [...this.messageHistory];
    }

    /**
     * 获取分发器统计信息。
     */
    public getStats(): {
        totalDispatched: number;
        totalHandled: number;
        totalErrors: number;
        subscriberCount: number;
        historySize: number;
    } {
        return {
            ...this.stats,
            subscriberCount: this.subscribers.size,
            historySize: this.messageHistory.length
        };
    }

    /**
     * 清空订阅与历史。
     *
     * 注意：统计信息不会被重置。
     */
    public clear(): void {
        this.subscribers.clear();
        this.messageHistory = [];
    }

    /**
     * 获取当前订阅数。
     */
    public getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * 设置历史消息上限，并在必要时立即裁剪已有历史。
     */
    public setHistoryLimit(size: number): void {
        this.maxHistorySize = Math.max(1, size);
        while (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    /**
     * 获取匹配消息类型的订阅者列表，并按优先级从高到低排序。
     */
    private getSortedSubscribers(messageType: MessageType): Subscriber[] {
        return Array.from(this.subscribers.values())
            .filter((subscriber) => subscriber.messageTypes.includes(messageType))
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * 将消息加入历史并按上限淘汰最旧记录。
     */
    private addToHistory(message: Message): void {
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    /**
     * 生成订阅 id。
     */
    private generateId(): string {
        return "sub_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    }
}
