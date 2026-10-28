# README 同步右键翻译与 0.8.65 候选版本

用户要求实现网页右键「翻译当前页面」并同步版本信息。公开仓库README顶部改为已构建候选0.8.65，说明右键入口位于普通网页任意位置，沿用已保存翻译方式、首次新站点仍请求站点权限；main源码版本0.8.50继续如实标注。

范围：README与任务记录。运行时代码、Manifest、package、权限和安装包不在本分支；右键实现及实际包验收在本地context-menu-translate-page任务完成，本同步不声称已合入main或商店已发布。

验收：README本地文档/图片路径存在，版本候选行与main源码行匹配（release-gate通过），diff仅README/docs；准确远端head保护squash后核对公开README字节与首行。纯文档不构建、不启动浏览器。
