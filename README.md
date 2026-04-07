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

## Build

npm run build

## API

Main exports:

- NotificationSDK
- createWebSocketSDK
- WebSocketConnectionManager
- MessageQueueManager
- EventDispatcher
- MessageType, MessagePriority, CommandAction, ConnectionState
- all public TypeScript interfaces and types
