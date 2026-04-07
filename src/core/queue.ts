import { MessagePriority, Message } from "../types/message";

export interface MessageCallback {
  onSuccess?: (message: Message) => void;
  onError?: (error: Error, message: Message) => void;
  onTimeout?: (message: Message) => void;
}

export interface QueueItem {
  message: Message;
  enqueuedAt: number;
  availableAt: number;
  priority: MessagePriority;
  retryCount: number;
  callback?: MessageCallback;
}

export class MessageQueueManager {
  private queue: QueueItem[] = [];
  private readonly maxSize: number;
  private readonly retryDelays: number[] = [1000, 2000, 5000, 10000, 30000];
  private pendingMessages: Map<string, QueueItem> = new Map();
  private stats = {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalRetried: 0,
    totalEvicted: 0
  };

  public constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  public enqueue(
    message: Message,
    options: {
      priority?: MessagePriority;
      callback?: MessageCallback;
      availableAt?: number;
      retryCount?: number;
    } = {}
  ): boolean {
    if (this.queue.length >= this.maxSize && !this.evictLowestPriority()) {
      return false;
    }

    const now = Date.now();
    const item: QueueItem = {
      message,
      enqueuedAt: now,
      availableAt: options.availableAt ?? now,
      priority: options.priority ?? message.priority,
      retryCount: options.retryCount ?? 0,
      callback: options.callback
    };

    this.queue.push(item);
    this.sortByPriority();
    this.stats.totalEnqueued += 1;
    return true;
  }

  public dequeue(): QueueItem | null {
    const now = Date.now();
    let selectedIndex = -1;

    for (let i = 0; i < this.queue.length; i += 1) {
      const candidate = this.queue[i];
      if (candidate.availableAt > now) {
        continue;
      }

      if (selectedIndex < 0) {
        selectedIndex = i;
        continue;
      }

      const selected = this.queue[selectedIndex];
      if (
        candidate.priority > selected.priority ||
        (candidate.priority === selected.priority && candidate.enqueuedAt < selected.enqueuedAt)
      ) {
        selectedIndex = i;
      }
    }

    if (selectedIndex < 0) {
      return null;
    }

    const [item] = this.queue.splice(selectedIndex, 1);
    return item ?? null;
  }

  public peek(): QueueItem | null {
    return this.queue[0] ?? null;
  }

  public size(): number {
    return this.queue.length;
  }

  public clear(): void {
    this.queue = [];
    this.pendingMessages.clear();
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  public getStats(): {
    totalEnqueued: number;
    totalProcessed: number;
    totalFailed: number;
    totalRetried: number;
    totalEvicted: number;
    queueSize: number;
    pendingSize: number;
  } {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      pendingSize: this.pendingMessages.size
    };
  }

  public markAsPendingByItem(item: QueueItem): void {
    this.pendingMessages.set(item.message.id, item);
  }

  public markAsPending(messageId: string): void {
    const index = this.queue.findIndex((item) => item.message.id === messageId);
    if (index < 0) {
      return;
    }

    const [item] = this.queue.splice(index, 1);
    if (item) {
      this.pendingMessages.set(messageId, item);
    }
  }

  public acknowledge(messageId: string): boolean {
    const item = this.pendingMessages.get(messageId);
    if (!item) {
      return false;
    }

    this.pendingMessages.delete(messageId);
    this.stats.totalProcessed += 1;
    item.callback?.onSuccess?.(item.message);
    return true;
  }

  public retry(messageId: string): boolean {
    const item = this.pendingMessages.get(messageId);
    if (!item) {
      return false;
    }

    this.pendingMessages.delete(messageId);
    item.retryCount += 1;
    this.stats.totalRetried += 1;

    if (item.retryCount > this.retryDelays.length) {
      this.stats.totalFailed += 1;
      item.callback?.onError?.(new Error("Retry limit exceeded"), item.message);
      return false;
    }

    const delay = this.getRetryDelay(item.retryCount - 1);
    item.availableAt = Date.now() + delay;
    this.queue.push(item);
    this.sortByPriority();
    return true;
  }

  public failPending(messageId: string, error: Error): boolean {
    const item = this.pendingMessages.get(messageId);
    if (!item) {
      return false;
    }

    this.pendingMessages.delete(messageId);
    this.stats.totalFailed += 1;
    item.callback?.onError?.(error, item.message);
    return true;
  }

  public hasQueuedMessages(): boolean {
    return this.queue.length > 0;
  }

  public hasPendingMessages(): boolean {
    return this.pendingMessages.size > 0;
  }

  public getRetryDelay(retryCount: number): number {
    const index = Math.max(0, Math.min(retryCount, this.retryDelays.length - 1));
    return this.retryDelays[index];
  }

  public getQueuedItems(): QueueItem[] {
    return [...this.queue];
  }

  public getPendingItems(): QueueItem[] {
    return Array.from(this.pendingMessages.values());
  }

  private sortByPriority(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  private evictLowestPriority(): boolean {
    if (this.queue.length === 0) {
      return false;
    }

    let victimIndex = 0;

    for (let i = 1; i < this.queue.length; i += 1) {
      const current = this.queue[i];
      const victim = this.queue[victimIndex];

      if (
        current.priority < victim.priority ||
        (current.priority === victim.priority && current.enqueuedAt < victim.enqueuedAt)
      ) {
        victimIndex = i;
      }
    }

    const [evicted] = this.queue.splice(victimIndex, 1);
    if (evicted) {
      this.stats.totalEvicted += 1;
      evicted.callback?.onError?.(new Error("Message evicted due to full queue"), evicted.message);
      return true;
    }

    return false;
  }
}
