# 源页使用数据说明 / Stemmio Usage Data Notice

生效日期：2026-07-29

源页是本地优先的 HTML 编辑器。正式桌面版本默认回传有限、结构化的使用与故障统计，用来判断哪些功能被使用、哪些提醒会打断用户，以及错误集中发生在哪个流程。该能力不显示首次弹窗，也不在产品中增加单独开关；本说明、首次打开说明和“关于源页”会持续明确告知。

## 会收集什么

- 应用版本、操作系统类别和 CPU 架构。
- 功能模块打开次数、项目上下文是否已登记、当前或历史查看模式。
- 直接编辑的类别与累计次数、自动写回成功/失败/冲突状态。
- 评论是否包含文字、图片或文件，以及数量区间；不包含评论正文或附件本身。
- AI 处理阶段、结果类别、耗时区间和结构化错误码。
- 提醒的稳定编号、类型、出现位置、是否有操作按钮，以及操作/关闭/自动消失。
- 会中断工作的冲突、恢复、关闭安全与更新确认的开始和结果。
- Renderer、主进程和本地 Bridge 的故障类别、退出码及本机生成的错误指纹。

连续的直接编辑与成功保存会先在本机聚合后再发送，不为每次按键建立远程事件。源页不启用 PostHog 自动捕获或会话录像。

## 不会收集什么

源页的遥测白名单不接受以下字段：

- HTML 源码、页面文字、DOM 内容或剪贴板内容。
- 评论正文、Prompt、AI 返回内容、附件内容或附件缩略图。
- 文件名、文件路径、项目显示名、文件夹名或窗口标题。
- Apple 账号、姓名、电子邮件、电脑序列号、设备名、硬件 UUID 或广告标识符。
- 任意原始异常消息、堆栈、控制台日志或用户输入。

Renderer 发来的事件会在主进程再次按严格白名单过滤；未声明的事件和字段直接丢弃。

上述“不收集、不回传”只描述 Stemmio 自己的产品遥测。用户主动选择源页 Agent、Qoder CLI 或 Codex
自动执行后，本轮冻结 HTML、评论、附件、项目规则，以及相应账号、会话或厂商接口所需元数据，
可能按该 Agent 或所选厂商的服务条款和隐私政策由其服务处理。源页 Agent 只把冻结任务发给用户
指定的 HTTPS 接口，模型不获得本机文件系统权限。Codex 修改时可能以当前用户的读取权限访问这台
Mac 上的其他本机文件，并将完成任务所需的内容发送至 Codex 服务。选择复制任务时，只有用户主动
粘贴或发送后才进入相应第三方服务。ACP 文件与命令限制不是对本机读取权限的完整隔离；所有
Agent 的结果都必须先进入 Stemmio 候选审阅，只有用户明确采纳后才会成为正式版本。

## 如何区分安装、会话与项目

- 首次运行会随机生成一个安装 ID，保存在本机 Stemmio Application Support 目录。它不是电脑序列号，也不能从设备硬件信息推导。
- 每次启动随机生成新的会话 ID。
- 项目只使用安装级随机密钥对内部项目 ID 做 HMAC 后得到的假名键；原始项目 ID 不进入发送队列。
- 删除源页的 Application Support 数据会同时删除安装 ID、项目假名密钥和未发送队列；再次运行会生成新身份。

## 记录归属所用的设备 ID

- 源页会在本机 Application Support 目录单独保存一个随机设备 ID（`device-identity.json`），用于在你自己的项目文件里标注每条批注和编辑事件由谁、在哪台设备上写下。
- 这个设备 ID **只写入你本机的项目文件，永不回传**。它与遥测安装 ID 是两个互不相同、互不关联的随机值：遥测刻意不发送真实项目身份，因此也不会把分析身份写进你的内容。
- 它同样不是电脑序列号，也不能从设备硬件信息推导。删除 Application Support 数据会重置它；已写入项目文件的历史归属保持不变。

## 回传位置与网络边界

数据通过 HTTPS 批量回传到源页的 PostHog US Cloud 项目。事件明确关闭 PostHog person profile 处理与 GeoIP 解析。和所有互联网请求一样，源 IP 会在建立网络连接时到达接收服务及其基础设施；源页不把 IP 写入事件属性，也不请求基于 IP 的地理信息。

网络不可用时，事件保存在本机有上限的队列中并退避重试；最旧记录会在超过上限时被丢弃。遥测故障不会阻止编辑、保存、项目切换或退出。

## 联系与变更

问题可通过 [Stemmio Releases Issues](https://github.com/Charleyli925/Stemmio-Releases/issues/new/choose) 提出。收集范围、接收方或身份策略发生实质变化时，必须先更新本说明与产品内说明，再随新版本发布。

---

Stemmio’s packaged desktop app sends a limited, allowlisted set of product-usage and fault events by default. It does not send HTML, page text, comments, prompts, AI output, attachments, clipboard contents, filenames, paths, account identifiers, Mac serial numbers, raw error messages, or stack traces. A random per-install ID, a random per-launch session ID, and HMAC-derived project pseudonyms are used instead of hardware identity.

That boundary applies only to Stemmio product telemetry. When the user explicitly chooses 源页 Agent, managed Qoder or Codex execution, that Agent or vendor API may process frozen task content and account or session metadata under its own terms and privacy policy. 源页 Agent sends only the frozen task to the user-selected HTTPS endpoint and does not grant the model filesystem access. The Codex ACP Agent may use the current user’s read access to inspect other local files and send task-required content to the Codex service. Clipboard delivery reaches a third-party Agent only after the user pastes or sends it. ACP restrictions do not fully isolate local read access. All managed paths produce a reviewable Candidate first; only explicit adoption creates a formal Version.

Events are sent over HTTPS to Stemmio’s PostHog US Cloud project with person-profile processing and GeoIP resolution disabled. The source IP is necessarily visible to network recipients while the connection is made, but Stemmio does not add it to event properties. There is no session replay or automatic event capture. Telemetry failures never block editing or persistence.

Separately from telemetry, Stemmio stores a random device ID in `device-identity.json` under Application Support and writes it into your own project files so each comment and edit event records who authored it and on which device. That identifier is never transmitted; it is a different random value from the telemetry install ID and is not derived from hardware. Deleting Application Support data resets it and leaves attribution already written into project files unchanged.
