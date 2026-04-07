---
AIGC:
    ContentProducer: Minimax Agent AI
    ContentPropagator: Minimax Agent AI
    Label: AIGC
    ProduceID: 4a4373705b908e83b300be2d40c6ae40
    PropagateID: 4a4373705b908e83b300be2d40c6ae40
    ReservedCode1: 304402200a93f440d1731e7945cb7ac97ca40b19c8b43b5d8e8775ebd76f5bc35a863f7e0220176006f0af2e91760c43a4827eee76b215e016bfbb895e95d99a9d6a52c31df8
    ReservedCode2: 3046022100b576b37e7cacc4b49619d9bfdbb0a43852845aa039a7bedd5692d02c8cea0230022100e8fe86430b55334cfcd152478ca435a9d7facc82471c1c037374016cab65b066
---

# 基于WebSocket的通用双向消息通知SDK设计与实现

## 一、概述

### 1.1 WebSocket技术简介

WebSocket是一种在单个TCP连接上提供全双工通信的协议。与传统的HTTP请求-响应模式不同，WebSocket允许服务器与客户端之间在任何时刻主动推送数据，实现了真正的双向实时通信。WebSocket协议通过一次握手建立连接后，连接保持打开状态，双方可以随时发送数据帧而无需重新建立连接。这种特性使WebSocket成为构建实时应用的首选技术方案。WebSocket具有以下核心优势：全双工通信机制使服务器和客户端能够平等地相互发送消息，无需轮询或长轮询；持久连接避免了重复建立连接的开销，降低了延迟并提高了效率；文本和二进制数据帧的支持使WebSocket能够灵活处理各类消息格式；广泛兼容性确保现代浏览器和绝大多数网络环境都能良好支持WebSocket协议。

### 1.2 消息通知SDK的设计目标

本SDK的设计目标是构建一个功能完备、易于使用的WebSocket消息通知系统，能够支持多种消息场景和类型。主要功能需求包括以下几个方面：实时双向通信能力确保服务器与客户端之间的即时消息传递；多种消息类型支持涵盖文本消息、JSON结构化消息、指令消息、系统通知、进度更新等；并发场景处理通过指令调度机制确保高并发环境下消息的有序传递；连接管理与自动重连机制保证网络不稳定时的服务可靠性；消息确认与回调机制确保关键消息的可靠送达；心跳检测机制及时发现并处理断开的连接。

