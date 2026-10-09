# ChatGPT Plan Native Host 收口审查

**candidateHead:** `ab7e961dcbe4d9a83c77aa6b4283203d876ed1f0`

**base:** `1778776ab8fb7bdf33590762d2d8becdfe21f73e` (`origin/main`)

## 主 Agent 自查

- 从 PR #314 候选选择性整合 Go Native Messaging Host、Responses SSE 和扩展接线，没有搬入旧 Selection / Reading 混合分支。
- `chatgpt-plan` 复用现有 Provider dispatcher、effective config、缓存身份和完成提交点；只在 `response.completed` 后返回完整结果。
- token 只经过 Go Host 与系统安全存储；扩展 storage、日志、测试证据和 Native Messaging 响应都不包含 token。最终候选移除了授权 URL 的 `id_token_hint`，不把 ID token 放入浏览器 URL。
- 多账号凭据保持独立 issued client ID、host ID、身份和 token；v1 单账号记录沿既有迁移路径进入 v2，不通过清空用户数据恢复。
- Chrome MV3 可能短暂重叠 Native Messaging 进程。Host 不使用全生命周期互斥锁；PersistentStore 继续用短时状态/刷新锁和 generation 校验协调并发写。
- 同一 Host 内新的 `auth.start` 会取消并等待旧登录，再启动新流程。旧登录的工作槽可原子转交给新登录，因此 `MaxActive=1` 时也能恢复；替换路径不再在持有 server mutex 时读取 operation mutex。
- Settings 在等待授权时保存 `connect` / `add` 动作类型。重试普通登录会替换旧登录，重试添加账号仍发送 add-account；旧 Promise 由 operation generation 拒绝回写。
- 授权超时、取消、浏览器不可用、凭据存储锁定/不可用、账号不匹配和凭据/ID token 失效都有恢复提示，凭据存储文案保持跨平台。

## 准确候选验收

- `npm run validate`：PASS；Node 1214/1214、Vitest 38/38、严格类型检查和开发安装包构建通过。
- `npm run build:extension:wxt`：PASS；119 files、2,363,738 bytes。
- `npm run test:wxt:smoke`：PASS；Chrome for Testing 153.0.8010.12。
- `npm run test:e2e -- e2e/chatgpt-plan-nativehost.spec.mjs --workers=1`：PASS；实际 WXT Settings 的 Host 缺失恢复入口与窄屏流程通过。
- `go -C native-host test -race ./...`：PASS；执行前清除 Go test cache，覆盖满容量登录接管和凭据协调回归。
- WXT 产物 fingerprint 记录在 `acceptance.json`。
- clean candidate Host 已安装；Go build metadata 为 `vcs.revision=ab7e961dcbe4d9a83c77aa6b4283203d876ed1f0`、`vcs.modified=false`，安装器保留既有凭据。
- 本机 Native Messaging `hello` / `auth.status` 脱敏探针：PASS；协议 1、单账号连接有效、`system-secure`、可推理。

逐项耗时、退出码、本地日志 hash、真实用户流程与限制记录在 `acceptance.json`。

## 真实使用证据与边界

- 单账号真实模型列表、GPT-6-Luna 选择、两次唯一文本推理、退出撤销和 fresh authorization 后重连：PASS。安全截图不含账号信息；包含账号信息的原始截图未上传、未入库。
- 一次 OpenAI consent 提交长时间无回调，取消后页面显示 `invalid_auth_step`。当时本机回调监听器健康；现有证据只支持第三方授权步骤失效，不支持更具体归因。
- 多账号添加/切换：`NOT_RUN`（用户选择跳过）。
- 完整浏览器重启后的恢复、Windows 实机、固定发布扩展 ID：`NOT_RUN`。
- 最终候选提示已构建并加载。为避免再次破坏成功会话，没有在真实 OpenAI 页主动制造第二次 stalled consent；该异常视觉状态为 `NOT_RUN`，状态和重试行为由 React 单测、Go 并发回归与构建覆盖。

## 独立审查

- 首轮只读独立审查在 `45c06ee884320540d9caca5ce12b4f18aa4c3d00` 发现三个阻断项：锁顺序、满容量登录替换、添加账号重试模式；另建议移除 `id_token_hint` 并补充可操作错误文案。
- 对 `45c06ee..10e3b67` 的有限增量复审结论为通过、无阻断；确认三个阻断项和 `id_token_hint` 已修复。审查者建议的剩余非阻断文案缺口已在最终候选补齐，并对最终候选重新执行全部规定检查。
- 对 `10e3b67..ab7e961` 的最终两文件增量复审结论为通过、无新阻断；结论明确绑定 `ab7e961dcbe4d9a83c77aa6b4283203d876ed1f0`。
- 跨 Host 同时存在多个主动 port 的登录协调未做平台实测，记录为 `NOT_VERIFIED`；普通 `connectNative()` 生命周期下没有证据表明它是当前阻断。
