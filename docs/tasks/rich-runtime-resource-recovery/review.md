# 验收后自查

候选：`6b49211bea6dcc0c98b6915f1a84b8ccea857667`。执行者：主 Agent；此记录是自查，不是独立审核。

检查完整生产 diff、资源读取/取消/释放、CSS slot 降级、版本绑定、音频重试和导航失败保留正文路径。单个 CSS 图片失败不再丢整张 stylesheet；stale 和关闭仍丢弃旧样式。found 响应仍必须匹配绑定版本。保留现有 MIME、字节、像素、对象 URL、SVG 和 CSS 安全校验，无新增外网、Provider、权限或 CSP 变更。

当前取消恢复默认播放按钮；旧音频或旧 viewer 的迟到错误不能追加提示。恢复提示按 descriptor 聚合，成功重试只清除对应错误。关闭清理提示与翻译绑定。仅更新导航失败文案，没有修改词形规范化、词条身份或历史。

最终检查：97 项定向 Node、完整 validate（1497 Node / 42 Vitest）、WXT build / smoke、3 项安全和 12 项取消测试、10 项 Chromium E2E 通过。已查看 360px 窄屏缺附件/重启恢复两张合成截图：徽标横向紧凑，正文和 footer 可达，恢复后 CSS/图片/音频出现。真实 Oxford 健康对照 commit 的词典 CSS、英美发音解码通过；Provider=0，外部 HTTP=0。详细命令和指纹见 acceptance.json。

没有发现本次已证明缺陷修复的代码 blocker。仍不能证明原截图安装的附件为何失败，也未在该安装验证恢复。PR 保留 draft，不以健康对照代替用户原安装验收。当前开发包不带生成内置 TFLex 数据，不能声称顶部内置词典警告已修复。LRU 等低优先级工作未展开。
