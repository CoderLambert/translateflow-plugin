# 本地交付：AI 文本翻译与悬浮面板（0.8.56）

分支 `feat/unified-reading-polish`，基线 `18b7849`（0.8.55）。本地实现和构建完成，交付用户人工试用；未推送或合入。

## 需求与实现

- 功能统一命名为「AI 文本翻译」。Popup、窗口标题、浏览器快捷键名称和使用文档同步更新，原 command ID 和入口页面路径保持不变。
- 网页悬浮球面板新增清晰的 AI 文本翻译卡片入口，实际点击打开/聚焦既有独立小窗。点击期间禁用重复操作，失败在面板内反馈。后台仅对验证过的非无痕顶层 Content 开放固定页面的打开能力；设置读取、Provider 请求和会话读取仍不接受 Content sender。
- 悬浮面板重排：品牌头部、整页翻译、文本翻译入口、按需显示的状态/取消/重试、自动翻译、折叠的网页偏好和轻量底部操作。保留位置恢复、隐藏本站、焦点返回和主题支持；语言切换保留偏好展开状态。拆出 `quick-control-elements.js`，避免继续堆积 view。
- 小窗使用更紧凑的表单、结果卡片、原文预览、主次操作和输入区；去重服务/模型名称。参考 shadcn 的 Select/Textarea/按钮设计，用现有原生 TypeScript 实现，不新增 React/Tailwind/组件依赖。自定义选择菜单支持方向键、Home/End、Enter、Escape、Tab、前缀选择、禁用和 ARIA 状态。
- 场景胶囊包含通用、邮件、办公、日常交流、学术、技术文档、社交媒体。默认通用；点击不发请求，不改手写补充要求。新请求将固定场景指令与自定义要求一起提交，结果标明场景；后续调整和重试沿用原记录场景。已有无场景字段的 session/记录按通用处理，无数据库迁移。

## 已执行

按用户要求，本次不追加自动测试、类型检查或浏览器验收。

- 读取用户截图和现有调用链；通过 Context7 核对 shadcn Select / Native Select / Textarea 的组成与样式建议。
- `node scripts/i18n-locales.mjs --generate`：成功，同步受控 Manifest 文案。
- `npm run commit:prepare`：成功，0.8.56 安装包由准确暂存快照编译；构建内置 Manifest/资源审核通过。最终构建日志：`docs/task-execution/local/text-translation-polish/build-final.log`；构建 tree：`938bf5f7df817df7ed46ff8516f0889735f83c0c`。
- 主 Agent 自查：Content 仅新增打开固定小窗消息；模型调用仍需要窗口内主动提交；场景随请求固定、参与既有 prompt 身份，不污染无关对话；明文内容仍用文本节点，未改变 Provider、权限或长期存储。状态文档不改变构建输入。

未执行：Node/Vitest、typecheck、Playwright、真实模型与最终截图复核。CSS/菜单实际显示和用户常用网页的悬浮入口由用户本轮人工试用确认。此报告不是完整验收或独立审核。

## 人工试用入口

重新加载 `dist/extension/` 后刷新网页，打开悬浮球并点击「AI 文本翻译」。选择邮件或办公场景，输入文字后翻译；可展开补充要求。Popup 仍保留同名入口。浏览器会话内保留场景与草稿，整页翻译偏好不受影响。
