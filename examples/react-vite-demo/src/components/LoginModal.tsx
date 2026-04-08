type LoginFormValue = {
  account: string;
  password: string;
};

type LoginModalProps = {
  open: boolean;
  form: LoginFormValue;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  onFormChange: (updater: (prev: LoginFormValue) => LoginFormValue) => void;
};

export function LoginModal(props: LoginModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="login-modal-mask" onClick={props.onClose}>
      <div className="login-modal" onClick={(event) => event.stopPropagation()}>
        <p className="login-modal-eyebrow">Access Control</p>
        <h2>登录 SDK 控制台</h2>
        <p>登录后即可解锁连接、发消息、订阅与命令控制能力。</p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onSubmit();
          }}
        >
          <label>
            账号
            <input
              value={props.form.account}
              onChange={(event) =>
                props.onFormChange((prev) => ({
                  ...prev,
                  account: event.target.value
                }))
              }
              placeholder="请输入账号"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={props.form.password}
              onChange={(event) =>
                props.onFormChange((prev) => ({
                  ...prev,
                  password: event.target.value
                }))
              }
              placeholder="请输入密码"
            />
          </label>
          <div className="action-row login-actions">
            <button type="button" className="btn" onClick={props.onClose}>
              取消
            </button>
            <button type="submit" className="btn primary">
              登录
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