## 二、技术架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                          前端应用层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  业务组件   │  │  UI通知层   │  │  指令处理模块           │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                     │                 │
│  ┌──────▼─────────────────▼─────────────────────▼─────────────┐  │
│  │                  WebSocket SDK 核心层                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │连接管理器│  │消息队列  │  │事件分发器│  │心跳管理器│  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  WebSocket协议    │
                    │   (ws://wss://)   │
                    └─────────┬─────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                         后端服务层                               │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │ WebSocket管理器│  │  消息路由器    │  │  指令调度器    │   │
│  └────────────────┘  └────────────────┘  └─────────────────┘   │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │  消息队列      │  │  并发控制器    │  │  存储层         │   │
│  └────────────────┘  └────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 消息类型定义

```typescript
/**
 * 消息类型枚举
 * 定义了SDK支持的所有消息类型
 */
export enum MessageType {
    /** 普通文本消息 */
    TEXT = 'text',
    /** JSON结构化消息 */
    JSON = 'json',
    /** 系统通知消息 */
    SYSTEM = 'system',
    /** 指令消息（用于并发控制） */
    COMMAND = 'command',
    /** 心跳消息 */
    HEARTBEAT = 'heartbeat',
    /** 确认消息 */
    ACKNOWLEDGE = 'ack',
    /** 错误消息 */
    ERROR = 'error',
    /** 进度通知 */
    PROGRESS = 'progress',
    /** Ping消息 */
    PING = 'ping',
    /** Pong消息 */
    PONG = 'pong'
}

/**
 * 消息优先级枚举
 * 用于消息处理的优先级调度
 */
export enum MessagePriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    CRITICAL = 3
}

/**
 * 指令操作类型枚举
 * 定义了支持的指令操作类型
 */
export enum CommandAction {
    EXECUTE = 'execute',
    CANCEL = 'cancel',
    PAUSE = 'pause',
    RESUME = 'resume',
    QUERY = 'query',
    SYNC = 'sync'
}

/**
 * 消息接口定义
 * 所有消息的基类接口
 */
export interface Message {
    /** 消息唯一标识符 */
    id: string;
    /** 消息类型 */
    type: MessageType;
    /** 消息优先级 */
    priority: MessagePriority;
    /** 消息创建时间戳 */
    timestamp: number;
    /** 消息来源标识 */
    source: string;
    /** 消息目标标识（可选，用于定向消息） */
    target?: string;
    /** 消息载荷数据 */
    payload: any;
    /** 消息元数据 */
    metadata?: Record<string, any>;
}

/**
 * 指令消息接口
 * 用于并发控制和任务调度
 */
export interface CommandMessage extends Message {
    type: MessageType.COMMAND;
    payload: {
        /** 指令ID，用于追踪和响应 */
        commandId: string;
        /** 指令操作类型 */
        action: CommandAction;
        /** 指令关联的任务ID */
        taskId?: string;
        /** 指令参数 */
        params?: Record<string, any>;
        /** 执行超时时间（毫秒） */
        timeout?: number;
        /** 是否需要确认 */
        requireAck?: boolean;
    };
}

/**
 * 进度消息接口
 * 用于任务进度通知
 */
export interface ProgressMessage extends Message {
    type: MessageType.PROGRESS;
    payload: {
        /** 任务ID */
        taskId: string;
        /** 当前进度（0-100） */
        progress: number;
        /** 进度描述 */
        description?: string;
        /** 预计剩余时间（毫秒） */
        estimatedTimeRemaining?: number;
    };
}

/**
 * 系统消息接口
 * 用于系统级通知
 */
export interface SystemMessage extends Message {
    type: MessageType.SYSTEM;
    payload: {
        /** 系统事件类型 */
        event: 'connect' | 'disconnect' | 'reconnect' | 'error' | 'maintenance';
        /** 事件详情 */
        detail?: any;
        /** 建议的恢复动作 */
        recommendedAction?: string;
    };
}
```

### 2.3 SDK核心配置与类型

```typescript
/**
 * WebSocket连接状态枚举
 */
export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    RECONNECTING = 'reconnecting',
    ERROR = 'error'
}

/**
 * WebSocket SDK配置选项
 */
export interface WebSocketSDKConfig {
    /** WebSocket服务端点URL */
    endpoint: string;
    /** 客户端标识符 */
    clientId: string;
    /** 认证令牌（可选） */
    authToken?: string;
    /** 心跳间隔（毫秒），默认30000 */
    heartbeatInterval?: number;
    /** 心跳超时时间（毫秒），默认10000 */
    heartbeatTimeout?: number;
    /** 最大重连次数，默认10 */
    maxReconnectAttempts?: number;
    /** 重连延迟基数（毫秒），默认1000 */
    reconnectBaseDelay?: number;
    /** 最大重连延迟（毫秒），默认30000 */
    reconnectMaxDelay?: number;
    /** 连接超时时间（毫秒），默认10000 */
    connectionTimeout?: number;
    /** 是否启用调试模式 */
    debug?: boolean;
    /** 自定义请求头 */
    headers?: Record<string, string>;
    /** 消息队列容量，默认100 */
    messageQueueSize?: number;
    /** 是否自动连接，默认true */
    autoConnect?: boolean;
    /** 是否使用二进制格式发送消息，默认false */
    useBinary?: boolean;
}

/**
 * SDK默认配置
 */
export const DEFAULT_CONFIG: Partial<WebSocketSDKConfig> = {
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
    maxReconnectAttempts: 10,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 30000,
    connectionTimeout: 10000,
    debug: false,
    messageQueueSize: 100,
    autoConnect: true,
    useBinary: false
};

/**
 * 消息处理器接口
 */
export interface MessageHandler {
    (message: Message): void | Promise<void>;
}

/**
 * 事件处理器映射类型
 */
export type EventHandlerMap = {
    [K in MessageType]?: MessageHandler;
} & {
    onConnect?: () => void;
    onDisconnect?: (reason: string) => void;
    onError?: (error: Error) => void;
    onReconnecting?: (attempt: number, maxAttempts: number) => void;
    onStateChange?: (state: ConnectionState, prevState: ConnectionState) => void;
};
```

## 三、前端SDK实现

### 3.1 连接管理器实现

```typescript
/**
 * WebSocket连接管理器
 * 负责管理WebSocket连接的创建、维护和销毁
 */
export class WebSocketConnectionManager {
    private websocket: WebSocket | null = null;
    private config: WebSocketSDKConfig;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    private stateListeners: Array<(state: ConnectionState, prev: ConnectionState) => void> = [];
    private messageListeners: Array<(message: Message) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];
    private lastPongTime: number = 0;

    constructor(config: WebSocketSDKConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 获取当前连接状态
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * 检查是否已连接
     */
    public isConnected(): boolean {
        return this.state === ConnectionState.CONNECTED &&
               this.websocket !== null &&
               this.websocket.readyState === WebSocket.OPEN;
    }

    /**
     * 添加状态变化监听器
     */
    public addStateListener(listener: (state: ConnectionState, prev: ConnectionState) => void): void {
        this.stateListeners.push(listener);
    }

    /**
     * 移除状态变化监听器
     */
    public removeStateListener(listener: (state: ConnectionState, prev: ConnectionState) => void): void {
        this.stateListeners = this.stateListeners.filter(l => l !== listener);
    }

    /**
     * 添加消息监听器
     */
    public addMessageListener(listener: (message: Message) => void): void {
        this.messageListeners.push(listener);
    }

    /**
     * 移除消息监听器
     */
    public removeMessageListener(listener: (message: Message) => void): void {
        this.messageListeners = this.messageListeners.filter(l => l !== listener);
    }

    /**
     * 添加错误监听器
     */
    public addErrorListener(listener: (error: Error) => void): void {
        this.errorListeners.push(listener);
    }

    /**
     * 移除错误监听器
     */
    public removeErrorListener(listener: (error: Error) => void): void {
        this.errorListeners = this.errorListeners.filter(l => l !== listener);
    }

    /**
     * 建立WebSocket连接
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected()) {
                resolve();
                return;
            }

            const prevState = this.state;
            this.setState(ConnectionState.CONNECTING);

            const url = this.buildConnectionUrl();
            this.debug(`建立WebSocket连接: ${url}`);

            try {
                // 构建WebSocket URL，支持自定义协议
                const wsProtocol = url.startsWith('https') ? 'wss:' : 'ws:';
                const wsUrl = url.replace(/^https?/, wsProtocol);

                this.websocket = new WebSocket(wsUrl);

                // 连接超时处理
                const timeout = setTimeout(() => {
                    if (this.state === ConnectionState.CONNECTING) {
                        this.websocket?.close();
                        this.websocket = null;
                        const error = new Error('连接超时');
                        this.notifyError(error);
                        reject(error);
                    }
                }, this.config.connectionTimeout!);

                this.websocket.onopen = (event: Event) => {
                    clearTimeout(timeout);
                    this.debug('WebSocket连接已建立');
                    this.reconnectAttempt = 0;
                    this.setState(ConnectionState.CONNECTED);
                    this.lastPongTime = Date.now();
                    this.startHeartbeat();
                    resolve();
                };

                this.websocket.onmessage = (event: MessageEvent) => {
                    this.handleMessage(event);
                };

                this.websocket.onerror = (event: Event) => {
                    this.debug(`WebSocket错误事件: ${JSON.stringify(event)}`);
                    const error = new Error('WebSocket连接错误');
                    this.notifyError(error);

                    if (this.state === ConnectionState.CONNECTED) {
                        this.handleDisconnect('服务器错误');
                    } else {
                        this.setState(ConnectionState.ERROR);
                        reject(error);
                    }
                };

                this.websocket.onclose = (event: CloseEvent) => {
                    clearTimeout(timeout);
                    this.debug(`WebSocket连接关闭: ${event.code} - ${event.reason}`);
                    this.stopHeartbeat();

                    if (this.state === ConnectionState.CONNECTED) {
                        this.handleDisconnect(event.reason || '连接关闭');
                    }
                };

            } catch (error) {
                this.debug(`WebSocket连接失败: ${error}`);
                this.setState(ConnectionState.ERROR);
                reject(error);
            }
        });
    }

    /**
     * 断开WebSocket连接
     */
    public disconnect(reason: string = '手动断开'): void {
        this.debug(`断开WebSocket连接: ${reason}`);
        this.stopHeartbeat();
        this.clearReconnectTimer();

        if (this.websocket) {
            this.websocket.close(1000, reason);
            this.websocket = null;
        }

        const prevState = this.state;
        this.state = ConnectionState.DISCONNECTED;
        this.notifyStateChange(prevState);
    }

    /**
     * 发送消息
     */
    public send(message: Message): boolean {
        if (!this.isConnected()) {
            this.debug('无法发送消息: 连接已断开');
            return false;
        }

        try {
            const data = this.config.useBinary
                ? this.serializeToBinary(message)
                : JSON.stringify(message);

            this.websocket?.send(data);
            this.debug(`发送消息: ${message.id}, 类型: ${message.type}`);
            return true;
        } catch (error) {
            this.debug(`发送消息失败: ${error}`);
            return false;
        }
    }

    /**
     * 强制重连
     */
    public async reconnect(): Promise<void> {
        this.debug('执行强制重连');
        this.disconnect('准备重连');
        await this.connect();
    }

    /**
     * 构建连接URL
     */
    private buildConnectionUrl(): string {
        const url = new URL(this.config.endpoint);
        url.searchParams.set('clientId', this.config.clientId);

        if (this.config.authToken) {
            url.searchParams.set('token', this.config.authToken);
        }

        return url.toString();
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(event: MessageEvent): void {
        let message: Message;

        try {
            // 根据配置尝试二进制或文本解析
            if (this.config.useBinary && event.data instanceof ArrayBuffer) {
                message = this.deserializeFromBinary(event.data);
            } else {
                message = JSON.parse(event.data as string);
            }

            this.debug(`收到消息: ${message.id}, 类型: ${message.type}`);

            // 处理心跳消息
            if (message.type === MessageType.PONG) {
                this.lastPongTime = Date.now();
                this.clearHeartbeatTimeout();
                return;
            }

            // 分发给所有监听器
            this.messageListeners.forEach(listener => listener(message));

        } catch (error) {
            this.debug(`解析消息失败: ${error}`);
        }
    }

    /**
     * 处理断开连接
     */
    private handleDisconnect(reason: string): void {
        const prevState = this.state;
        this.stopHeartbeat();

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        if (this.reconnectAttempt < this.config.maxReconnectAttempts!) {
            this.setState(ConnectionState.RECONNECTING);
            this.scheduleReconnect();
        } else {
            this.setState(ConnectionState.DISCONNECTED);
            this.debug(`已达到最大重连次数(${this.config.maxReconnectAttempts})，停止重连`);
        }
    }

    /**
     * 调度重连
     */
    private scheduleReconnect(): void {
        const delay = this.calculateReconnectDelay();
        this.reconnectAttempt++;

        this.debug(`计划${delay}ms后进行第${this.reconnectAttempt}次重连`);

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                this.debug(`重连失败: ${error}`);
                this.handleDisconnect('重连失败');
            }
        }, delay);
    }

    /**
     * 计算重连延迟（指数退避）
     */
    private calculateReconnectDelay(): number {
        const delay = Math.min(
            this.config.reconnectBaseDelay! * Math.pow(2, this.reconnectAttempt - 1),
            this.config.reconnectMaxDelay!
        );
        // 添加随机抖动
        return delay + Math.random() * delay * 0.1;
    }

    /**
     * 清除重连定时器
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected()) {
                const pingMessage: Message = {
                    id: this.generateMessageId(),
                    type: MessageType.PING,
                    priority: MessagePriority.LOW,
                    timestamp: Date.now(),
                    source: this.config.clientId,
                    payload: { clientTime: Date.now() }
                };

                this.send(pingMessage);
                this.debug('发送心跳');

                // 设置心跳超时
                this.heartbeatTimeoutTimer = setTimeout(() => {
                    if (this.state === ConnectionState.CONNECTED) {
                        this.debug('心跳超时，关闭连接');
                        this.handleDisconnect('心跳超时');
                    }
                }, this.config.heartbeatTimeout!);
            }
        }, this.config.heartbeatInterval!);
    }

    /**
     * 停止心跳
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.clearHeartbeatTimeout();
    }

    /**
     * 清除心跳超时定时器
     */
    private clearHeartbeatTimeout(): void {
        if (this.heartbeatTimeoutTimer) {
            clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = null;
        }
    }

    /**
     * 设置连接状态
     */
    private setState(state: ConnectionState): void {
        if (this.state !== state) {
            const prevState = this.state;
            this.state = state;
            this.notifyStateChange(prevState);
        }
    }

    /**
     * 通知状态变化
     */
    private notifyStateChange(prevState: ConnectionState): void {
        this.stateListeners.forEach(listener => listener(this.state, prevState));
    }

    /**
     * 通知错误
     */
    private notifyError(error: Error): void {
        this.errorListeners.forEach(listener => listener(error));
    }

    /**
     * 生成消息ID
     */
    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 序列化为二进制
     */
    private serializeToBinary(message: Message): ArrayBuffer {
        const jsonStr = JSON.stringify(message);
        const encoder = new TextEncoder();
        return encoder.encode(jsonStr).buffer;
    }

    /**
     * 从二进制反序列化
     */
    private deserializeFromBinary(buffer: ArrayBuffer): Message {
        const decoder = new TextDecoder();
        const jsonStr = decoder.decode(buffer);
        return JSON.parse(jsonStr);
    }

    /**
     * 调试日志
     */
    private debug(message: string): void {
        if (this.config.debug) {
            console.log(`[WebSocket Connection] ${message}`);
        }
    }
}
```

### 3.2 消息队列管理器实现

```typescript
/**
 * 消息队列项接口
 */
interface QueueItem {
    /** 消息对象 */
    message: Message;
    /** 入队时间戳 */
    enqueuedAt: number;
    /** 优先级 */
    priority: MessagePriority;
    /** 重试次数 */
    retryCount: number;
    /** 回调函数 */
    callback?: MessageCallback;
}

/**
 * 消息回调类型
 */
type MessageCallback = {
    onSuccess?: (message: Message) => void;
    onError?: (error: Error, message: Message) => void;
    onTimeout?: (message: Message) => void;
};

/**
 * 消息队列管理器
 * 负责消息的缓存、优先级排序和可靠投递
 */
export class MessageQueueManager {
    private queue: QueueItem[] = [];
    private maxSize: number;
    private retryDelays: number[] = [1000, 2000, 5000, 10000, 30000];
    private pendingMessages: Map<string, QueueItem> = new Map();
    private stats = {
        totalEnqueued: 0,
        totalProcessed: 0,
        totalFailed: 0,
        totalRetried: 0
    };

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    /**
     * 入队消息
     */
    public enqueue(
        message: Message,
        options: {
            priority?: MessagePriority;
            callback?: MessageCallback;
        } = {}
    ): boolean {
        if (this.queue.length >= this.maxSize) {
            console.warn(`消息队列已满(${this.maxSize})，丢弃低优先级消息`);
            this.evictLowPriority();

            if (this.queue.length >= this.maxSize) {
                return false;
            }
        }

        const item: QueueItem = {
            message,
            enqueuedAt: Date.now(),
            priority: options.priority ?? message.priority,
            retryCount: 0,
            callback: options.callback
        };

        this.queue.push(item);
        this.sortByPriority();
        this.stats.totalEnqueued++;

        this.debug(`消息入队: ${message.id}, 优先级: ${item.priority}, 队列长度: ${this.queue.length}`);

        return true;
    }

    /**
     * 出队消息
     */
    public dequeue(): QueueItem | null {
        return this.queue.shift() || null;
    }

    /**
     * 查看队首消息
     */
    public peek(): QueueItem | null {
        return this.queue[0] || null;
    }

    /**
     * 获取队列长度
     */
    public size(): number {
        return this.queue.length;
    }

    /**
     * 清空队列
     */
    public clear(): void {
        this.queue = [];
        this.pendingMessages.clear();
    }

    /**
     * 检查队列是否为空
     */
    public isEmpty(): boolean {
        return this.queue.length === 0;
    }

    /**
     * 获取队列统计信息
     */
    public getStats() {
        return {
            ...this.stats,
            queueSize: this.queue.length,
            pendingSize: this.pendingMessages.size
        };
    }

    /**
     * 标记消息为已发送（等待确认）
     */
    public markAsPending(messageId: string): void {
        const item = this.queue.find(i => i.message.id === messageId);
        if (item) {
            this.pendingMessages.set(messageId, item);
            this.queue = this.queue.filter(i => i.message.id !== messageId);
        }
    }

    /**
     * 确认消息发送成功
     */
    public acknowledge(messageId: string): boolean {
        const item = this.pendingMessages.get(messageId);
        if (item) {
            this.pendingMessages.delete(messageId);
            this.handleSuccess(item);
            return true;
        }
        return false;
    }

    /**
     * 消息发送失败，需要重试
     */
    public retry(messageId: string): boolean {
        const item = this.pendingMessages.get(messageId);
        if (item) {
            if (this.incrementRetry(item)) {
                this.pendingMessages.delete(messageId);
                this.queue.push(item);
                this.sortByPriority();
                return true;
            } else {
                this.pendingMessages.delete(messageId);
                this.handleFailure(item, new Error('达到最大重试次数'));
                return false;
            }
        }
        return false;
    }

    /**
     * 按优先级排序（降序）
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
     * 驱逐低优先级消息
     */
    private evictLowPriority(): void {
        let minPriority = MessagePriority.LOW;
        let minIndex = -1;

        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].priority < minPriority) {
                minPriority = this.queue[i].priority;
                minIndex = i;
            }
        }

        if (minIndex !== -1) {
            const removed = this.queue.splice(minIndex, 1);
            this.debug(`驱逐低优先级消息: ${removed[0].message.id}`);
        }
    }

    /**
     * 增加重试次数
     */
    private incrementRetry(item: QueueItem): boolean {
        item.retryCount++;
        this.stats.totalRetried++;

        if (item.retryCount >= this.retryDelays.length) {
            this.debug(`消息 ${item.message.id} 已达到最大重试次数`);
            return false;
        }

        return true;
    }

    /**
     * 处理失败消息
     */
    private handleFailure(item: QueueItem, error: Error): void {
        this.stats.totalFailed++;

        if (item.callback?.onError) {
            item.callback.onError(error, item.message);
        }
    }

    /**
     * 处理成功消息
     */
    private handleSuccess(item: QueueItem): void {
        this.stats.totalProcessed++;

        if (item.callback?.onSuccess) {
            item.callback.onSuccess(item.message);
        }
    }

    /**
     * 获取消息的重试延迟
     */
    public getRetryDelay(retryCount: number): number {
        return this.retryDelays[Math.min(retryCount, this.retryDelays.length - 1)];
    }

    /**
     * 获取待处理消息
     */
    public getProcessableItems(): QueueItem[] {
        return [...this.queue];
    }

    /**
     * 获取待确认消息
     */
    public getPendingMessages(): QueueItem[] {
        return Array.from(this.pendingMessages.values());
    }

    /**
     * 检查是否有待发送消息
     */
    public hasPendingMessages(): boolean {
        return this.queue.length > 0;
    }

    /**
     * 调试日志
     */
    private debug(message: string): void {
        console.log(`[MessageQueue] ${message}`);
    }
}
```

### 3.3 事件分发器实现

```typescript
/**
 * 订阅者接口
 */
interface Subscriber {
    /** 订阅者ID */
    id: string;
    /** 消息类型过滤 */
    messageTypes: MessageType[];
    /** 消息处理器 */
    handler: MessageHandler;
    /** 优先级 */
    priority: number;
    /** 是否一次性订阅 */
    once?: boolean;
}

/**
 * 事件分发器
 * 负责将接收到的消息分发给相应的订阅者
 */
export class EventDispatcher {
    private subscribers: Map<string, Subscriber> = new Map();
    private defaultHandlers: EventHandlerMap = {};
    private messageHistory: Message[] = [];
    private maxHistorySize = 50;
    private stats = {
        totalDispatched: 0,
        totalHandled: 0,
        totalErrors: 0
    };

    constructor() {
        // 初始化默认处理器
    }

    /**
     * 订阅消息
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
        const id = options.id || this.generateId();

        const subscriber: Subscriber = {
            id,
            messageTypes,
            handler,
            priority: options.priority ?? 0,
            once: options.once
        };

        this.subscribers.set(id, subscriber);
        this.debug(`订阅者 ${id} 订阅了: ${messageTypes.join(', ')}`);

        return id;
    }

    /**
     * 取消订阅
     */
    public unsubscribe(subscriptionId: string): boolean {
        const deleted = this.subscribers.delete(subscriptionId);
        if (deleted) {
            this.debug(`取消订阅: ${subscriptionId}`);
        }
        return deleted;
    }

    /**
     * 订阅一次性消息
     */
    public subscribeOnce(
        messageType: MessageType,
        handler: MessageHandler
    ): string {
        return this.subscribe([messageType], handler, { once: true });
    }

    /**
     * 设置默认处理器
     */
    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.defaultHandlers = { ...this.defaultHandlers, ...handlers };
    }

    /**
     * 分发消息
     */
    public async dispatch(message: Message): Promise<void> {
        this.stats.totalDispatched++;

        this.addToHistory(message);

        this.debug(`分发消息: ${message.id}, 类型: ${message.type}`);

        const sortedSubscribers = this.getSortedSubscribers(message.type);

        for (const subscriber of sortedSubscribers) {
            try {
                await this.executeHandler(subscriber, message);
                this.stats.totalHandled++;

                if (subscriber.once) {
                    this.unsubscribe(subscriber.id);
                }
            } catch (error) {
                this.stats.totalErrors++;
                console.error(`消息处理错误 (${subscriber.id}):`, error);
            }
        }

        await this.callDefaultHandler(message);
    }

    /**
     * 获取指定类型的已排序订阅者
     */
    private getSortedSubscribers(messageType: MessageType): Subscriber[] {
        return Array.from(this.subscribers.values())
            .filter(sub => sub.messageTypes.includes(messageType))
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * 执行处理器
     */
    private async executeHandler(subscriber: Subscriber, message: Message): Promise<void> {
        const result = subscriber.handler(message);

        if (result instanceof Promise) {
            await result;
        }
    }

    /**
     * 调用默认处理器
     */
    private async callDefaultHandler(message: Message): Promise<void> {
        const handler = this.defaultHandlers[message.type];
        if (handler) {
            try {
                await this.executeHandler(
                    { id: 'default', messageTypes: [message.type], handler, priority: -1 },
                    message
                );
            } catch (error) {
                console.error('默认处理器错误:', error);
            }
        }
    }

    /**
     * 添加到历史记录
     */
    private addToHistory(message: Message): void {
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    /**
     * 获取消息历史
     */
    public getHistory(type?: MessageType): Message[] {
        if (type) {
            return this.messageHistory.filter(m => m.type === type);
        }
        return [...this.messageHistory];
    }

    /**
     * 获取统计信息
     */
    public getStats() {
        return {
            ...this.stats,
            subscriberCount: this.subscribers.size
        };
    }

    /**
     * 生成唯一ID
     */
    private generateId(): string {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 清空所有订阅
     */
    public clear(): void {
        this.subscribers.clear();
    }

    /**
     * 获取订阅者数量
     */
    public getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * 调试日志
     */
    private debug(message: string): void {
        console.log(`[EventDispatcher] ${message}`);
    }
}
```

### 3.4 SDK主类实现

```typescript
/**
 * WebSocket SDK主类
 * 提供统一的消息通知接口
 */
export class NotificationSDK {
    private connectionManager: WebSocketConnectionManager;
    private messageQueue: MessageQueueManager;
    private eventDispatcher: EventDispatcher;
    private config: WebSocketSDKConfig;
    private messageIdGenerator: Iterator<string>;
    private disposed = false;
    private processingQueue = false;

    /**
     * 构造函数
     */
    constructor(config: WebSocketSDKConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.connectionManager = new WebSocketConnectionManager(this.config);
        this.messageQueue = new MessageQueueManager(this.config.messageQueueSize);
        this.eventDispatcher = new EventDispatcher();

        this.messageIdGenerator = this.createMessageIdGenerator();

        this.setupInternalHandlers();

        if (this.config.autoConnect) {
            this.connect();
        }
    }

    /**
     * 连接到服务器
     */
    public async connect(): Promise<void> {
        if (this.disposed) {
            throw new Error('SDK已释放，无法连接');
        }
        await this.connectionManager.connect();
    }

    /**
     * 断开连接
     */
    public disconnect(reason?: string): void {
        this.connectionManager.disconnect(reason);
    }

    /**
     * 检查是否已连接
     */
    public isConnected(): boolean {
        return this.connectionManager.isConnected();
    }

    /**
     * 获取连接状态
     */
    public getConnectionState(): ConnectionState {
        return this.connectionManager.getState();
    }

    /**
     * 订阅消息
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
     * 取消订阅
     */
    public unsubscribe(subscriptionId: string): boolean {
        return this.eventDispatcher.unsubscribe(subscriptionId);
    }

    /**
     * 订阅一次性消息
     */
    public subscribeOnce(messageType: MessageType, handler: MessageHandler): string {
        return this.eventDispatcher.subscribeOnce(messageType, handler);
    }

    /**
     * 发送消息到服务器
     */
    public async send(message: Message): Promise<void> {
        if (!this.isConnected()) {
            // 离线模式下入队
            const result = this.messageQueue.enqueue(message);
            if (!result) {
                throw new Error('消息队列已满');
            }
            return;
        }

        const success = this.connectionManager.send(message);
        if (!success) {
            // 发送失败时入队
            this.messageQueue.enqueue(message);
        }
    }

    /**
     * 发送文本消息
     */
    public async sendText(
        content: string,
        options?: {
            target?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<void> {
        const message: Message = {
            id: this.generateMessageId(),
            type: MessageType.TEXT,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source: this.config.clientId,
            target: options?.target,
            payload: { content },
            metadata: options?.metadata
        };

        await this.send(message);
    }

    /**
     * 发送JSON消息
     */
    public async sendJSON(
        data: any,
        options?: {
            target?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<void> {
        const message: Message = {
            id: this.generateMessageId(),
            type: MessageType.JSON,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source: this.config.clientId,
            target: options?.target,
            payload: data,
            metadata: options?.metadata
        };

        await this.send(message);
    }

    /**
     * 发送指令消息
     */
    public async sendCommand(
        action: CommandAction,
        params?: Record<string, any>,
        options?: {
            taskId?: string;
            timeout?: number;
            requireAck?: boolean;
            priority?: MessagePriority;
        }
    ): Promise<string> {
        const commandId = this.generateMessageId();

        const command: CommandMessage = {
            id: this.generateMessageId(),
            type: MessageType.COMMAND,
            priority: options?.priority || MessagePriority.HIGH,
            timestamp: Date.now(),
            source: this.config.clientId,
            payload: {
                commandId,
                action,
                taskId: options?.taskId,
                params,
                timeout: options?.timeout,
                requireAck: options?.requireAck !== false
            }
        };

        await this.send(command);
        return commandId;
    }

    /**
     * 发送进度查询请求
     */
    public async queryProgress(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.QUERY, { taskId }, {
            priority: MessagePriority.LOW
        });
    }

    /**
     * 取消任务
     */
    public async cancelTask(taskId: string): Promise<void> {
        await this.sendCommand(CommandAction.CANCEL, { taskId });
    }

    /**
     * 设置连接状态变化处理器
     */
    public onConnectionChange(
        callback: (state: ConnectionState, prevState: ConnectionState) => void
    ): void {
        this.connectionManager.addStateListener(callback);
    }

    /**
     * 设置错误处理器
     */
    public onError(callback: (error: Error) => void): void {
        this.connectionManager.addErrorListener(callback);
    }

    /**
     * 设置默认消息处理器
     */
    public setDefaultHandlers(handlers: EventHandlerMap): void {
        this.eventDispatcher.setDefaultHandlers(handlers);
    }

    /**
     * 获取消息历史
     */
    public getMessageHistory(type?: MessageType): Message[] {
        return this.eventDispatcher.getHistory(type);
    }

    /**
     * 获取统计信息
     */
    public getStats() {
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
     * 设置认证令牌
     */
    public setAuthToken(token: string): void {
        this.config.authToken = token;
    }

    /**
     * 释放SDK资源
     */
    public dispose(): void {
        if (this.disposed) return;

        this.disposed = true;
        this.disconnect('SDK释放');
        this.messageQueue.clear();
        this.eventDispatcher.clear();
    }

    /**
     * 设置内部事件处理
     */
    private setupInternalHandlers(): void {
        // 处理WebSocket消息
        this.connectionManager.addMessageListener(async (message: Message) => {
            // 处理确认消息
            if (message.type === MessageType.ACKNOWLEDGE) {
                const { messageId } = message.payload;
                if (messageId) {
                    this.messageQueue.acknowledge(messageId);
                    // 处理队列中的下一条消息
                    this.processQueue();
                }
                return;
            }

            // 分发给订阅者
            await this.eventDispatcher.dispatch(message);

            // 处理连接状态相关的系统消息
            if (message.type === MessageType.SYSTEM) {
                const { event } = message.payload;

                if (event === 'connected') {
                    // 服务器连接确认，处理离线队列
                    this.processQueue();
                }
            }
        });

        // 处理连接状态变化
        this.connectionManager.addStateListener((state, prevState) => {
            this.debug(`连接状态变化: ${prevState} -> ${state}`);

            if (state === ConnectionState.CONNECTED) {
                const systemMessage: SystemMessage = {
                    id: this.generateMessageId(),
                    type: MessageType.SYSTEM,
                    priority: MessagePriority.HIGH,
                    timestamp: Date.now(),
                    source: 'sdk',
                    payload: { event: 'connect' }
                };
                this.eventDispatcher.dispatch(systemMessage);

                // 连接建立后处理离线队列
                this.processQueue();
            } else if (state === ConnectionState.DISCONNECTED && prevState === ConnectionState.CONNECTED) {
                const systemMessage: SystemMessage = {
                    id: this.generateMessageId(),
                    type: MessageType.SYSTEM,
                    priority: MessagePriority.HIGH,
                    timestamp: Date.now(),
                    source: 'sdk',
                    payload: { event: 'disconnect' }
                };
                this.eventDispatcher.dispatch(systemMessage);
            }
        });

        // 处理连接错误
        this.connectionManager.addErrorListener((error) => {
            const errorMessage: SystemMessage = {
                id: this.generateMessageId(),
                type: MessageType.SYSTEM,
                priority: MessagePriority.CRITICAL,
                timestamp: Date.now(),
                source: 'sdk',
                payload: {
                    event: 'error',
                    detail: error.message
                }
            };
            this.eventDispatcher.dispatch(errorMessage);
        });
    }

    /**
     * 处理消息队列
     */
    private async processQueue(): Promise<void> {
        if (this.processingQueue || !this.isConnected()) {
            return;
        }

        this.processingQueue = true;

        try {
            while (this.messageQueue.hasPendingMessages() && this.isConnected()) {
                const item = this.messageQueue.dequeue();
                if (item) {
                    const success = this.connectionManager.send(item.message);
                    if (success) {
                        if (item.callback?.onSuccess) {
                            item.callback.onSuccess(item.message);
                        }
                    } else {
                        // 发送失败，重新入队
                        this.messageQueue.enqueue(item.message, {
                            callback: item.callback
                        });
                        break;
                    }
                }
            }
        } finally {
            this.processingQueue = false;
        }
    }

    /**
     * 创建消息ID生成器
     */
    private createMessageIdGenerator(): Iterator<string> {
        let counter = 0;
        return {
            next(): IteratorResult<string> {
                const timestamp = Date.now().toString(36);
                const random = Math.random().toString(36).substr(2, 5);
                counter++;
                return {
                    value: `${timestamp}_${random}_${counter}`,
                    done: false
                };
            }
        };
    }

    /**
     * 生成消息ID
     */
    private generateMessageId(): string {
        return this.messageIdGenerator.next().value;
    }

    /**
     * 调试日志
     */
    private debug(message: string): void {
        if (this.config.debug) {
            console.log(`[NotificationSDK] ${message}`);
        }
    }
}

// 创建SDK的工厂函数
export function createWebSocketSDK(config: WebSocketSDKConfig): NotificationSDK {
    return new NotificationSDK(config);
}
```

## 四、后端服务实现

### 4.1 Node.js/Express与WebSocket服务实现

```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * WebSocket连接信息接口
 */
interface WSConnection {
    id: string;
    clientId: string;
    socket: WebSocket;
    createdAt: number;
    lastActiveAt: number;
    closed: boolean;
}

/**
 * 消息接口
 */
interface Message {
    id: string;
    type: string;
    priority: number;
    timestamp: number;
    source: string;
    target?: string;
    payload: any;
    metadata?: Record<string, any>;
}

/**
 * WebSocket消息服务
 * 管理所有WebSocket连接和消息路由
 */
class WSMessageService {
    private connections: Map<string, WSConnection> = new Map();
    private messageQueue: Map<string, Message[]> = new Map();
    private heartbeatInterval: number = 30000;
    private heartbeatTimeout: number = 10000;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private cleanupInterval: number = 60000;
    private cleanupTimer: NodeJS.Timeout | null = null;
    private app: express.Application;
    private server: ReturnType<typeof createServer>;
    private wss: WebSocketServer;

    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.startHeartbeat();
        this.startCleanup();
    }

    /**
     * 设置中间件
     */
    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(express.json());

        this.app.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
            next();
        });
    }

    /**
     * 设置HTTP路由
     */
    private setupRoutes(): void {
        // 获取连接列表
        this.app.get('/api/connections', (req, res) => {
            res.json(this.getConnectionList());
        });

        // 健康检查
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                connections: this.connections.size,
                uptime: process.uptime()
            });
        });
    }

    /**
     * 设置WebSocket处理
     */
    private setupWebSocket(): void {
        this.wss.on('connection', (socket, req) => {
            // 从URL参数获取客户端信息
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const clientId = url.searchParams.get('clientId') || 'unknown';
            const token = url.searchParams.get('token');

            if (!clientId || (token && !this.validateToken(token))) {
                socket.close(4001, 'Invalid credentials');
                return;
            }

            this.handleConnection(socket, clientId);
        });
    }

    /**
     * 处理WebSocket连接
     */
    private handleConnection(socket: WebSocket, clientId: string): void {
        const connection: WSConnection = {
            id: this.generateConnectionId(),
            clientId,
            socket,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            closed: false
        };

        this.connections.set(clientId, connection);
        console.log(`[WS] 新连接: ${clientId}, 总连接数: ${this.connections.size}`);

        this.messageQueue.set(clientId, []);

        // 发送连接确认
        this.sendToClient(clientId, {
            id: this.generateMessageId(),
            type: 'system',
            priority: 3,
            timestamp: Date.now(),
            source: 'server',
            payload: {
                event: 'connect',
                detail: { clientId, connectionId: connection.id }
            }
        });

        // 处理消息
        socket.on('message', (data) => {
            this.handleMessage(clientId, data);
        });

        // 处理关闭
        socket.on('close', (code, reason) => {
            console.log(`[WS] 连接关闭: ${clientId}, 代码: ${code}, 原因: ${reason}`);
            this.handleConnectionClose(clientId);
        });

        // 处理错误
        socket.on('error', (error) => {
            console.error(`[WS] 连接错误 (${clientId}):`, error);
            this.handleConnectionClose(clientId);
        });

        // 处理ping（WebSocket协议层）
        socket.on('ping', () => {
            connection.lastActiveAt = Date.now();
        });

        socket.on('pong', () => {
            connection.lastActiveAt = Date.now();
        });
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(clientId: string, data: any): void {
        try {
            const message: Message = typeof data === 'string'
                ? JSON.parse(data)
                : JSON.parse(data.toString());

            if (!message.id || !message.type) {
                console.warn(`[WS] 无效消息格式: ${clientId}`);
                return;
            }

            connection.lastActiveAt = Date.now();
            console.log(`[WS] 收到消息: ${message.id}, 类型: ${message.type}, 来源: ${clientId}`);

            // 处理心跳消息
            if (message.type === 'ping') {
                this.sendToClient(clientId, {
                    id: this.generateMessageId(),
                    type: 'pong',
                    priority: 0,
                    timestamp: Date.now(),
                    source: 'server',
                    payload: { serverTime: Date.now() }
                });
                return;
            }

            // 处理确认消息
            if (message.type === 'ack') {
                this.handleAcknowledgement(clientId, message);
                return;
            }

            // 处理指令消息
            if (message.type === 'command') {
                this.handleCommand(clientId, message);
                return;
            }

            // 处理普通消息
            if (message.target) {
                // 定向消息
                this.sendToClient(message.target, message);
            } else if (message.payload?.broadcast) {
                // 广播消息
                this.broadcastMessage(message, clientId);
            }

            // 发送确认
            this.sendToClient(clientId, {
                id: this.generateMessageId(),
                type: 'ack',
                priority: 3,
                timestamp: Date.now(),
                source: 'server',
                payload: { messageId: message.id, success: true }
            });

        } catch (error) {
            console.error(`[WS] 处理消息失败 (${clientId}):`, error);
        }
    }

    /**
     * 处理确认消息
     */
    private handleAcknowledgement(clientId: string, message: Message): void {
        const { messageId } = message.payload;
        if (messageId) {
            console.log(`[WS] 收到确认: ${messageId} 从 ${clientId}`);
        }
    }

    /**
     * 处理指令消息
     */
    private handleCommand(clientId: string, message: Message): void {
        const { action, commandId, params } = message.payload;

        console.log(`[WS] 处理指令: ${action}, 命令ID: ${commandId}`);

        // 这里可以接入指令调度器
        // scheduler.processCommand(message);
    }

    /**
     * 发送消息到指定客户端
     */
    public sendToClient(clientId: string, message: Message): boolean {
        const connection = this.connections.get(clientId);

        if (!connection || connection.closed || connection.socket.readyState !== WebSocket.OPEN) {
            console.warn(`[WS] 客户端未连接: ${clientId}`);
            return false;
        }

        try {
            const data = JSON.stringify(message);
            connection.socket.send(data);
            connection.lastActiveAt = Date.now();
            console.log(`[WS] 发送消息到 ${clientId}: ${message.id}`);
            return true;
        } catch (error) {
            console.error(`[WS] 发送消息失败 (${clientId}):`, error);
            this.handleConnectionClose(clientId);
            return false;
        }
    }

    /**
     * 广播消息到所有客户端
     */
    public broadcastMessage(message: Message, excludeClientId?: string): void {
        let sentCount = 0;

        this.connections.forEach((conn, clientId) => {
            if (clientId !== excludeClientId && !conn.closed && conn.socket.readyState === WebSocket.OPEN) {
                if (this.sendToClient(clientId, message)) {
                    sentCount++;
                }
            }
        });

        console.log(`[Broadcast] 广播消息 ${message.id} 到 ${sentCount} 个客户端`);
    }

    /**
     * 发送消息到多个指定客户端
     */
    public sendToClients(clientIds: string[], message: Message): number {
        let sentCount = 0;
        clientIds.forEach(clientId => {
            if (this.sendToClient(clientId, message)) {
                sentCount++;
            }
        });
        return sentCount;
    }

    /**
     * 处理连接关闭
     */
    private handleConnectionClose(clientId: string): void {
        const connection = this.connections.get(clientId);

        if (connection) {
            connection.closed = true;
            this.connections.delete(clientId);
            this.messageQueue.delete(clientId);

            console.log(`[WS] 连接关闭: ${clientId}, 剩余连接: ${this.connections.size}`);
        }
    }

    /**
     * 获取连接列表
     */
    private getConnectionList(): any[] {
        return Array.from(this.connections.entries()).map(([clientId, conn]) => ({
            clientId,
            connectionId: conn.id,
            createdAt: conn.createdAt,
            lastActiveAt: conn.lastActiveAt,
            uptime: Date.now() - conn.createdAt,
            readyState: conn.socket.readyState
        }));
    }

    /**
     * 验证认证令牌
     */
    private validateToken(token: string): boolean {
        return token && token.length > 0;
    }

    /**
     * 生成连接ID
     */
    private generateConnectionId(): string {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 生成消息ID
     */
    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            this.connections.forEach((conn, clientId) => {
                if (!conn.closed && conn.socket.readyState === WebSocket.OPEN) {
                    try {
                        // 使用WebSocket协议层的ping
                        conn.socket.ping();
                        conn.lastActiveAt = Date.now();
                    } catch (error) {
                        console.error(`[WS] 发送心跳失败 (${clientId}):`, error);
                        this.handleConnectionClose(clientId);
                    }
                }
            });
        }, this.heartbeatInterval);
    }

    /**
     * 启动清理任务
     */
    private startCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            const staleThreshold = 300000; // 5分钟

            this.connections.forEach((conn, clientId) => {
                if (now - conn.lastActiveAt > staleThreshold) {
                    console.log(`[Cleanup] 清理超时连接: ${clientId}`);
                    conn.socket.close(4000, 'Connection timeout');
                    this.handleConnectionClose(clientId);
                }
            });
        }, this.cleanupInterval);
    }

    /**
     * 获取HTTP服务器实例
     */
    public getServer(): ReturnType<typeof createServer> {
        return this.server;
    }

    /**
     * 停止服务
     */
    public stop(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.connections.forEach((conn) => {
            conn.socket.close(1001, 'Server shutdown');
        });

        this.wss.close();
        this.connections.clear();
        this.messageQueue.clear();
    }
}

// 创建并启动服务
const wsService = new WSMessageService();
const PORT = process.env.PORT || 3000;

wsService.getServer().listen(PORT, () => {
    console.log(`[Server] WebSocket消息服务已启动，监听端口: ${PORT}`);
    console.log(`[Server] WebSocket端点: ws://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('[Server] 收到SIGTERM信号，正在关闭...');
    wsService.stop();
    process.exit(0);
});

