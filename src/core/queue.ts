import { MessagePriority, Message } from "../types/message";

/**
 * 队列项在处理生命周期中的回调集合。
 * - onSuccess: 消息被成功确认（ack）后触发
 * - onError: 消息处理失败、重试耗尽或被驱逐时触发
 * - onTimeout: 预留的超时回调（当前队列管理器内未直接调用）
 */
export interface MessageCallback {
  onSuccess?: (message: Message) => void;
  onError?: (error: Error, message: Message) => void;
  onTimeout?: (message: Message) => void;
}

/**
 * 队列中的标准消息包装对象。
 * 除业务消息本体外，额外记录了调度、优先级和重试相关元数据。
 */
export interface QueueItem {
  /** 原始业务消息 */
  message: Message;
  /** 入队时间戳（毫秒） */
  enqueuedAt: number;
  /** 最早可被消费的时间戳（毫秒），用于延迟重试 */
  availableAt: number;
  /** 当前生效优先级 */
  priority: MessagePriority;
  /** 已重试次数（从 0 开始） */
  retryCount: number;
  /** 可选回调 */
  callback?: MessageCallback;
}

/**
 * 消息队列管理器。
 * 负责以下核心能力：
 * 1. 按优先级 + 入队时间调度消息；
 * 2. 维护待确认（pending）消息集合；
 * 3. 执行重试与退避延迟；
 * 4. 在队列满时按策略驱逐低优先级消息；
 * 5. 统计队列运行指标。
 */
export class MessageQueueManager {
  /** 待处理消息队列（不含 pending 中的消息） */
  private queue: QueueItem[] = [];
  /** 队列容量上限 */
  private readonly maxSize: number;
  /** 固定重试退避策略（毫秒）：第 N 次重试使用下标 N-1 的延迟 */
  private readonly retryDelays: number[] = [1000, 2000, 5000, 10000, 30000];
  /** 已发出但尚未确认的消息集合，key 为 message.id */
  private pendingMessages: Map<string, QueueItem> = new Map();
  /** 运行统计信息 */
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

  /**
   * 入队一条消息。
   * - 当队列已满时，尝试驱逐一个“最低优先级且最早入队”的消息；
   * - 若无法驱逐，则入队失败返回 false；
   * - 入队成功后立即按优先级排序并更新统计。
   */
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

    // 未显式传入 availableAt 时默认立即可消费
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

  /**
   * 出队一条当前“可消费”的最佳消息。
   * 选择规则：
   * 1) 优先级更高者优先；
   * 2) 优先级相同，入队更早者优先（FIFO）。
   * 注意：会跳过 availableAt 尚未到达的延迟消息。
   */
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

  /** 查看队头元素（基于当前排序结果），不移除 */
  public peek(): QueueItem | null {
    return this.queue[0] ?? null;
  }

  /** 当前待处理队列长度（不含 pending） */
  public size(): number {
    return this.queue.length;
  }

  /** 清空待处理队列与 pending 集合 */
  public clear(): void {
    this.queue = [];
    this.pendingMessages.clear();
  }

  /** 队列是否为空（仅判断待处理队列） */
  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** 获取当前统计快照（含实时 queue/pending 大小） */
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

  /** 将已出队的项直接标记为 pending（调用方已持有 QueueItem） */
  public markAsPendingByItem(item: QueueItem): void {
    this.pendingMessages.set(item.message.id, item);
  }

  /**
   * 按消息 ID 将队列中的消息转移到 pending。
   * 若消息不在队列中则静默返回。
   */
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

  /**
   * 确认一条 pending 消息处理成功。
   * 成功后从 pending 删除、更新统计并触发成功回调。
   */
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

  /**
   * 对 pending 消息执行重试。
   * - 重试次数 +1；
   * - 超过重试上限则记为失败并触发错误回调；
   * - 未超过上限则按退避策略延后可用时间并重新入队。
   */
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

  /** 将 pending 消息标记为最终失败并触发错误回调 */
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

  /** 待处理队列中是否仍有消息 */
  public hasQueuedMessages(): boolean {
    return this.queue.length > 0;
  }

  /** pending 集合中是否仍有消息 */
  public hasPendingMessages(): boolean {
    return this.pendingMessages.size > 0;
  }

  /**
   * 获取指定重试次数对应的退避延迟。
   * 使用边界保护：小于 0 取 0，大于最大下标取最后一个延迟值。
   */
  public getRetryDelay(retryCount: number): number {
    const index = Math.max(0, Math.min(retryCount, this.retryDelays.length - 1));
    return this.retryDelays[index];
  }

  /** 返回队列快照副本，避免外部直接修改内部数组 */
  public getQueuedItems(): QueueItem[] {
    return [...this.queue];
  }

  /** 返回 pending 项快照副本 */
  public getPendingItems(): QueueItem[] {
    return Array.from(this.pendingMessages.values());
  }

  /**
   * 队列排序规则：
   * 1) 优先级降序（数字越大优先级越高）；
   * 2) 入队时间升序（越早越先处理）。
   */
  private sortByPriority(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  /**
   * 队列满时驱逐一个“最不该被保留”的消息：
   * 1) 优先级最低者先被驱逐；
   * 2) 若优先级相同，入队更早者先被驱逐。
   * 成功驱逐后会触发错误回调通知上层。
   */
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
