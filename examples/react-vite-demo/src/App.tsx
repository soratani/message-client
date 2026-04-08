import { useEffect, useMemo, useState } from "react";
import {
  CommandAction,
  ConnectionState,
  MessagePriority,
  MessageType,
  type Message,
  type WebSocketSDKConfig
} from "@soratani-code/notification-sdk";
import { check, login } from "./apis/auth";
import { cache } from "./apis/client";
import { ConnectionConfigCard } from "./components/ConnectionConfigCard";
import { LoginModal } from "./components/LoginModal";
import { MessageSendCard } from "./components/MessageSendCard";
import { RuntimeStatusCard } from "./components/RuntimeStatusCard";
import { useNotificationSdk, type LogLevel } from "./hooks/useNotificationSdk";

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

type LoginForm = {
  account: string;
  password: string;
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
  endpoint: "ws://localhost:3005",
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

export default function App() {
  const [config, setConfig] = useState<ConfigForm>(initialConfig);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [loginUser, setLoginUser] = useState("");
  const [loginForm, setLoginForm] = useState<LoginForm>({ account: "", password: "" });

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

  const canOperateSdk = isAuthenticated;

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

  const guardAuth = (actionLabel: string): boolean => {
    if (isAuthenticated) {
      return true;
    }

    appendLog("warn", `${actionLabel}失败：请先登录。`);
    setIsLoginOpen(true);
    return false;
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
      socketIOOptions: {
        withCredentials: true,
      },
      headers: {
        token: 'Bearer ' + config.authToken.trim(),
      },
      debug: config.debug,
      autoConnect: false
    };
  };

  const {
    canUseSdk,
    connectionState,
    stats,
    ensureSdk,
    initializeSdk,
    connectNow,
    disconnectNow,
    reconnectNow,
    disposeSdk,
    refreshSubscription,
    subscribeNextSystemMessage
  } = useNotificationSdk({
    createSdkConfig,
    selectedTypes,
    guardAuth,
    onLog: appendLog,
    onMessage: (message: Message) => {
      setMessages((prev) => [message, ...prev].slice(0, 240));
    }
  });

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

  const openLoginModal = (): void => {
    setIsLoginOpen(true);
  };

  const closeLoginModal = (): void => {
    setIsLoginOpen(false);
  };

  const handleLoginSubmit = async (): Promise<void> => {
    const account = loginForm.account.trim();
    const password = loginForm.password.trim();

    if (!account || !password) {
      appendLog("warn", "请输入账号和密码后再登录。");
      return;
    }
    await login({ account, password });
    const token = await cache.get('access_token');
    setConfig((prev) => ({
      ...prev,
      authToken: prev.authToken.trim() || token
    }));
    setIsAuthenticated(true);
    setLoginUser(account);
    setIsLoginOpen(false);
    setLoginForm((prev) => ({ ...prev, password: "" }));
    appendLog("info", `登录成功，当前用户：${account}`);
  };

  const handleLogout = (): void => {
    disposeSdk();
    setMessages([]);
    setIsAuthenticated(false);
    setLoginUser("");
    setIsLoginOpen(false);
    appendLog("warn", "已退出登录，SDK 操作已锁定。");
  };

  useEffect(() => {
    let disposed = false;

    const syncAuthState = async (): Promise<void> => {
      try {
        const result = await check();
        if (disposed) {
          return;
        }

        const token = await cache.get("access_token", "");
        const account =
          result?.data?.name ||
          "当前用户";

        setIsAuthenticated(true);
        setLoginUser(account);
        setConfig((prev) => ({
          ...prev,
          authToken: prev.authToken.trim() || token || ""
        }));
        appendLog("info", `登录状态检查成功，当前用户：${account}`);
      } catch {
        if (disposed) {
          return;
        }

        setIsAuthenticated(false);
        setLoginUser("");
        appendLog("warn", "登录状态检查失败，当前为未登录状态。");
      }
    };

    void syncAuthState();

    return () => {
      disposed = true;
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
        <div className="hero-login">
          <button
            className={`btn ${isAuthenticated ? "danger" : "primary"}`}
            onClick={isAuthenticated ? handleLogout : openLoginModal}
          >
            {isAuthenticated ? "退出" : "登录"}
          </button>
          <p>{isAuthenticated ? `已登录：${loginUser}` : "未登录：请先登录后再操作 SDK"}</p>
        </div>
        <div className="status-tile">
          <p className="status-label">连接状态</p>
          <p className={`status-value state-${connectionState}`}>{getStateLabel(connectionState)}</p>
          <p className="status-hint">
            SDK {canUseSdk ? "已初始化" : "未初始化"} · {isAuthenticated ? "已登录" : "未登录"}
          </p>
        </div>
      </header>

      <main className="grid-layout">
        <ConnectionConfigCard
          config={config}
          canOperateSdk={canOperateSdk}
          canUseSdk={canUseSdk}
          onConfigChange={setConfig}
          onInitializeSdk={initializeSdk}
          onConnect={connectNow}
          onDisconnect={disconnectNow}
          onReconnect={reconnectNow}
          onDispose={disposeSdk}
        />

        <RuntimeStatusCard
          stats={stats}
          selectedTypes={selectedTypes}
          messageTypeList={messageTypeList}
          canOperateSdk={canOperateSdk}
          canUseSdk={canUseSdk}
          onToggleType={(type, checked) =>
            setSelectedTypes((prev) => ({
              ...prev,
              [type]: checked
            }))
          }
          onRefreshSubscription={refreshSubscription}
          onSubscribeNextSystemMessage={subscribeNextSystemMessage}
        />

        <MessageSendCard
          canOperateSdk={canOperateSdk}
          canUseSdk={canUseSdk}
          priorityList={priorityList}
          commandActionList={commandActionList}
          messageTarget={messageTarget}
          messagePriority={messagePriority}
          textContent={textContent}
          jsonContent={jsonContent}
          commandAction={commandAction}
          commandTaskId={commandTaskId}
          commandTimeout={commandTimeout}
          requireAck={requireAck}
          commandParams={commandParams}
          taskQueryId={taskQueryId}
          onMessageTargetChange={setMessageTarget}
          onMessagePriorityChange={setMessagePriority}
          onTextContentChange={setTextContent}
          onJsonContentChange={setJsonContent}
          onCommandActionChange={setCommandAction}
          onCommandTaskIdChange={setCommandTaskId}
          onCommandTimeoutChange={setCommandTimeout}
          onRequireAckChange={setRequireAck}
          onCommandParamsChange={setCommandParams}
          onTaskQueryIdChange={setTaskQueryId}
          onSendText={sendTextMessage}
          onSendJson={sendJsonMessage}
          onSendCommand={sendCommandMessage}
          onQueryProgress={queryTaskProgress}
          onCancelTask={cancelTask}
        />

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
      <LoginModal
        open={isLoginOpen}
        form={loginForm}
        onClose={closeLoginModal}
        onSubmit={handleLoginSubmit}
        onFormChange={setLoginForm}
      />
    </div>
  );
}