export { WSMessageService, WSConnection, Message };
```

### 4.2 并发指令调度器实现

```typescript
/**
 * 指令任务接口
 */
interface CommandTask {
    taskId: string;
    commandId: string;
    clientId: string;
    action: string;
    params: Record<string, any>;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
    result?: any;
    error?: string;
}

/**
 * 指令调度器配置
 */
interface SchedulerConfig {
    maxConcurrent: number;
    defaultTimeout: number;
    enablePriority: boolean;
    maxRetries: number;
}

/**
 * 并发指令调度器
 * 负责管理和调度并发执行的指令任务
 */
class CommandScheduler {
    private tasks: Map<string, CommandTask> = new Map();
    private pendingQueue: CommandTask[] = [];
    private runningTasks: Map<string, CommandTask> = new Map();
    private completedTasks: Map<string, CommandTask> = new Map();
    private config: SchedulerConfig;
    private messageService: WSMessageService;
    private taskTimer: NodeJS.Timeout | null = null;
    private taskHandlers: Map<string, (task: CommandTask) => Promise<any>> = new Map();

    constructor(messageService: WSMessageService, config?: Partial<SchedulerConfig>) {
        this.messageService = messageService;
        this.config = {
            maxConcurrent: config?.maxConcurrent || 5,
            defaultTimeout: config?.defaultTimeout || 60000,
            enablePriority: config?.enablePriority ?? true,
            maxRetries: config?.maxRetries || 3
        };

        this.startTaskProcessor();
    }

