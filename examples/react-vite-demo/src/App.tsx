import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandAction,
  ConnectionState,
  MessagePriority,
  MessageType,
  NotificationSDK,
  createWebSocketSDK,
  type Message,
  type WebSocketSDKConfig
} from "@soratani-code/notification-sdk";

type SDKStats = ReturnType<NotificationSDK["getStats"]>;
type LogLevel = "info" | "warn" | "error" | "sent" | "recv";

type LogItem = {
  id: string;
  level: LogLevel;
  message: string;
  time: number;
};

type ConfigForm = {
  endpoint: string;
  clientId: string;
  authToken: string;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  maxReconnectAttempts: number;
  reconnectBaseDelay: number;
  reconnectMaxDelay: number;
  connectionTimeout: number;
  messageQueueSize: number;
  debug: boolean;
};

const messageTypeList: MessageType[] = Object.values(MessageType) as MessageType[];
const commandActionList: CommandAction[] = Object.values(CommandAction) as CommandAction[];
const priorityList: MessagePriority[] = [
  MessagePriority.LOW,
  MessagePriority.NORMAL,
  MessagePriority.HIGH,
  MessagePriority.CRITICAL
];

const initialConfig: ConfigForm = {
  endpoint: "ws://localhost:3000",
  clientId: "react_demo_client",
  authToken: "",
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  connectionTimeout: 10000,
  messageQueueSize: 100,
  debug: true
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonText(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getStateLabel(state: ConnectionState): string {
  if (state === ConnectionState.CONNECTED) {
    return "已连接";
  }
  if (state === ConnectionState.CONNECTING) {
    return "连接中";
  }
  if (state === ConnectionState.RECONNECTING) {
    return "重连中";
  }
  if (state === ConnectionState.ERROR) {
    return "错误";
  }
  return "未连接";
}

function getPriorityLabel(priority: MessagePriority): string {
  if (priority === MessagePriority.LOW) {
    return "LOW";
  }
  if (priority === MessagePriority.NORMAL) {
    return "NORMAL";
  }
  if (priority === MessagePriority.HIGH) {
    return "HIGH";
  }
  return "CRITICAL";
}

export default function App() {
  const sdkRef = useRef<NotificationSDK | null>(null);
  const stateDisposerRef = useRef<(() => void) | null>(null);
  const errorDisposerRef = useRef<(() => void) | null>(null);
  const subscriptionRef = useRef<string | null>(null);

  const [config, setConfig] = useState<ConfigForm>(initialConfig);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<SDKStats | null>(null);

  const [textContent, setTextContent] = useState("你好，这是一条来自 React 示例页面的消息。");
  const [jsonContent, setJsonContent] = useState('{\n  "scene": "demo",\n  "value": 42\n}');
  const [messageTarget, setMessageTarget] = useState("");
  const [messagePriority, setMessagePriority] = useState<MessagePriority>(MessagePriority.NORMAL);

  const [commandAction, setCommandAction] = useState<CommandAction>(CommandAction.EXECUTE);
  const [commandParams, setCommandParams] = useState('{\n  "task": "batch-render",\n  "size": 5\n}');
  const [commandTaskId, setCommandTaskId] = useState("task_demo_001");
  const [commandTimeout, setCommandTimeout] = useState(15000);
  const [requireAck, setRequireAck] = useState(true);

  const [taskQueryId, setTaskQueryId] = useState("task_demo_001");
  const [selectedTypes, setSelectedTypes] = useState<Record<MessageType, boolean>>(() => {
    return messageTypeList.reduce<Record<MessageType, boolean>>((acc, item) => {
      acc[item] = true;
      return acc;
    }, {} as Record<MessageType, boolean>);
  });
  const [historyFilter, setHistoryFilter] = useState<"all" | MessageType>("all");

  const canUseSdk = sdkRef.current !== null;

  const filteredMessages = useMemo(() => {
    if (historyFilter === "all") {
      return messages;
    }
    return messages.filter((item) => item.type === historyFilter);
  }, [historyFilter, messages]);

  const appendLog = (level: LogLevel, message: string): void => {
    setLogs((prev) => {
      const next: LogItem = {
        id: createId("log"),
        level,
        message,
        time: Date.now()
      };
      return [next, ...prev].slice(0, 300);
    });
  };

  const cleanupListeners = (): void => {
    if (sdkRef.current && subscriptionRef.current) {
      sdkRef.current.unsubscribe(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    if (stateDisposerRef.current) {
      stateDisposerRef.current();
      stateDisposerRef.current = null;
    }

    if (errorDisposerRef.current) {
      errorDisposerRef.current();
      errorDisposerRef.current = null;
    }
  };

  const createSdkConfig = (): WebSocketSDKConfig => {
    return {
      endpoint: config.endpoint.trim(),
      clientId: config.clientId.trim(),
      authToken: config.authToken.trim() || undefined,
      heartbeatInterval: Number(config.heartbeatInterval),
      heartbeatTimeout: Number(config.heartbeatTimeout),
      maxReconnectAttempts: Number(config.maxReconnectAttempts),
      reconnectBaseDelay: Number(config.reconnectBaseDelay),
      reconnectMaxDelay: Number(config.reconnectMaxDelay),
      connectionTimeout: Number(config.connectionTimeout),
      messageQueueSize: Number(config.messageQueueSize),
      debug: config.debug,
      autoConnect: false
    };
  };

  const subscribeWithCurrentTypes = (sdk: NotificationSDK): void => {
    if (subscriptionRef.current) {
      sdk.unsubscribe(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    const types = messageTypeList.filter((item) => selectedTypes[item]);
    if (types.length === 0) {
      appendLog("warn", "未选择任何订阅类型，已跳过订阅。");
      return;
    }

    subscriptionRef.current = sdk.subscribe(types, async (message: Message) => {
      setMessages((prev) => [message, ...prev].slice(0, 240));
      appendLog("recv", `收到消息 ${message.type} (${message.id})`);
    });

    appendLog("info", `已订阅 ${types.length} 种消息类型。`);
  };

  const createAndBindSdk = (): NotificationSDK => {
    const sdk = createWebSocketSDK(createSdkConfig());
    sdkRef.current = sdk;

    stateDisposerRef.current = sdk.onConnectionChange((next: ConnectionState, prev: ConnectionState) => {
      setConnectionState(next);
      appendLog("info", `连接状态: ${prev} -> ${next}`);
    });

    errorDisposerRef.current = sdk.onError((error: Error) => {
      appendLog("error", `连接错误: ${error.message}`);
    });

    setConnectionState(sdk.getConnectionState());
    subscribeWithCurrentTypes(sdk);
    appendLog("info", "SDK 已初始化。");
    return sdk;
  };

  const initializeSdk = (): void => {
    if (!config.endpoint.trim() || !config.clientId.trim()) {
      appendLog("error", "请先填写 endpoint 与 clientId。");
      return;
    }

    if (sdkRef.current) {
      cleanupListeners();
      sdkRef.current.dispose();
      sdkRef.current = null;
    }

    setMessages([]);
    setStats(null);
    createAndBindSdk();
  };

  const ensureSdk = (): NotificationSDK | null => {
    if (sdkRef.current) {
      return sdkRef.current;
    }

    if (!config.endpoint.trim() || !config.clientId.trim()) {
      appendLog("error", "SDK 尚未初始化，且 endpoint/clientId 为空。");
      return null;
    }

    return createAndBindSdk();
  };

  const connectNow = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      appendLog("info", "开始连接...");
      await sdk.connect();
      appendLog("info", "连接成功。");
    } catch (error) {
      const connectError = error instanceof Error ? error : new Error("连接失败");
      appendLog("error", connectError.message);
    }
  };

  const disconnectNow = (): void => {
    if (!sdkRef.current) {
      return;
    }

    sdkRef.current.disconnect("UI manual disconnect");
    appendLog("warn", "已手动断开连接。");
  };

  const reconnectNow = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      appendLog("info", "触发重连...");
      await sdk.reconnect();
      appendLog("info", "重连成功。");
    } catch (error) {
      const reconnectError = error instanceof Error ? error : new Error("重连失败");
      appendLog("error", reconnectError.message);
    }
  };

  const disposeSdk = (): void => {
    if (!sdkRef.current) {
      return;
    }

    cleanupListeners();
    sdkRef.current.dispose();
    sdkRef.current = null;
    setConnectionState(ConnectionState.DISCONNECTED);
    setStats(null);
    appendLog("warn", "SDK 已销毁。");
  };

  const sendTextMessage = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      await sdk.sendText(textContent, {
        target: messageTarget.trim() || undefined,
        priority: messagePriority
      });
      appendLog("sent", `发送 TEXT 成功 (priority=${getPriorityLabel(messagePriority)})`);
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("发送文本失败");
      appendLog("error", sendError.message);
    }
  };

  const sendJsonMessage = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      const payload = parseJsonText(jsonContent);
      await sdk.sendJSON(payload, {
        target: messageTarget.trim() || undefined,
        priority: messagePriority
      });
      appendLog("sent", `发送 JSON 成功 (priority=${getPriorityLabel(messagePriority)})`);
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("发送 JSON 失败");
      appendLog("error", sendError.message);
    }
  };

  const sendCommandMessage = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    try {
      const params = parseJsonText(commandParams) as Record<string, unknown>;
      const commandId = await sdk.sendCommand(commandAction, params, {
        taskId: commandTaskId.trim() || undefined,
        timeout: Number(commandTimeout),
        requireAck,
        priority: MessagePriority.HIGH,
        target: messageTarget.trim() || undefined
      });
      appendLog("sent", `发送 COMMAND 成功: ${commandAction}, commandId=${commandId}`);
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("发送命令失败");
      appendLog("error", sendError.message);
    }
  };

  const queryTaskProgress = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    if (!taskQueryId.trim()) {
      appendLog("warn", "请输入 taskId 再查询进度。");
      return;
    }

    try {
      await sdk.queryProgress(taskQueryId.trim());
      appendLog("sent", `已发送 QUERY 命令, taskId=${taskQueryId.trim()}`);
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("查询进度失败");
      appendLog("error", sendError.message);
    }
  };

  const cancelTask = async (): Promise<void> => {
    const sdk = ensureSdk();
    if (!sdk) {
      return;
    }

    if (!taskQueryId.trim()) {
      appendLog("warn", "请输入 taskId 再取消任务。");
      return;
    }

    try {
      await sdk.cancelTask(taskQueryId.trim());
      appendLog("sent", `已发送 CANCEL 命令, taskId=${taskQueryId.trim()}`);
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error("取消任务失败");
      appendLog("error", sendError.message);
    }
  };

  const refreshSubscription = (): void => {
    if (!sdkRef.current) {
      appendLog("warn", "SDK 未初始化，无法重置订阅。");
      return;
    }

    subscribeWithCurrentTypes(sdkRef.current);
  };

  const subscribeNextSystemMessage = (): void => {
    if (!sdkRef.current) {
      appendLog("warn", "SDK 未初始化，无法订阅一次性消息。");
      return;
    }

    sdkRef.current.subscribeOnce(MessageType.SYSTEM, async (message: Message) => {
      appendLog("recv", `一次性订阅收到 SYSTEM 消息: ${message.id}`);
      setMessages((prev) => [message, ...prev].slice(0, 240));
    });

    appendLog("info", "已开启下一条 SYSTEM 消息的一次性订阅。");
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (!sdkRef.current) {
        return;
      }

      setStats(sdkRef.current.getStats());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupListeners();
      sdkRef.current?.dispose();
      sdkRef.current = null;
    };
  }, []);

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="hero-eyebrow">Vite + React Integration Demo</p>
          <h1>WebSocket Notification SDK 控制台</h1>
          <p className="hero-subtitle">
            一页完整演示连接管理、消息发送、命令控制、订阅策略和运行时统计，便于直接作为业务项目接入模板。
          </p>
        </div>
        <div className="status-tile">
          <p className="status-label">连接状态</p>
          <p className={`status-value state-${connectionState}`}>{getStateLabel(connectionState)}</p>
          <p className="status-hint">SDK {canUseSdk ? "已初始化" : "未初始化"}</p>
        </div>
      </header>

      <main className="grid-layout">
        <section className="card config-card">
          <h2>连接配置</h2>
          <div className="form-grid two-col">
            <label>
              Endpoint
              <input
                value={config.endpoint}
                onChange={(event) => setConfig((prev) => ({ ...prev, endpoint: event.target.value }))}
                placeholder="ws://localhost:3000"
              />
            </label>
            <label>
              Client ID
              <input
                value={config.clientId}
                onChange={(event) => setConfig((prev) => ({ ...prev, clientId: event.target.value }))}
                placeholder="react_demo_client"
              />
            </label>
            <label>
              Auth Token
              <input
                value={config.authToken}
                onChange={(event) => setConfig((prev) => ({ ...prev, authToken: event.target.value }))}
                placeholder="可选"
              />
            </label>
            <label>
              Connection Timeout (ms)
              <input
                type="number"
                min={1000}
                value={config.connectionTimeout}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, connectionTimeout: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Heartbeat Interval (ms)
              <input
                type="number"
                min={1000}
                value={config.heartbeatInterval}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, heartbeatInterval: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Heartbeat Timeout (ms)
              <input
                type="number"
                min={1000}
                value={config.heartbeatTimeout}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, heartbeatTimeout: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Max Reconnect Attempts
              <input
                type="number"
                min={1}
                value={config.maxReconnectAttempts}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, maxReconnectAttempts: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Queue Size
              <input
                type="number"
                min={10}
                value={config.messageQueueSize}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, messageQueueSize: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Reconnect Base Delay (ms)
              <input
                type="number"
                min={100}
                value={config.reconnectBaseDelay}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, reconnectBaseDelay: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              Reconnect Max Delay (ms)
              <input
                type="number"
                min={500}
                value={config.reconnectMaxDelay}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, reconnectMaxDelay: Number(event.target.value) || 0 }))
                }
              />
            </label>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={config.debug}
              onChange={(event) => setConfig((prev) => ({ ...prev, debug: event.target.checked }))}
            />
            启用 SDK Debug 输出
          </label>

          <div className="action-row">
            <button className="btn primary" onClick={initializeSdk}>初始化 SDK</button>
            <button className="btn" onClick={() => void connectNow()} disabled={!config.endpoint || !config.clientId}>
              连接
            </button>
            <button className="btn" onClick={disconnectNow} disabled={!canUseSdk}>
              断开
            </button>
            <button className="btn" onClick={() => void reconnectNow()} disabled={!canUseSdk}>
              重连
            </button>
            <button className="btn danger" onClick={disposeSdk} disabled={!canUseSdk}>
              销毁
            </button>
          </div>
        </section>

        <section className="card stats-card">
          <h2>运行状态</h2>
          <div className="kpi-grid">
            <article>
              <p>连接状态</p>
              <strong>{stats?.connection.state ?? "-"}</strong>
            </article>
            <article>
              <p>在线</p>
              <strong>{stats?.connection.isConnected ? "YES" : "NO"}</strong>
            </article>
            <article>
              <p>队列长度</p>
              <strong>{stats?.queue.queueSize ?? 0}</strong>
            </article>
            <article>
              <p>Pending</p>
              <strong>{stats?.queue.pendingSize ?? 0}</strong>
            </article>
            <article>
              <p>总分发</p>
              <strong>{stats?.dispatcher.totalDispatched ?? 0}</strong>
            </article>
            <article>
              <p>订阅者</p>
              <strong>{stats?.dispatcher.subscriberCount ?? 0}</strong>
            </article>
          </div>

          <div className="subsection">
            <h3>订阅控制</h3>
            <div className="type-list">
              {messageTypeList.map((item) => (
                <label key={item} className="chip">
                  <input
                    type="checkbox"
                    checked={selectedTypes[item]}
                    onChange={(event) =>
                      setSelectedTypes((prev) => ({
                        ...prev,
                        [item]: event.target.checked
                      }))
                    }
                  />
                  {item}
                </label>
              ))}
            </div>
            <div className="action-row">
              <button className="btn" onClick={refreshSubscription} disabled={!canUseSdk}>
                应用订阅配置
              </button>
              <button className="btn" onClick={subscribeNextSystemMessage} disabled={!canUseSdk}>
                订阅下一条 SYSTEM
              </button>
            </div>
          </div>
        </section>

        <section className="card message-card">
          <h2>消息发送</h2>
          <div className="form-grid two-col">
            <label>
              Target (可选)
              <input value={messageTarget} onChange={(event) => setMessageTarget(event.target.value)} />
            </label>
            <label>
              Priority
              <select
                value={messagePriority}
                onChange={(event) => setMessagePriority(Number(event.target.value) as MessagePriority)}
              >
                {priorityList.map((item) => (
                  <option key={item} value={item}>
                    {getPriorityLabel(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="subsection">
            <h3>发送 TEXT</h3>
            <textarea
              value={textContent}
              onChange={(event) => setTextContent(event.target.value)}
              rows={3}
            />
            <div className="action-row">
              <button className="btn primary" onClick={() => void sendTextMessage()} disabled={!canUseSdk}>
                发送文本
              </button>
            </div>
          </div>

          <div className="subsection">
            <h3>发送 JSON</h3>
            <textarea
              value={jsonContent}
              onChange={(event) => setJsonContent(event.target.value)}
              rows={6}
            />
            <div className="action-row">
              <button className="btn primary" onClick={() => void sendJsonMessage()} disabled={!canUseSdk}>
                发送 JSON
              </button>
            </div>
          </div>

          <div className="subsection">
            <h3>发送 COMMAND</h3>
            <div className="form-grid two-col">
              <label>
                Action
                <select
                  value={commandAction}
                  onChange={(event) => setCommandAction(event.target.value as CommandAction)}
                >
                  {commandActionList.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Task ID
                <input
                  value={commandTaskId}
                  onChange={(event) => setCommandTaskId(event.target.value)}
                />
              </label>
              <label>
                Timeout (ms)
                <input
                  type="number"
                  min={1000}
                  value={commandTimeout}
                  onChange={(event) => setCommandTimeout(Number(event.target.value) || 0)}
                />
              </label>
              <label className="toggle-row compact">
                <input
                  type="checkbox"
                  checked={requireAck}
                  onChange={(event) => setRequireAck(event.target.checked)}
                />
                requireAck
              </label>
            </div>
            <textarea
              value={commandParams}
              onChange={(event) => setCommandParams(event.target.value)}
              rows={6}
            />
            <div className="action-row">
              <button className="btn primary" onClick={() => void sendCommandMessage()} disabled={!canUseSdk}>
                发送命令
              </button>
            </div>
          </div>

          <div className="subsection">
            <h3>任务控制快捷入口</h3>
            <div className="form-grid two-col">
              <label>
                Task ID
                <input value={taskQueryId} onChange={(event) => setTaskQueryId(event.target.value)} />
              </label>
            </div>
            <div className="action-row">
              <button className="btn" onClick={() => void queryTaskProgress()} disabled={!canUseSdk}>
                查询进度
              </button>
              <button className="btn" onClick={() => void cancelTask()} disabled={!canUseSdk}>
                取消任务
              </button>
            </div>
          </div>
        </section>

        <section className="card log-card">
          <h2>事件日志</h2>
          <div className="action-row">
            <button className="btn" onClick={() => setLogs([])}>清空日志</button>
            <button className="btn" onClick={() => setMessages([])}>清空消息历史</button>
          </div>
          <div className="log-list">
            {logs.length === 0 ? <p className="placeholder">暂无日志</p> : null}
            {logs.map((item) => (
              <article key={item.id} className={`log-item log-${item.level}`}>
                <span>{formatTime(item.time)}</span>
                <p>{item.message}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="card history-card">
          <h2>消息历史</h2>
          <div className="form-grid one-col">
            <label>
              类型过滤
              <select
                value={historyFilter}
                onChange={(event) =>
                  setHistoryFilter(event.target.value === "all" ? "all" : (event.target.value as MessageType))
                }
              >
                <option value="all">all</option>
                {messageTypeList.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="history-list">
            {filteredMessages.length === 0 ? <p className="placeholder">暂无消息</p> : null}
            {filteredMessages.map((message) => (
              <article key={message.id} className="history-item">
                <header>
                  <strong>{message.type}</strong>
                  <span>{formatTime(message.timestamp)}</span>
                </header>
                <p>ID: {message.id}</p>
                <pre>{JSON.stringify(message.payload, null, 2)}</pre>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
