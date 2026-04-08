import { MessageType } from "@soratani-code/notification-sdk";
import type { SDKStats } from "../hooks/useNotificationSdk";

type RuntimeStatusCardProps = {
  stats: SDKStats | null;
  selectedTypes: Record<MessageType, boolean>;
  messageTypeList: MessageType[];
  canOperateSdk: boolean;
  canUseSdk: boolean;
  onToggleType: (type: MessageType, checked: boolean) => void;
  onRefreshSubscription: () => void;
  onSubscribeNextSystemMessage: () => void;
};

export function RuntimeStatusCard(props: RuntimeStatusCardProps) {
  return (
    <section className="card stats-card">
      <h2>运行状态</h2>
      <div className="kpi-grid">
        <article>
          <p>连接状态</p>
          <strong>{props.stats?.connection.state ?? "-"}</strong>
        </article>
        <article>
          <p>在线</p>
          <strong>{props.stats?.connection.isConnected ? "YES" : "NO"}</strong>
        </article>
        <article>
          <p>队列长度</p>
          <strong>{props.stats?.queue.queueSize ?? 0}</strong>
        </article>
        <article>
          <p>Pending</p>
          <strong>{props.stats?.queue.pendingSize ?? 0}</strong>
        </article>
        <article>
          <p>总分发</p>
          <strong>{props.stats?.dispatcher.totalDispatched ?? 0}</strong>
        </article>
        <article>
          <p>订阅者</p>
          <strong>{props.stats?.dispatcher.subscriberCount ?? 0}</strong>
        </article>
      </div>

      <div className="subsection">
        <h3>订阅控制</h3>
        <div className="type-list">
          {props.messageTypeList.map((item) => (
            <label key={item} className="chip">
              <input
                type="checkbox"
                checked={props.selectedTypes[item]}
                onChange={(event) => props.onToggleType(item, event.target.checked)}
              />
              {item}
            </label>
          ))}
        </div>
        <div className="action-row">
          <button className="btn" onClick={props.onRefreshSubscription} disabled={!props.canOperateSdk || !props.canUseSdk}>
            应用订阅配置
          </button>
          <button
            className="btn"
            onClick={props.onSubscribeNextSystemMessage}
            disabled={!props.canOperateSdk || !props.canUseSdk}
          >
            订阅下一条 SYSTEM
          </button>
        </div>
      </div>
    </section>
  );
}