    /**
     * 注册任务处理器
     */
    public registerHandler(action: string, handler: (task: CommandTask) => Promise<any>): void {
        this.taskHandlers.set(action, handler);
        console.log(`[Scheduler] 注册处理器: ${action}`);
    }

    /**
     * 提交任务
     */
    public async submitTask(
        command: {
            commandId: string;
            action: string;
            params?: Record<string, any>;
            clientId: string;
            timeout?: number;
        }
    ): Promise<string> {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const task: CommandTask = {
            taskId,
            commandId: command.commandId,
            clientId: command.clientId,
            action: command.action,
            params: command.params || {},
            createdAt: Date.now(),
            status: 'pending'
        };

        this.tasks.set(taskId, task);

        console.log(`[Scheduler] 提交任务: ${taskId}, 动作: ${command.action}`);

        // 发送任务确认
        this.messageService.sendToClient(command.clientId, {
            id: this.generateMessageId(),
            type: 'command',
            priority: 2,
            timestamp: Date.now(),
            source: 'scheduler',
            payload: {
                event: 'task_submitted',
                taskId,
                commandId: command.commandId
            }
        });

        this.enqueueTask(task);

        return taskId;
    }

    /**
     * 取消任务
     */
    public async cancelTask(taskId: string): Promise<boolean> {
        const task = this.tasks.get(taskId);

        if (!task) {
            console.warn(`[Scheduler] 任务不存在: ${taskId}`);
            return false;
        }

        if (task.status === 'completed') {
            console.warn(`[Scheduler] 任务已完成，无法取消: ${taskId}`);
            return false;
        }

        if (task.status === 'cancelled') {
            return true;
        }

        task.status = 'cancelled';
        task.completedAt = Date.now();

        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        this.pendingQueue = this.pendingQueue.filter(t => t.taskId !== taskId);

        console.log(`[Scheduler] 任务已取消: ${taskId}`);

        this.messageService.sendToClient(task.clientId, {
            id: this.generateMessageId(),
            type: 'command',
            priority: 2,
            timestamp: Date.now(),
            source: 'scheduler',
            payload: {
                event: 'task_cancelled',
                taskId,
                commandId: task.commandId
            }
        });

        return true;
    }

