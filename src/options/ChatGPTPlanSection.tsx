import { useRef, useState } from "react";
import type { OptionsClient, OptionsConfig, ChatGPTPlanAuthStatus, ChatGPTPlanModel } from "./client";
import { useOptionsI18n } from "./LocaleContext";

type Props = { config: OptionsConfig; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void; client: Pick<OptionsClient, "chatGPTPlanAction"> };
type ViewState = { status: ChatGPTPlanAuthStatus | null; models: ChatGPTPlanModel[]; message: string; error: boolean; busy: boolean };
type AuthAction = "connect" | "add";

export function ChatGPTPlanSection({ config, disabled, update, client }: Props) {
  const i18n = useOptionsI18n();
  const [view, setView] = useState<ViewState>({ status: null, models: [], message: i18n.t("options.chatgptPlan.notChecked"), error: false, busy: false });
  const [authAction, setAuthAction] = useState<AuthAction | null>(null);
  const operation = useRef(0);

  async function refresh() {
    const current = ++operation.current;
    let status: ChatGPTPlanAuthStatus | null = null;
    setView(value => ({ ...value, busy: true, models: [], message: i18n.t("options.chatgptPlan.checking"), error: false }));
    try {
      const response = await client.chatGPTPlanAction("status");
      status = normalizeStatus(response.status);
      if (current !== operation.current) return;
      if (!status?.connected) {
        setView({ status, models: [], busy: false, error: false,
          message: i18n.t("options.chatgptPlan.disconnected") });
        return;
      }
      if (!status.canInfer) {
        setView({ status, models: [], busy: false, error: false, message: i18n.t("options.chatgptPlan.accessUnavailable") });
        return;
      }
      const result = await client.chatGPTPlanAction("models");
      if (current !== operation.current) return;
      const models = normalizeModels(result.models);
      setView({ status, models, busy: false, error: false,
        message: i18n.t("options.chatgptPlan.connected", { storage: status.storage }) });
      if (config.chatgptPlanModel && !models.some(model => model.slug === config.chatgptPlanModel)) update({ chatgptPlanModel: "" });
    } catch (error) {
      if (current !== operation.current) return;
      const code = String((error as { code?: string })?.code || "");
      setView({ status: status || statusForError(code), models: [], busy: false, error: true, message: describeError(code, i18n) });
    }
  }

  async function connect(event: React.MouseEvent<HTMLButtonElement>, addAccount = false) {
    if (!event.nativeEvent.isTrusted || chatGPTSignInActionDisabled(disabled, view.busy, Boolean(authAction))) return;
    const current = ++operation.current;
    setAuthAction(addAccount ? "add" : "connect");
    setView(value => ({ ...value, status: null, models: [], busy: true, error: false, message: i18n.t("options.chatgptPlan.connecting") }));
    try {
      const result = await client.chatGPTPlanAction(addAccount ? "add" : "connect");
      if (result.modelSelectionCleared) update({ chatgptPlanModel: "" });
      if (current !== operation.current) return;
      setAuthAction(null);
      setView(value => ({ ...value, busy: false, message: i18n.t("options.chatgptPlan.loadingModels"), error: false }));
      await refresh();
    } catch (error) {
      if (current !== operation.current) return;
      setAuthAction(null);
      const code = String((error as { code?: string })?.code || "");
      if ((error as { modelSelectionCleared?: boolean })?.modelSelectionCleared) update({ chatgptPlanModel: "" });
      setView({ status: statusForError(code), models: [], busy: false, error: true, message: describeError(code, i18n) });
    }
  }

  async function selectAccount(accountId: string) {
    if (!accountId || accountId === view.status?.activeAccountId || disabled || view.busy) return;
    const current = ++operation.current;
    setView(value => ({ ...value, models: [], busy: true, error: false, message: i18n.t("options.chatgptPlan.switching") }));
    try {
      const result = await client.chatGPTPlanAction("select", accountId);
      if (result.modelSelectionCleared) update({ chatgptPlanModel: "" });
      if (current !== operation.current) return;
      await refresh();
    } catch (error) {
      if (current !== operation.current) return;
      const code = String((error as { code?: string })?.code || "");
      setView(value => ({ ...value, busy: false, error: true, message: describeError(code, i18n) }));
    }
  }

  async function logout(event: React.MouseEvent<HTMLButtonElement>) {
    if (!event.nativeEvent.isTrusted || disabled || view.busy) return;
    const current = ++operation.current;
    setView(value => ({ ...value, busy: true, message: i18n.t("options.chatgptPlan.signingOut"), error: false }));
    try {
      const result = await client.chatGPTPlanAction("logout");
      if (current !== operation.current) return;
      if (result.modelSelectionCleared) update({ chatgptPlanModel: "" });
      setView(value => ({ status: value.status ? { ...value.status, connected: false, canInfer: false,
        accounts: (value.status.accounts || []).map(account => account.id === value.status?.activeAccountId ? { ...account, connected: false } : account) } :
        { connected: false, canInfer: false, storage: "", accounts: [] }, models: [], busy: false, error: false,
        message: result.revocationConfirmed ? i18n.t("options.chatgptPlan.signedOut") : i18n.t("options.chatgptPlan.signedOutUnconfirmed") }));
    } catch (error) {
      if (current !== operation.current) return;
      const code = String((error as { code?: string })?.code || "");
      setView(value => ({ ...value, busy: false, error: true, message: describeError(code, i18n) }));
    }
  }

  const available = view.models.some(model => model.slug === config.chatgptPlanModel);
  return <section className="advanced" aria-labelledby="chatgpt-plan-title">
    <h2 id="chatgpt-plan-title">{i18n.t("options.chatgptPlan.title")}</h2>
    <p className="section-summary">{i18n.t("options.chatgptPlan.summary")}</p>
    <p className={`notice${view.error ? " error" : ""}`} role="status" aria-live="polite">{view.message}</p>
    {Boolean(view.status?.accounts?.length) && <>
      <label htmlFor="chatgptPlanAccount">{i18n.t("options.chatgptPlan.account")}</label>
      <select id="chatgptPlanAccount" disabled={disabled || view.busy} value={view.status?.activeAccountId || ""}
        onChange={event => void selectAccount(event.target.value)}>
        {view.status?.accounts.map(account => <option key={account.id} value={account.id}>
          {account.label}{account.connected ? "" : ` · ${i18n.t("options.chatgptPlan.signedOutAccount")}`}
        </option>)}
      </select>
    </>}
    {view.status?.expiresAt && <p className="hint">{i18n.t("options.chatgptPlan.expires", { date: formatDate(view.status.expiresAt) })}</p>}
    <label htmlFor="chatgptPlanModel">{i18n.t("options.provider.model")}</label>
    <select id="chatgptPlanModel" disabled={disabled || view.busy || !view.models.length} value={config.chatgptPlanModel}
      onChange={event => update({ chatgptPlanModel: event.target.value })}>
      <option value="">{i18n.t("options.chatgptPlan.chooseModel")}</option>
      {config.chatgptPlanModel && !available && <option value={config.chatgptPlanModel}>{i18n.t("options.chatgptPlan.staleModel", { model: config.chatgptPlanModel })}</option>}
      {view.models.map(model => <option key={model.slug} value={model.slug}>{model.displayName} · {model.slug}</option>)}
    </select>
    <p className="hint">{i18n.t("options.chatgptPlan.modelHelp")}</p>
    <div className="actions">
      <button type="button" disabled={disabled || view.busy} onClick={() => void refresh()}>{i18n.t("options.chatgptPlan.check")}</button>
      <button type="button" disabled={chatGPTSignInActionDisabled(disabled, view.busy, Boolean(authAction))}
        onClick={event => void connect(event, authAction === "add")}>
        {i18n.t(authAction === "add" ? "options.chatgptPlan.retryAddAccount" : authAction === "connect" ? "options.chatgptPlan.retryConnect" : "options.chatgptPlan.connect")}
      </button>
      <button type="button" disabled={disabled || view.busy} onClick={event => void connect(event, true)}>{i18n.t("options.chatgptPlan.addAccount")}</button>
      {view.status?.connected && <button type="button" disabled={disabled || view.busy} onClick={event => void logout(event)}>{i18n.t("options.chatgptPlan.signOut")}</button>}
    </div>
  </section>;
}

