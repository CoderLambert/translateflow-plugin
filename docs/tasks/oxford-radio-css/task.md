# Rich 词条原生状态结构与安全 CSS

依据 main `a778a24f762c97933dd339c7a50bc39d99bd1610`，收口 #271 的首个用户可见切片：真实 Oxford arch 的 3 个 radio/label（1 group、初始 1 checked）和 go 的 4 个当前全被 sanitizer 丢弃；CSS :checked 与兄弟关系不能驱动面板。保留 #319 词头/badges/BrE/NAmE 和 #324 长词条/外层滚动/footer/基础音频/details，禁止重做。

先恢复 generic Rich Dictionary 有界 radio/label 结构与 AST selector 子集，不写巨型 Oxford controller。源码真 radio 状态只作用本正文独立 Shadow；label-for/id/name/checked 必须闭合且有二次验证，无法安全关联明确降级；键盘可操作，焦点保持。无 form/任意 input/event handlers/词典 JS/外网。CSS 继续在既有 background css-tree 路径用 AST 白名单，支持真实必要 compound、descendant、child、+、~、:checked 与有限静态伪元素；禁止 :host、:root、全局逃逸、任意功能选择器及属性外泄。使用既有本地 asset slots/resolver，不建立通用脚本或另一套资源消息。

当前 sidecar CSS 61,996 bytes / 636 source rules / 718 selectors / 1,803 declarations。现规则 255 cap 在 source walk 提前耗尽，需依据全部 radio 状态实际 matched/accepted 数量选择最小明确有界行为。不得凭感觉全提阈值；保持 64KiB source、既有声明/资源/AST/渲染预算，必要 cap 调整必须以统计及 hostile overflow 回归证明。字体与 static SVG 是 #271 后续独立 WIP=1 切片，不据本次关闭 #271。POS 音标组同步、hint/unbox/illustration 和 entry/history 属于 #272 Oxford Adapter/generic navigation，不能绑在 CSS sanitizer。

执行 Agent owner：rich-mdd-css.js、selection tokenizer/style/sanitizer/viewer 最小变更及对应 tests/e2e；主 Agent owner task/state/contract documentation/GitHub。read-only explorer 真实输入统计只在 restricted /tmp；私有正文/CSS完整规则/私人路径不入库、不外传。以当前真实调用链为准，历史设计 5e7e6dd 第5A章只作安全/集成约束，不把旧拟定DTO当已实现 API或启动整体重构。

验收：合法 radio/label 相互作用、各正文同ID/group隔离、for/id/name malformed/duplicate/orphan降级、无form提交/handler/JS/HTTP；selector AST positive/negative、状态面板、source/accepted/output预算、伪元素content固定安全子集；Selection cancel/generation与资源close不回归。实际 candidate WXT 下同一真实 Oxford arch/go（只读对照/私有profile测试副本），检查DOM/全部radio状态/POS面板/keyboard/default状态/footer/末尾，Provider=0/external dictionary HTTP=0，记录exact commit/artifact/browser/包身份。合成 PASS不代替真实词条验收，真实终验尚缺字体/SVG/导航/失败恢复时明确 NOT_RUN/剩余项。

每 PR git diff check、受影响Node、完整npm validate、显式WXT、smoke、安全/取消、相关Chromium。准确candidate freeze、独立只读review无blocker、remote checks/threads/base/head保护、guarded squash merge及post-merge实际main复验。缓存切片根据用户当前优先级反馈后移；保留测量和未验收代码，不丢弃也不声称已交付。

冻结前明确：CSS visited cap1024、accepted512、source/output64KiB（只读636源/463有限投影依据）；private输入报告只统计，不包含商业正文。两个受控Content helper只提取标签扫描与radio关联/键盘构造，src/entries/content.js单源顺序注册；无新React/运行平台。拒绝radio group本record纯文本+提示，不因普通orphan标签降级；合法0checked保持零，不伪造默认选择。