    /**
     * 查询任务状态
     */
    public getTaskStatus(taskId: string): CommandTask | null {
        return this.tasks.get(taskId) || null;
    }

    /**
     * 获取所有任务
     */
    public getAllTasks(): CommandTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * 获取正在运行的任务
     */
    public getRunningTasks(): CommandTask[] {
        return Array.from(this.runningTasks.values());
    }

    /**
     * 获取待处理任务数量
     */
    public getPendingCount(): number {
        return this.pendingQueue.length;
    }

    /**
     * 入队任务
     */
    private enqueueTask(task: CommandTask): void {
        this.pendingQueue.push(task);

        if (this.config.enablePriority) {
            this.pendingQueue.sort((a, b) => {
                const taskA = this.tasks.get(a.taskId)!;
                const taskB = this.tasks.get(b.taskId)!;
                return (taskB.params?.priority || 1) - (taskA.params?.priority || 1);
            });
        }

        this.scheduleNext();
    }

    /**
     * 调度下一个任务
     */
    private scheduleNext(): void {
        if (this.runningTasks.size >= this.config.maxConcurrent) {
            return;
        }

        const task = this.pendingQueue.shift();
        if (!task) {
            return;
        }

        const currentTask = this.tasks.get(task.taskId);
        if (currentTask?.status === 'cancelled') {
            this.scheduleNext();
            return;
        }

        this.executeTask(task);
    }

