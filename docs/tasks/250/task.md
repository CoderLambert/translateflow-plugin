# 250 — WXT Content 模块图与临时资源桥收口

Parent：任务 191。硬依赖：248、244。本任务在 Reading Loop A–D 合入后，让 WXT 正式拥有 ISOLATED Content 的生产模块图；不迁移 Popup/Settings，不改变 MAIN/Worker 执行上下文，也不扩权限或产品范围。

## 用户与工程结果

- 普通网页仍在 `document_idle` 获得同一套 Translation、Selection、Reading、Quick Control 与 Subtitle 行为；Popup/快捷键对旧标签的发送失败恢复仍可注入并重试。
- WXT 输出稳定的编译后 Content JS/CSS，Manifest 静态注册、Popup 与 Commands 共用同一安装包路径。生产包不再逐文件复制 `src/content/**` 或根 `content.js`/`content.css`。
- Content 保持 ISOLATED classic/IIFE 运行结果、`globalThis.__TRANSLATE_FLOW_CONTENT__` 模块登记、bootstrap 幂等和既有消息/取消/权限/存储身份；React 不进入 Content。
- YouTube MAIN 三文件、六个 module Worker、认证词典资源与 locale 继续使用各自精确路径/闭包；不把整个 `src/`、public 目录或任意动态资源暴露进包。
- 旧包→新包同 ID 更新继续保留配置、缓存、OPFS、Reading 数据、权限与站点意图；旧 isolated world 失效后通过受支持的扩展 Reload/页面刷新恢复，不靠保留第二套原始 Content 产品。

## 实现边界

1. 建立单一、可审计的 Content 源模块图与 WXT content entrypoint；可从现有 classic owner 源码组合，但不得复制业务逻辑或引入 React/页面 ESM 假设。
2. 将 `CONTENT_SCRIPT_FILES` / `CONTENT_STYLE_FILES` 定义为安装包的稳定编译产物映射；源码顺序/图由独立的构建输入合同维护并由测试核对。
3. 收缩 WXT public asset bridge：移除 Content 原始源码/CSS根，只保留 MAIN、Worker、认证词典和 locale 所需精确闭包；更新生产审计、runtime mapping、fixture 与升级期望。
4. 删除仅为生产 classic Content 复制存在的临时投影时，必须让现有 Node 合同测试直接消费规范源码或明确的测试 helper；不得降低 DTO、投影、加载顺序或旧标签刷新断言。
5. `auto-sites.js` 仍是旧动态注册清理和站点意图的唯一 owner；不新增动态注册。Manifest/host permissions/CSP/extension ID/DB schema/cache identity 不变。

## 完成标准

- `npm run validate`、`npm run build:extension:wxt`、`npm run test:wxt:smoke` PASS。
- 实际编译 Content 包执行本地确定性浏览器矩阵：Commands 手动恢复、页面翻译/缓存、Selection/Reading/Assistant、Rich Worker、YouTube MAIN 与原生权限控制全部 PASS；不得用 raw-source fixture 补生产缺失文件。外部大词典下载、真实私有语料和其它未变发布认证不因本任务重复执行。
- 使用固定 `19e89b65fd3600073410407392da82ffa666ffc8` old artifact 与当前 WXT artifact 执行 `e2e/wxt-upgrade.spec.mjs`，证明同 ID old→管理页 Reload→browser restart 的数据/权限/注册/恢复路径。
- 审计证明安装包不含 ISOLATED Content 原始模块图、根 `content.js`/`content.css`、React-in-Content、未注册文件、测试/文档或开发资源；MAIN/Worker 精确闭包中的稳定 `src/**` 路径仍存在。
- 更新 `docs/ARCHITECTURE.md`、`docs/PLATFORM_UPGRADE_V1.md`、`docs/WXT_COMPAT_V1.md` 的当前态；历史证据不改写成新执行。
