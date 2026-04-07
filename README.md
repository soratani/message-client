# @soratani-code/notification-sdk

A TypeScript WebSocket notification SDK with:

- typed message protocol
- auto reconnect with exponential backoff
- heartbeat ping/pong checks
- in-memory priority queue for offline sending
- message event dispatcher

## Install

npm install @soratani-code/notification-sdk

## Quick start

```ts
import {
  createWebSocketSDK,
  MessageType,
  ConnectionState
} from '@soratani-code/notification-sdk';

const sdk = createWebSocketSDK({
  endpoint: 'ws://localhost:3000',
  clientId: 'client_001',
  autoConnect: true,
  debug: true
});

sdk.onConnectionChange((state, prev) => {
  if (state === ConnectionState.CONNECTED) {
    console.log('connected');
  }
  console.log('state change', prev, state);
});

sdk.subscribe([MessageType.TEXT], (message) => {
  console.log('text message:', message.payload);
});

await sdk.sendText('hello');
```

## 服务端对接约定

为保证 SDK 与 `nodejs-socket-optimization.md`、`WebSocket_Message_Notification_SDK.md` 的方案一致，服务端建议遵循以下协议约定。

### 1) 连接与传输

- SDK 使用 `socket.io-client`，默认发送事件名为 `message`。
- 所有出站消息默认使用 MessagePack 编码（二进制帧）。
- 服务端入站需支持两种形态：
  - 单条消息对象（Message）
  - 批量消息对象 `{ messages, count, timestamp }`

### 2) 批量消息（batch）

- 当 `messageBatch.enabled=true` 且消息优先级低于 `HIGH` 时，SDK 会聚合后发送到 `messageBatch.eventName`（默认 `batch_messages`）。
- 批量载荷结构如下：

```ts
{
  messages: Message[],
  count: number,
  timestamp: number
}
```

- 服务端可统一按批解析后逐条路由或落库。

### 3) ACK 语义

- SDK 对命令消息（`type=command` 且 `requireAck!==false`）进行可靠投递跟踪。
- 服务端 ACK 消息类型应为 `type=ack`，`payload` 支持以下两种关联方式：
  - `payload.messageId`: 直接确认某条消息
  - `payload.commandId`: 确认某个命令（SDK 会映射回原始消息）
- ACK 结构建议：

```ts
{
  type: "ack",
  payload: {
    success: boolean,
    messageId?: string,
    commandId?: string,
    detail?: string
  }
}
```

### 4) 超时与重试

- 若未在超时窗口内收到 ACK，SDK 会触发 `onTimeout` 并将消息按退避策略重试。
- 超时窗口优先级：
  - 命令级 `payload.timeout`
  - 全局配置 `ackTimeout`（默认 30000ms）
- pending 扫描频率由 `pendingSweepInterval` 控制（默认 1000ms）。
- 发送失败重入队会递增 `retryCount`，并按退避延迟再次可消费。

### 5) 重连后的 pending 恢复

- 连接恢复后，SDK 会将 pending 中未确认消息重新转入重试流程，避免消息长期悬挂。
- 服务端需保证 ACK 幂等：重复 ACK 不应导致副作用。

### 6) 心跳约定

- SDK 会主动发送 `ping`，并处理 `pong`。
- 若服务端发送 `ping`，SDK 也会自动回 `pong`。
- 推荐服务端支持 ping/pong 透传，避免代理层导致的空闲断连。

### 7) 配置建议

```ts
const sdk = createWebSocketSDK({
  endpoint: "wss://your-host/socket.io",
  clientId: "client_001",
  ackTimeout: 30000,
  pendingSweepInterval: 1000,
  messageBatch: {
    enabled: true,
    eventName: "batch_messages",
    maxBatchSize: 100,
    flushInterval: 50
  }
});
```

- 如需自定义 Socket.IO 参数，使用 `socketIOOptions`。
- Header 注入请使用 `headers` 字段，`socketIOOptions` 不接收 `extraHeaders`。

## Build

npm run build

## API

Main exports:

- NotificationSDK
- createWebSocketSDK
- ConnectionManager
- MessageQueueManager
- EventDispatcher
- MessageType, MessagePriority, CommandAction, ConnectionState
- all public TypeScript interfaces and types