    /**
     * 执行任务
     */
    private async executeTask(task: CommandTask): Promise<void> {
        task.status = 'running';
        task.startedAt = Date.now();
        this.runningTasks.set(task.taskId, task);

        console.log(`[Scheduler] 开始执行任务: ${task.taskId}`);

        const handler = this.taskHandlers.get(task.action);

        if (!handler) {
            task.status = 'failed';
            task.error = `未找到动作处理器: ${task.action}`;
            this.completeTask(task);
            return;
        }

        const timeout = task.params?.timeout || this.config.defaultTimeout;
        const timeoutTimer = setTimeout(() => {
            if (task.status === 'running') {
                this.cancelTask(task.taskId);
                task.status = 'failed';
                task.error = '任务执行超时';
                this.completeTask(task);
            }
        }, timeout);

        try {
            task.result = await handler(task);

            clearTimeout(timeoutTimer);

            if (task.status === 'cancelled') {
                return;
            }

            task.status = 'completed';
            task.completedAt = Date.now();

            console.log(`[Scheduler] 任务完成: ${task.taskId}`);

            this.messageService.sendToClient(task.clientId, {
                id: this.generateMessageId(),
                type: 'command',
                priority: 2,
                timestamp: Date.now(),
                source: 'scheduler',
                payload: {
                    event: 'task_completed',
                    taskId: task.taskId,
                    commandId: task.commandId,
                    result: task.result
                }
            });

            if (task.params?.requireAck) {
                this.sendAck(task.commandId, task.clientId, true);
            }

        } catch (error) {
            clearTimeout(timeoutTimer);

            if (task.status === 'cancelled') {
                return;
            }

            task.status = 'failed';
            task.error = (error as Error).message;
            task.completedAt = Date.now();

            console.error(`[Scheduler] 任务失败: ${task.taskId}`, error);

            this.messageService.sendToClient(task.clientId, {
                id: this.generateMessageId(),
                type: 'command',
                priority: 2,
                timestamp: Date.now(),
                source: 'scheduler',
                payload: {
                    event: 'task_failed',
                    taskId: task.taskId,
                    commandId: task.commandId,
                    error: task.error
                }
            });

            if (this.shouldRetry(task)) {
                console.log(`[Scheduler] 任务将重试: ${task.taskId}`);
                task.status = 'pending';
                task.createdAt = Date.now();
                this.enqueueTask(task);
            }
        }

        this.completeTask(task);
    }