export function chatGPTSignInActionDisabled(disabled: boolean, busy: boolean, authPending: boolean): boolean {
  return disabled || (busy && !authPending);
}

function normalizeModels(value: unknown): ChatGPTPlanModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatGPTPlanModel => Boolean(item) && typeof item === "object" &&
    typeof item.slug === "string" && item.slug.length > 0 && typeof item.displayName === "string" && item.displayName.length > 0);
}

function normalizeStatus(value: ChatGPTPlanAuthStatus | undefined): ChatGPTPlanAuthStatus | null {
  if (!value) return null;
  return { ...value, accounts: Array.isArray(value.accounts) ? value.accounts : [] };
}

function statusForError(code: string): ChatGPTPlanAuthStatus | null {
  if (code === "RECONNECT_REQUIRED") return { connected: true, canInfer: false, storage: "", accounts: [] };
  return null;
}

function describeError(code: string, i18n: ReturnType<typeof useOptionsI18n>): string {
  const keys: Record<string, string> = {
    NATIVE_MESSAGING_PERMISSION: "options.chatgptPlan.permissionMissing",
    NATIVE_MESSAGING_UNAVAILABLE: "options.chatgptPlan.permissionMissing",
    NATIVE_HOST_UNAVAILABLE: "options.chatgptPlan.hostMissing",
    NATIVE_HOST_DISCONNECTED: "options.chatgptPlan.hostMissing",
    NATIVE_HOST_TIMEOUT: "options.chatgptPlan.hostMissing",
    HOST_BUSY: "options.chatgptPlan.hostBusy",
    authorization_timeout: "options.chatgptPlan.authTimeout",
    authorization_denied: "options.chatgptPlan.authDenied",
    authorization_failed: "options.chatgptPlan.authFailed",
    callback_unavailable: "options.chatgptPlan.authFailed",
    auth_start_failed: "options.chatgptPlan.authFailed",
    invalid_callback: "options.chatgptPlan.authFailed",
    state_mismatch: "options.chatgptPlan.authFailed",
    registration_incomplete: "options.chatgptPlan.authFailed",
    client_id_mismatch: "options.chatgptPlan.authFailed",
    token_exchange_failed: "options.chatgptPlan.authFailed",
    browser_unavailable: "options.chatgptPlan.browserUnavailable",
    credential_locked: "options.chatgptPlan.credentialLocked",
    credential_unavailable: "options.chatgptPlan.credentialUnavailable",
    account_mismatch: "options.chatgptPlan.accountMismatch",
    INFERENCE_INCOMPLETE: "options.chatgptPlan.inferenceIncomplete",
    INFERENCE_FAILED: "options.chatgptPlan.inferenceFailed",
    RECONNECT_REQUIRED: "options.chatgptPlan.reconnectRequired",
    NOT_CONNECTED: "options.chatgptPlan.disconnected",
    MISSING_SCOPE: "options.chatgptPlan.scopeMissing",
    MODELS_UNAVAILABLE: "options.chatgptPlan.modelsFailed",
    ACCOUNT_NOT_FOUND: "options.chatgptPlan.accountMissing",
    CHATGPT_ACCOUNT_INVALID: "options.chatgptPlan.accountInvalid"
  };
  const key = keys[code] || "options.chatgptPlan.actionFailed";
  return i18n.t(key as Parameters<typeof i18n.t>[0]);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
