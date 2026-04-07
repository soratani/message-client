# React + Vite Demo for @soratani-code/notification-sdk

## Run

```bash
npm --prefix /Users/a148017/project/message-client/examples/react-vite-demo install
npm --prefix /Users/a148017/project/message-client/examples/react-vite-demo run dev
```

## Build

```bash
npm --prefix /Users/a148017/project/message-client/examples/react-vite-demo run build
```

## Included Features

- SDK initialization with configurable endpoint/clientId/authToken
- Connect / disconnect / reconnect / dispose controls
- Message send panel:
  - Text message
  - JSON message
  - Command message (action/params/taskId/timeout/requireAck)
  - Query progress / cancel task shortcuts
- Subscription management:
  - Toggle subscription types
  - Re-apply subscription setup
  - subscribeOnce for the next SYSTEM message
- Runtime dashboard:
  - Connection and queue stats
  - Dispatcher stats and subscriber count
- Log stream and message history with filtering
- Responsive modern UI, desktop and mobile friendly

## Notes

- This demo resolves `@soratani-code/notification-sdk` to local source via Vite alias:
  - `../../src/index.ts`
- You need a Socket.IO server endpoint compatible with SDK protocol to observe full behavior.