    /**
     * 判断是否应该重试
     */
    private shouldRetry(task: CommandTask): boolean {
        const retryCount = task.params?.retryCount || 0;
        return retryCount < this.config.maxRetries && task.status === 'failed';
    }

    /**
     * 完成任务处理
     */
    private completeTask(task: CommandTask): void {
        this.runningTasks.delete(task.taskId);
        this.completedTasks.set(task.taskId, task);

        this.scheduleNext();
    }

    /**
     * 发送确认消息
     */
    private sendAck(commandId: string, clientId: string, success: boolean): void {
        this.messageService.sendToClient(clientId, {
            id: this.generateMessageId(),
            type: 'ack',
            priority: 3,
            timestamp: Date.now(),
            source: 'scheduler',
            payload: {
                commandId,
                success
            }
        });
    }

    /**
     * 生成消息ID
     */
    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 启动任务处理器
     */
    private startTaskProcessor(): void {
        this.taskTimer = setInterval(() => {
            this.scheduleNext();
        }, 100);
    }

    /**
     * 停止任务处理器
     */
    public stop(): void {
        if (this.taskTimer) {
            clearInterval(this.taskTimer);
            this.taskTimer = null;
        }

        this.pendingQueue.forEach(task => {
            task.status = 'cancelled';
        });

        this.pendingQueue = [];
        this.runningTasks.clear();
    }
}

export { CommandScheduler, CommandTask, SchedulerConfig };
```

## 五、场景使用示例

### 5.1 基础使用示例

```typescript
// 基础使用示例：创建SDK实例并连接

import {
    NotificationSDK,
    MessageType,
    MessagePriority,
    ConnectionState,
    createWebSocketSDK
} from './websocket-sdk';

// 创建SDK实例
const sdk = createWebSocketSDK({
    endpoint: 'ws://localhost:3000',
    clientId: 'client_001',
    heartbeatInterval: 30000,
    maxReconnectAttempts: 5,
    debug: true,
    autoConnect: true
});

// 监听连接状态变化
sdk.onConnectionChange((state, prevState) => {
    console.log(`连接状态变化: ${prevState} -> ${state}`);

    if (state === ConnectionState.CONNECTED) {
        console.log('✅ 已成功连接到服务器');
    } else if (state === ConnectionState.RECONNECTING) {
        console.log('🔄 正在尝试重新连接...');
    } else if (state === ConnectionState.DISCONNECTED) {
        console.log('❌ 已断开连接');
    }
});

// 监听错误
sdk.onError((error) => {
    console.error('SDK错误:', error);
});

// 订阅文本消息
sdk.subscribe([MessageType.TEXT], (message) => {
    console.log('收到文本消息:', message.payload.content);
});

// 订阅JSON消息
sdk.subscribe([MessageType.JSON], (message) => {
    console.log('收到JSON消息:', message.payload);
});

// 订阅系统消息
sdk.subscribe([MessageType.SYSTEM], (message) => {
    const { event, detail } = message.payload;

    switch (event) {
        case 'connect':
            console.log('系统: 连接成功', detail);
            break;
        case 'disconnect':
            console.log('系统: 连接断开', detail);
            break;
        case 'error':
            console.error('系统: 发生错误', detail);
            break;
    }
});

// 发送文本消息
async function sendTextMessage() {
    try {
        await sdk.sendText('你好，这是一条测试消息！');
        console.log('消息发送成功');
    } catch (error) {
        console.error('发送失败:', error);
    }
}

// 发送JSON消息
async function sendJSONMessage() {
    try {
        await sdk.sendJSON({
            action: 'update',
            data: {
                id: 123,
                name: '示例数据',
                timestamp: Date.now()
            }
        });
        console.log('JSON消息发送成功');
    } catch (error) {
        console.error('发送失败:', error);
    }
}

// 断开连接
function disconnect() {
    sdk.disconnect('用户主动断开');
}

// 释放资源
function cleanup() {
    sdk.dispose();
    console.log('SDK已释放');
}

// 执行示例操作
async function main() {
    await sdk.connect();
    await sendTextMessage();
    await sendJSONMessage();
}
```

### 5.2 指令消息使用示例

```typescript
// 指令消息使用示例：任务调度和并发控制

import {
    NotificationSDK,
    MessageType,
    MessagePriority,
    CommandAction,
    createWebSocketSDK
} from './websocket-sdk';

const sdk = createWebSocketSDK({
    endpoint: 'ws://localhost:3000',
    clientId: 'client_command_demo',
    autoConnect: true,
    debug: true
});

// 订阅指令消息
sdk.subscribe([MessageType.COMMAND], async (message) => {
    const { action, commandId, taskId, params } = message.payload;

    console.log(`收到指令: ${action}`, { commandId, taskId, params });

    switch (action) {
        case CommandAction.EXECUTE:
            await handleExecuteCommand(commandId, params);
            break;
        case CommandAction.CANCEL:
            await handleCancelCommand(taskId);
            break;
        case CommandAction.PAUSE:
            await handlePauseCommand(taskId);
            break;
        case CommandAction.RESUME:
            await handleResumeCommand(taskId);
            break;
        case CommandAction.QUERY:
            await handleQueryCommand(params?.taskId);
            break;
        case CommandAction.SYNC:
            await handleSyncCommand(params);
            break;
    }
});

// 订阅进度消息
sdk.subscribe([MessageType.PROGRESS], (message) => {
    const { taskId, progress, description } = message.payload;

    console.log(`任务进度 [${taskId}]: ${progress}%`);

    if (description) {
        console.log(`  描述: ${description}`);
    }

    updateProgressBar(taskId, progress);
});

// 订阅确认消息
sdk.subscribe([MessageType.ACKNOWLEDGE], (message) => {
    const { messageId, success } = message.payload;
    console.log(`消息确认: ${messageId}, 成功: ${success}`);
});

/**
 * 执行指令处理器
 */
async function handleExecuteCommand(commandId: string, params?: Record<string, any>) {
    console.log(`执行指令: ${commandId}`, params);

    const taskId = `task_${Date.now()}`;

    try {
        await executeTask(taskId, params);
    } catch (error) {
        console.error(`任务执行失败: ${error}`);
    }
}

/**
 * 取消指令处理器
 */
async function handleCancelCommand(taskId?: string) {
    if (!taskId) return;
    console.log(`取消任务: ${taskId}`);
    showNotification('info', `任务 ${taskId} 已取消`);
}

/**
 * 暂停指令处理器
 */
async function handlePauseCommand(taskId?: string) {
    if (!taskId) return;
    console.log(`暂停任务: ${taskId}`);
    pauseTask(taskId);
}

/**
 * 恢复指令处理器
 */
async function handleResumeCommand(taskId?: string) {
    if (!taskId) return;
    console.log(`恢复任务: ${taskId}`);
    resumeTask(taskId);
}

/**
 * 查询指令处理器
 */
async function handleQueryCommand(taskId?: string) {
    if (!taskId) return;
    const status = getTaskStatus(taskId);
    await sdk.sendJSON({ event: 'query_response', taskId, status });
}

/**
 * 同步指令处理器
 */
async function handleSyncCommand(params?: Record<string, any>) {
    console.log('收到同步请求:', params);
    const currentState = getCurrentState();
    await sdk.sendJSON({ event: 'sync_response', state: currentState });
}

/**
 * 发送执行指令
 */
async function sendExecuteCommand() {
    const commandId = await sdk.sendCommand(
        CommandAction.EXECUTE,
        {
            operation: 'data_processing',
            input: { fileId: 'file_123' },
            priority: 2
        },
        {
            taskId: 'task_demo_001',
            timeout: 60000,
            requireAck: true,
            priority: MessagePriority.HIGH
        }
    );
    console.log(`已发送执行指令: ${commandId}`);
    return commandId;
}

/**
 * 发送批量指令
 */
async function sendBatchCommands() {
    const commands = [
        { action: CommandAction.EXECUTE, params: { id: 1 } },
        { action: CommandAction.EXECUTE, params: { id: 2 } },
        { action: CommandAction.EXECUTE, params: { id: 3 } }
    ];

    const promises = commands.map(cmd =>
        sdk.sendCommand(cmd.action, cmd.params, { requireAck: true })
    );

    const results = await Promise.allSettled(promises);
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            console.log(`命令 ${index + 1} 已提交: ${result.value}`);
        } else {
            console.error(`命令 ${index + 1} 失败:`, result.reason);
        }
    });
    return results;
}

// 辅助函数
function updateProgressBar(taskId: string, progress: number) {
    const progressBar = document.getElementById(`progress-${taskId}`);
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
}

function showNotification(type: 'success' | 'error' | 'info', message: string) {
    console.log(`[通知] [${type}] ${message}`);
}

function pauseTask(taskId: string) { console.log(`暂停任务: ${taskId}`); }
function resumeTask(taskId: string) { console.log(`恢复任务: ${taskId}`); }

function getTaskStatus(taskId: string) {
    return { taskId, status: 'running', progress: 50 };
}

function getCurrentState() {
    return { tasks: [], lastSync: Date.now() };
}

