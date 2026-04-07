import { EventHandlerMap, MessageHandler } from "../types/events";
import { Message, MessageType } from "../types/message";

interface Subscriber {
    id: string;
    messageTypes: MessageType[];
    handler: MessageHandler;
    priority: number;
    once?: boolean;
}

export class EventDispatcher {
    private subscribers = new Map<string, Subscriber>();
    private defaultHandlers: EventHandlerMap = {};
    private messageHistory: Message[] = [];
    private maxHistorySize = 50;
    private stats = {
        totalDispatched: 0,
        totalHandled: 0,
        totalErrors: 0
    };

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

    public unsubscribe(subscriptionId: string): boolean {
        return this.subscribers.delete(subscriptionId);
    }

    public subscribeOnce(messageType: MessageType, handler: MessageHandler): string {
        return this.subscribe([messageType], handler, { once: true });
    }

    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.defaultHandlers = { ...this.defaultHandlers, ...handlers };
    }

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

    public getHistory(type?: MessageType): Message[] {
        if (type) {
            return this.messageHistory.filter((item) => item.type === type);
        }

        return [...this.messageHistory];
    }

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

    public clear(): void {
        this.subscribers.clear();
        this.messageHistory = [];
    }

    public getSubscriberCount(): number {
        return this.subscribers.size;
    }

    public setHistoryLimit(size: number): void {
        this.maxHistorySize = Math.max(1, size);
        while (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    private getSortedSubscribers(messageType: MessageType): Subscriber[] {
        return Array.from(this.subscribers.values())
            .filter((subscriber) => subscriber.messageTypes.includes(messageType))
            .sort((a, b) => b.priority - a.priority);
    }

    private addToHistory(message: Message): void {
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    private generateId(): string {
        return "sub_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    }
}
