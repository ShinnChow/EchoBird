# DeepSeek Harness 桌面版接入决定

日期：2026-09-20

用户决定：等官方正式发布可公开下载安装的桌面包后，再开展 EchoBird 接入。当前保留 `dsh web`，暂不预接入、不替换安装命令。

本次核查：上游 `apps/desktop/package.json` 中的 `@deepseek-ai/dsh-desktop` 标记为 `private: true`，npm 官方仓库查询返回 404；Windows x64 和 macOS arm64 的生产更新清单也返回 404。源码中存在桌面版并不代表已经公开发包。

后续恢复工作时，重新核实官方发布状态、下载渠道、安装路径和配置兼容性。优先使用官方更新清单解析安装包，避免写死版本号；安装后的更新优先交给桌面版自身处理。接入时验证安装检测、桌面启动和模型配置。触发条件是官方正式发包，而非仅有 CI 或打包脚本。

参考：

- [官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [桌面包定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/package.json)
- [桌面版说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

此记录不创建定时监控；后续由用户决定何时继续。
