import { CommandAction, MessagePriority } from "@soratani-code/notification-sdk";

type MessageSendCardProps = {
  canOperateSdk: boolean;
  canUseSdk: boolean;
  priorityList: MessagePriority[];
  commandActionList: CommandAction[];
  messageTarget: string;
  messagePriority: MessagePriority;
  textContent: string;
  jsonContent: string;
  commandAction: CommandAction;
  commandTaskId: string;
  commandTimeout: number;
  requireAck: boolean;
  commandParams: string;
  taskQueryId: string;
  onMessageTargetChange: (value: string) => void;
  onMessagePriorityChange: (value: MessagePriority) => void;
  onTextContentChange: (value: string) => void;
  onJsonContentChange: (value: string) => void;
  onCommandActionChange: (value: CommandAction) => void;
  onCommandTaskIdChange: (value: string) => void;
  onCommandTimeoutChange: (value: number) => void;
  onRequireAckChange: (value: boolean) => void;
  onCommandParamsChange: (value: string) => void;
  onTaskQueryIdChange: (value: string) => void;
  onSendText: () => Promise<void>;
  onSendJson: () => Promise<void>;
  onSendCommand: () => Promise<void>;
  onQueryProgress: () => Promise<void>;
  onCancelTask: () => Promise<void>;
};

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

export function MessageSendCard(props: MessageSendCardProps) {
  return (
    <section className="card message-card">
      <h2>消息发送</h2>
      <div className="form-grid two-col">
        <label>
          Target (可选)
          <input value={props.messageTarget} onChange={(event) => props.onMessageTargetChange(event.target.value)} />
        </label>
        <label>
          Priority
          <select
            value={props.messagePriority}
            onChange={(event) => props.onMessagePriorityChange(Number(event.target.value) as MessagePriority)}
          >
            {props.priorityList.map((item) => (
              <option key={item} value={item}>
                {getPriorityLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="subsection">
        <h3>发送 TEXT</h3>
        <textarea value={props.textContent} onChange={(event) => props.onTextContentChange(event.target.value)} rows={3} />
        <div className="action-row">
          <button className="btn primary" onClick={() => void props.onSendText()} disabled={!props.canOperateSdk || !props.canUseSdk}>
            发送文本
          </button>
        </div>
      </div>

      <div className="subsection">
        <h3>发送 JSON</h3>
        <textarea value={props.jsonContent} onChange={(event) => props.onJsonContentChange(event.target.value)} rows={6} />
        <div className="action-row">
          <button className="btn primary" onClick={() => void props.onSendJson()} disabled={!props.canOperateSdk || !props.canUseSdk}>
            发送 JSON
          </button>
        </div>
      </div>

      <div className="subsection">
        <h3>发送 COMMAND</h3>
        <div className="form-grid two-col">
          <label>
            Action
            <select value={props.commandAction} onChange={(event) => props.onCommandActionChange(event.target.value as CommandAction)}>
              {props.commandActionList.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Task ID
            <input value={props.commandTaskId} onChange={(event) => props.onCommandTaskIdChange(event.target.value)} />
          </label>
          <label>
            Timeout (ms)
            <input
              type="number"
              min={1000}
              value={props.commandTimeout}
              onChange={(event) => props.onCommandTimeoutChange(Number(event.target.value) || 0)}
            />
          </label>
          <label className="toggle-row compact">
            <input type="checkbox" checked={props.requireAck} onChange={(event) => props.onRequireAckChange(event.target.checked)} />
            requireAck
          </label>
        </div>
        <textarea value={props.commandParams} onChange={(event) => props.onCommandParamsChange(event.target.value)} rows={6} />
        <div className="action-row">
          <button className="btn primary" onClick={() => void props.onSendCommand()} disabled={!props.canOperateSdk || !props.canUseSdk}>
            发送命令
          </button>
        </div>
      </div>

      <div className="subsection">
        <h3>任务控制快捷入口</h3>
        <div className="form-grid two-col">
          <label>
            Task ID
            <input value={props.taskQueryId} onChange={(event) => props.onTaskQueryIdChange(event.target.value)} />
          </label>
        </div>
        <div className="action-row">
          <button className="btn" onClick={() => void props.onQueryProgress()} disabled={!props.canOperateSdk || !props.canUseSdk}>
            查询进度
          </button>
          <button className="btn" onClick={() => void props.onCancelTask()} disabled={!props.canOperateSdk || !props.canUseSdk}>
            取消任务
          </button>
        </div>
      </div>
    </section>
  );
}