// 模拟执行任务
async function executeTask(taskId: string, params?: Record<string, any>) {
    console.log(`开始执行任务 ${taskId}`);
    for (let i = 0; i <= 100; i += 10) {
        await sdk.sendJSON({
            event: 'progress',
            payload: { taskId, progress: i, description: `处理中... ${i}%` }
        });
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`任务 ${taskId} 执行完成`);
}

async function main() {
    await sdk.connect();
    await sendExecuteCommand();
    await sendBatchCommands();
}
```

### 5.3 实时聊天应用示例

```typescript
// 实时聊天应用示例

import {
    NotificationSDK,
    MessageType,
    MessagePriority,
    createWebSocketSDK
} from './websocket-sdk';

interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    timestamp: number;
    type: 'text' | 'image' | 'file' | 'system';
    metadata?: { imageUrl?: string; fileName?: string; fileSize?: number; };
}

interface User {
    id: string;
    name: string;
    avatar?: string;
    status: 'online' | 'offline' | 'busy';
}

/**
 * 聊天SDK封装
 */
class ChatSDK {
    private sdk: NotificationSDK;
    private currentUser: User;
    private currentRoom?: string;
    private messageCallbacks: Set<(message: ChatMessage) => void> = new Set();
    private typingCallbacks: Set<(data: { userId: string; isTyping: boolean }) => void> = new Set();
    private presenceCallbacks: Set<(data: { user: User; status: string }) => void> = new Set();
    private unreadCount: Map<string, number> = new Map();

    constructor(userId: string, userName: string) {
        this.currentUser = { id: userId, name: userName, status: 'online' };

        this.sdk = createWebSocketSDK({
            endpoint: 'ws://localhost:3000',
            clientId: userId,
            autoConnect: true,
            debug: true
        });

        this.setupHandlers();
    }

    private setupHandlers(): void {
        // 文本消息
        this.sdk.subscribe([MessageType.TEXT], (message) => {
            const chatMessage: ChatMessage = {
                id: message.id,
                senderId: message.source,
                senderName: message.payload.senderName || 'Unknown',
                content: message.payload.content,
                timestamp: message.timestamp,
                type: 'text'
            };

            if (message.target === this.currentRoom || !message.target) {
                this.notifyMessageCallbacks(chatMessage);
                if (message.source !== this.currentUser.id) {
                    const roomId = message.target || 'global';
                    this.incrementUnread(roomId);
                }
            }
        });

        // JSON消息（复杂消息）
        this.sdk.subscribe([MessageType.JSON], (message) => {
            const { event, data } = message.payload;

            switch (event) {
                case 'chat_message':
                    this.handleChatMessage(data);
                    break;
                case 'typing':
                    if (data.userId !== this.currentUser.id) {
                        this.typingCallbacks.forEach(cb => cb(data));
                    }
                    break;
                case 'presence':
                    this.presenceCallbacks.forEach(cb => cb(data));
                    break;
                case 'read_receipt':
                    console.log('消息已读回执:', data);
                    break;
            }
        });

        // 系统消息
        this.sdk.subscribe([MessageType.SYSTEM], (message) => {
            const { event, detail } = message.payload;
            if (event === 'connect') {
                this.reportPresence('online');
            } else if (event === 'disconnect') {
                this.reportPresence('offline');
            }
        });
    }

    private handleChatMessage(data: any): void {
        const message: ChatMessage = {
            id: data.id,
            senderId: data.senderId,
            senderName: data.senderName,
            content: data.content,
            timestamp: data.timestamp,
            type: data.type,
            metadata: data.metadata
        };
        this.notifyMessageCallbacks(message);
    }

    private notifyMessageCallbacks(message: ChatMessage): void {
        this.messageCallbacks.forEach(cb => cb(message));
    }

    private incrementUnread(roomId: string): void {
        const current = this.unreadCount.get(roomId) || 0;
        this.unreadCount.set(roomId, current + 1);
    }

    async sendMessage(content: string, targetRoom?: string): Promise<string> {
        const messageId = `msg_${Date.now()}`;
        await this.sdk.sendJSON({
            event: 'chat_message',
            data: {
                id: messageId,
                senderId: this.currentUser.id,
                senderName: this.currentUser.name,
                content,
                timestamp: Date.now(),
                type: 'text'
            },
            target: targetRoom || this.currentRoom
        });
        return messageId;
    }

    async sendTypingIndicator(isTyping: boolean, targetRoom?: string): Promise<void> {
        await this.sdk.sendJSON({
            event: 'typing',
            data: {
                userId: this.currentUser.id,
                userName: this.currentUser.name,
                isTyping,
                target: targetRoom || this.currentRoom
            }
        });
    }

    async joinRoom(roomId: string): Promise<void> {
        this.currentRoom = roomId;
        this.unreadCount.set(roomId, 0);
    }

    async leaveRoom(roomId: string): Promise<void> {
        if (this.currentRoom === roomId) {
            this.currentRoom = undefined;
        }
    }

    async reportPresence(status: 'online' | 'offline' | 'busy'): Promise<void> {
        this.currentUser.status = status;
        await this.sdk.sendJSON({
            event: 'presence',
            data: { user: this.currentUser, status }
        });
    }

    async markAsRead(messageIds: string[], roomId: string): Promise<void> {
        await this.sdk.sendJSON({
            event: 'read_receipt',
            data: { messageIds, roomId, userId: this.currentUser.id }
        });
        this.unreadCount.set(roomId, 0);
    }

    onMessage(callback: (message: ChatMessage) => void): () => void {
        this.messageCallbacks.add(callback);
        return () => this.messageCallbacks.delete(callback);
    }

    onTyping(callback: (data: { userId: string; isTyping: boolean }) => void): () => void {
        this.typingCallbacks.add(callback);
        return () => this.typingCallbacks.delete(callback);
    }

    onPresence(callback: (data: { user: User; status: string }) => void): () => void {
        this.presenceCallbacks.add(callback);
        return () => this.presenceCallbacks.delete(callback);
    }

    getUnreadCount(roomId: string): number {
        return this.unreadCount.get(roomId) || 0;
    }

    disconnect(): void {
        this.reportPresence('offline');
        this.sdk.disconnect();
    }

    dispose(): void {
        this.disconnect();
        this.messageCallbacks.clear();
        this.typingCallbacks.clear();
        this.presenceCallbacks.clear();
    }
}

// 使用示例
async function chatDemo() {
    const chat = new ChatSDK('user_001', '张三');

    chat.onMessage((message) => {
        console.log('收到消息:', message);
    });

    chat.onTyping(({ userId, isTyping }) => {
        console.log(`${userId} ${isTyping ? '正在输入...' : '停止输入'}`);
    });

    await chat.joinRoom('room_general');
    await chat.sendMessage('大家好！');

    // 模拟输入中
    await chat.sendTypingIndicator(true);
    setTimeout(() => chat.sendTypingIndicator(false), 3000);

    await chat.markAsRead(['msg_001'], 'room_general');
    console.log(`未读数: ${chat.getUnreadCount('room_general')}`);

    await chat.leaveRoom('room_general');
    chat.dispose();
}
```

## 六、项目结构

### 6.1 前端SDK项目结构

```
websocket-sdk/
├── src/
│   ├── core/
│   │   ├── connection.ts       # WebSocket连接管理器
│   │   ├── dispatcher.ts      # 事件分发器
│   │   └── queue.ts           # 消息队列
│   ├── types/
│   │   ├── message.ts         # 消息类型定义
│   │   ├── config.ts          # 配置类型定义
│   │   └── events.ts          # 事件类型定义
│   ├── sdk.ts                 # SDK主类
│   └── index.ts               # 导出入口
├── examples/
│   ├── basic.ts               # 基础使用示例
│   ├── chat.ts                # 聊天应用示例
│   └── collaboration.ts       # 协同编辑示例
├── package.json
├── tsconfig.json
└── README.md
```

### 6.2 后端服务项目结构

```
websocket-server/
├── src/
│   ├── services/
│   │   ├── ws.service.ts     # WebSocket服务
│   │   └── command.scheduler.ts # 指令调度器
│   ├── models/
│   │   ├── connection.ts      # 连接模型
│   │   └── message.ts         # 消息模型
│   ├── app.ts                # 应用入口
│   └── server.ts             # 服务器启动
├── package.json
├── tsconfig.json
└── README.md
```

## 七、总结与扩展

### 7.1 WebSocket与SSE对比

WebSocket与SSE各有优劣，选择时应根据实际需求决定。WebSocket的优势在于真正的双向通信、低延迟、适合高频数据交换；而SSE的优势在于简单易用、自动重连、基于HTTP协议易于穿透防火墙。本SDK同时支持两种协议，开发者可以根据场景灵活选择。

### 7.2 核心设计要点

本SDK的核心设计包括：模块化架构使各组件独立可测试；强类型定义确保消息传递的安全性；自动重连与心跳检测保证连接可靠性；消息队列支持离线场景；指令调度器实现并发控制。

### 7.3 扩展方向

未来可以在以下方向进行扩展：支持二进制协议以提高传输效率；添加消息加密功能；实现消息持久化和历史查询；支持负载均衡集群部署；添加详细的监控和指标收集功能。
