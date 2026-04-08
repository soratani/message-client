type ConnectionConfigValues = {
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

type ConnectionConfigCardProps = {
  config: ConnectionConfigValues;
  canOperateSdk: boolean;
  canUseSdk: boolean;
  onConfigChange: (updater: (prev: ConnectionConfigValues) => ConnectionConfigValues) => void;
  onInitializeSdk: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  onReconnect: () => Promise<void>;
  onDispose: () => void;
};

export function ConnectionConfigCard(props: ConnectionConfigCardProps) {
  const { config, canOperateSdk, canUseSdk } = props;

  return (
    <section className="card config-card">
      <h2>连接配置</h2>
      <div className="form-grid two-col">
        <label>
          Endpoint
          <input
            value={config.endpoint}
            onChange={(event) => props.onConfigChange((prev) => ({ ...prev, endpoint: event.target.value }))}
            placeholder="ws://localhost:3000"
          />
        </label>
        <label>
          Client ID
          <input
            value={config.clientId}
            onChange={(event) => props.onConfigChange((prev) => ({ ...prev, clientId: event.target.value }))}
            placeholder="react_demo_client"
          />
        </label>
        <label>
          Auth Token
          <input
            value={config.authToken}
            onChange={(event) => props.onConfigChange((prev) => ({ ...prev, authToken: event.target.value }))}
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
              props.onConfigChange((prev) => ({ ...prev, connectionTimeout: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, heartbeatInterval: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, heartbeatTimeout: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, maxReconnectAttempts: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, messageQueueSize: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, reconnectBaseDelay: Number(event.target.value) || 0 }))
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
              props.onConfigChange((prev) => ({ ...prev, reconnectMaxDelay: Number(event.target.value) || 0 }))
            }
          />
        </label>
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={config.debug}
          onChange={(event) => props.onConfigChange((prev) => ({ ...prev, debug: event.target.checked }))}
        />
        启用 SDK Debug 输出
      </label>

      <div className="action-row">
        <button className="btn primary" onClick={props.onInitializeSdk} disabled={!canOperateSdk}>
          初始化 SDK
        </button>
        <button
          className="btn"
          onClick={() => void props.onConnect()}
          disabled={!canOperateSdk || !config.endpoint || !config.clientId}
        >
          连接
        </button>
        <button className="btn" onClick={props.onDisconnect} disabled={!canOperateSdk || !canUseSdk}>
          断开
        </button>
        <button className="btn" onClick={() => void props.onReconnect()} disabled={!canOperateSdk || !canUseSdk}>
          重连
        </button>
        <button className="btn danger" onClick={props.onDispose} disabled={!canOperateSdk || !canUseSdk}>
          销毁
        </button>
      </div>
    </section>
  );
}
