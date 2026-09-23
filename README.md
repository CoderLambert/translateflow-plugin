# TranslateFlow v0.3

轻量 Chrome Manifest V3 AI 网页翻译扩展：保留英文原文，插入简体中文译文，使用自己的 DeepSeek API Key，并将翻译结果按网页 URL 与正文内容缓存在扩展 IndexedDB 中。

## v0.3 重点

- **按站点开启自动增量翻译**：只对用户主动授权的站点持久运行，不申请全局常驻网页读取权限
- 自动模式进入页面后：**先查 IndexedDB，命中立即显示，缺失内容才调用 DeepSeek**
- **IntersectionObserver 近视口处理**：长文章/无限滚动页面不会一打开就把全部内容送去 API
- **MutationObserver 动态补译**：SPA、无限滚动、新增评论/正文等内容出现后自动加入翻译队列
- SPA URL 变化会重新计算页面身份并切换缓存上下文
- `#/route`、`#!/route` 类型 Hash Router 会保留在页面缓存身份中；普通 `#section` 锚点不会造成重复缓存
- 同一页面的相同原文会合并，只请求一次模型，再复用到多个 DOM 元素
- API 异常自动退避，避免网络错误、限流或 Key 未配置时形成请求风暴
- 模型 / Prompt / 目标语言变化时，自动模式会清掉页面旧译文并重新按新缓存版本处理
- 修复 v0.2：原文仅因换行/空格变化时，SHA-256 相同但二次复核误判为缓存 miss 的问题
- 设置页可以查看并移除已授权的自动翻译站点

## 缓存策略

缓存主存储为扩展自身 Origin 下的 IndexedDB：

- 页面身份：规范化 URL
- 翻译版本：模型 + Prompt + 目标语言配置指纹
- 段落身份：归一化原文 SHA-256

因此再次访问相同内容时可以 0 API 恢复；网页只修改一部分时，仅新增或变化段落会重新翻译。

URL 规范化规则：

- 移除 `utm_*`、`fbclid`、`gclid` 等常见跟踪参数
- 保留正常业务 Query 参数
- Query 参数排序，减少参数顺序造成的重复缓存
- 普通页面锚点 `#section` 忽略
- SPA 路由 `#/...`、`#!/...` 保留

## 自动增量翻译

1. 打开目标英文网站。
2. 点击扩展图标。
3. 点击“开启此站自动增量翻译”。
4. Chrome 只会请求当前站点的访问权限。
5. 当前页面立即开始自动处理。
6. 以后进入同一站点，扩展会自动注入：
   - 视口附近已有缓存 -> 直接恢复
   - 没有缓存 -> 批量调用 DeepSeek
   - 滚动到后续内容 -> 继续按需处理
   - 页面动态出现新内容 -> 自动补译

关闭该站自动翻译后，会撤销动态 Content Script 注册并尝试撤销对应站点权限；IndexedDB 翻译缓存不会删除。

## 手动模式

即使没有开启站点自动权限，仍可使用：

- 翻译 / 更新当前页面
- 仅恢复本页缓存（0 API）
- 显示 / 隐藏译文
- 移除当前页面译文
- 删除当前 URL 全部缓存版本

手动模式继续依赖 `activeTab`，只在用户点击扩展时临时访问当前网页。

## DeepSeek

- BYOK：使用自己的 DeepSeek API Key
- 默认模型：`deepseek-flash`
- 模型名可编辑
- 自定义翻译 Prompt
- 批量段落翻译
- JSON ID 对齐
- Thinking Mode 关闭，降低翻译延迟与无必要 token 消耗

## 存储结构

### `chrome.storage.local`

保存少量配置：

- API Key
- 模型
- Prompt
- 目标语言
- 缓存软上限
- 自动翻译站点列表

### IndexedDB `ai_bilingual_translator`（兼容旧版缓存，暂保留内部库名）

`pages`

- `pageKey`
- `url`
- `title`
- `createdAt`
- `lastAccessedAt`

`translations`

- `cacheKey`
- `pageKey`
- `pageConfigKey`
- `configHash`
- `sourceHash`
- `sourceText`
- `translation`
- `bytes`
- `createdAt`
- `lastAccessedAt`

默认缓存软上限 200 MB，按 LRU 清理。

## 安装 / 升级

1. 解压项目。
2. Chrome 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 新装：点击“加载已解压的扩展程序”，选择 `translateflow-plugin` 文件夹。
5. 从 v0.2 升级：用 v0.3 文件覆盖原扩展目录，然后点击扩展卡片“重新加载”。
6. 打开扩展设置，确认 API Key / 模型。
7. 手动翻译无需额外站点权限。
8. 若需要自动模式，在目标站点的扩展弹窗中单独开启。

## 权限设计

必需：

- `storage`
- `activeTab`
- `scripting`
- `https://api.deepseek.com/*`

可选站点权限：

- `http://*/*`
- `https://*/*`

后两项只是声明“可按需申请的范围”，安装时不会直接把所有网站交给扩展。只有用户点击“开启此站自动增量翻译”时，才请求当前协议 + 主机的站点权限并注册对应动态 Content Script。

## 当前限制

- 仍以网页正文、文章、文档、Feed 为主要目标；复杂 Web App UI 不保证所有文本都适合自动翻译。
- PDF、视频双语字幕、划词翻译尚未实现。
- 自动模式当前按同一 scheme + hostname 授权；Chrome Match Pattern 不按端口做精细隔离，因此 localhost 等多端口场景会共享该主机授权范围。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 位于 `chrome.storage.local`，适合个人 BYOK，但不是服务端密钥保险库。
