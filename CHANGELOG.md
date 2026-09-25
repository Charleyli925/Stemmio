# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

- 相同当前稿快速返回预览时，在实例仍有效的短时间内复用原预览页面；资源会话失效或源码变化会重新加载。直接打开已保存的预览标签时，编辑脚本运行态等到用户进入编辑后再准备。
- 修复旧版本 AI 执行文案导致已验证的当前稿打不开；历史文案按原记录显示，Request 与消息身份仍严格核对。当前稿打开失败直接说明结果，顶部提醒的鼠标关闭按钮恢复可用。
- 精简 AI 助手输入区和候选卡片文案，将任务指令复制移到标题栏，主按钮统一为“交给 AI 修改”；历史分组不再显示 HTTP 服务。会话按记录顺序显示有意义的消息，减少重复进度与过早的“回到最新”；审阅评论只按相同目标合并，变化目录恢复可点击。
- 切换两个当前稿时，旧画布保持可见但不可操作，直到新画布核对正确且脚本运行态就绪后一次接替；候选画布在透明状态下保持可绘制，减少 T1 等动态图表页面揭示时的闪动。打开失败保留明确的错误与重试入口。预览只按当前文档身份和内容判断可用，不再因评论、版本等后台工作闪灰。
- 等待切入的当前稿标签从准备状态起显示稳定紫色底线，原标签同时撤下视觉选中态；提交后目标底线持续到页面可显示，并向辅助技术说明打开状态。已选中标签内切换历史版本不改变标签名称。跨标签进入预览时模式底线先就位，眼睛图标在加载期间原位转圈，页面就绪后恢复，不再浮动显示加载文案。
- 预览等到页面首个内容绘制后才揭示；预览返回编辑时短暂保留同一文档的已加载页面，等编辑画布绘制完成再交接。切换文档后不再把旧文档编辑画面当作新文档的等待画面，修复欢迎页快速切换的白帧和 T1 偶现欢迎页残影。
- 修复普通文字或样式修改后返回编辑模式可能一直显示加载中的问题；最新画布与原脚本实例分别核对，安全原位编辑不会因此重跑脚本。目标预览打开失败时不再留着前一个文档的画面，重试仍打开当前目标。
- 修复历史版本预览失败后只读静态内容消失，以及纯浏览器内存文档返回编辑时预览层持续挡住点击的问题。
- 当前稿切换默认停用临时静态 HTML 展示页；保留数据缓存、阅读位置恢复及可供回归验证的旧交接实现。
- 修复两个当前稿切换时临时 HTML 先覆盖评论栏、正式画布接管后又收缩的宽度闪动；交接页现在直接与画布同列同宽。
- 修复 Developer Preview 中已写入项目的空历史激活占位字段导致历史不可读，并恢复已发布密文凭证的安全读取；非空旧回执、明文或损坏记录仍拒绝。
- Agent 设置中 Qoder“检查”恢复可用，Codex 安装会显示真实失败原因并明确安装的是连接组件；API Key 保存失败时不再重复显示“连接”，也不在界面保留刚输入的 Key。
- AI 成功后只显示一次“AI 已修改完成，已生成可审阅的新 HTML”，不再追加容易误解为中断的结束提醒；处理记录在窄宽度下不再逐字换行。
- 审阅默认适应画布，“变化 N 处”移到顶部审阅入口旁，并移除低频且容易误导的全部/文字/元素筛选；评论气泡优先在目标空闲侧就近显示并跟随横纵滚动。
- 统一编辑、预览、审阅、项目侧栏、设置和 AI／评论面板的视觉：白色底面、清晰深色文字、轻分隔线与中性阴影；模式切换改用细下划线，项目和设置导航采用中性灰选中态。用户 HTML、评论定位及各模式操作保持不变。
- AI 修改已采用但当前内容暂时无法读取时，沿用同一采用决定自动恢复；核对成功后恢复编辑，不再把自己的已提交内容留在外部冲突状态，也不会重复创建版本。
- AI 凭证恢复按操作状态选择下一步：启动读取失败引导重新连接，本次连接有效但保存失败保留重试保存；提示文案变化不会改变恢复动作。
- 修复重新载入当前画布时，本次收口输入的合法保存更新 Hash 后误报过期的问题；恢复沿用精确保存回执，并只释放自己持有的临时冻结。
- 静态文字 `div` 的复制支持已有安全行内格式（如加粗、强调和换行），复制后仍可继续编辑并使用现有移动、删除和历史操作；脚本、资源、作者身份与嵌套区块等限制保持不变。

- AI 侧栏把公开 Agent 过程收进稳定的可访问折叠区域：默认显示最新非空段落的一行预览，结果摘要与 Stemmio 校验、失败、采用事实继续可见；复制保留完整脱敏正文，用户上滚、选择文本或回访标签时保留阅读位置与展开选择，只有新一轮明确开始才恢复底部跟随。计时更新移到独立元数据叶子，避免每秒状态刷新重建消息正文。
- AI 处理过程可查看安全的真实活动摘要，同类活动按时间合并；不会显示工具参数、路径或私有推理，复制仅包含公开说明。
- AI 修改已经采用但页面核验失败时，明确提示恢复页面，并沿用同一源码回执重试；不再重新提供采用入口。采用中、结果待确认及停止中的操作保持与真实状态一致，失败后保留已公开说明。

## [0.9.90] - 2026-09-20

- 后续 Stemmio 源码改为专有并保留在私有仓库；应用内下载、更新说明和支持入口统一使用公开的 Stemmio Releases 渠道，不再把用户带到源码仓库。
- 修复两个当前稿之间切换时同一 HTML 被初始打开、项目补充读取和静态资源基址连续重载造成的多次闪烁：补充读取复用首次 SourceReceipt，缓存交接只接受当前导航的精确回执，静态交接页只装载一次稳定文档。跨项目打开长期规则或历史现在只解析该页面的只读项目上下文，不再默认打开或短暂显示目标项目当前稿；规则读取失败会同时保留原标签、内容与保存目标，历史在没有当前稿 Runtime 时仍可显示；页面保存、重试、历史浏览器打开及 AI 锁也按目标项目隔离。
- 工作台品牌区改用 Stemmio Logo 与名称。当前稿、长期规则和历史改为按项目去重的独立标签，以“项目名 · 页面类型”区分；跨项目可直接打开规则或历史，不再先显示目标当前稿，同一项目切换历史版本会复用一个历史标签。
- 历史页直接使用预览模式并禁用编辑，移除额外的返回横条；“基于此版本创建新版本”移入更多菜单。菜单始终展示核心操作，不适用于历史页的 Finder、浏览器、恢复及重载等操作会置灰并说明原因；历史导出始终导出所见版本，保留稿件对话框也会明确显示加载、空或错误反馈。
- 历史 Vn 只在新快照验证成功后更新标签与侧栏选中；从历史创建的新当前稿即使在最后画布确认失败，也不再被错标为历史。更多菜单的禁用项现在可通过键盘聚焦并读取原因，一次 Tab 即可离开菜单；项目名标签对比度与保留稿异步会话隔离也已修正。
- 从历史创建版本后若首次打开失败，直接点击同项目“当前稿”或关闭历史标签会在原导航事务内承接已创建版本，不再让导航队列等待自己；恢复会携带完整 Working Copy 身份，且不会因同一创建操作替换了旧源而误报外部冲突。后续标签切换继续可用，也不会重复创建版本。
- 启动恢复现在直接开始正式 HTML 打开，不再先等静态缓存或后台预热其他标签。非活动标签只保留有界 HTML 数据和精确版本的轻量阅读状态；命中切换时才短暂创建只读交接页，编辑画布接管后立即释放。

## [0.9.89] - 2026-09-14

- 普通源码元素的复制、删除、插入和受支持移动，在源码身份、当前节点和局部更新均可验证时默认留在当前页面完成；新增和恢复对象可继续编辑。带 `is` 的内建自定义元素、无法证明文本/注释边界的混合内容插入与移动仍走原有重建，且不得把错误画面报告成原地成功。`body` 自身不可删除或移动，但可以作为普通子元素的目标父级。权威源码替换不会伪装成局部编辑。结构验收按冻结预期核对原地、重建、拒绝和接受后恢复，不以产品自己的分类降低门槛。

- 审阅的变化标注达到事实容量上限时，保留前后页面、评论与决定流程，并明确说明标注暂不可用。

- 编辑和预览时不再常驻不可用的审阅按钮；空变化审阅保留页面、滚动和缩放控制，隐藏无作用的变化筛选。窄窗口中的审阅会话面板保持覆盖在画布右侧并可正常收起。

- AI 审阅只为可能显示样式框的区域采集可选视觉证据，移除已停用的 shell 准备链；文字和结构标注、评论、页面交互与采用决定保持原有流程。

- AI 返回的完整 HTML 即使与本轮输入相同，也可进入同一审阅流程，由用户决定采用或不用。采用前会说明仍将创建正式版本并归档本轮未再修改的要求；既有无修改终态保持原历史记录。

- Agent 同阶段活动与达到上限后的重复进度不再反复写入历史文件；保留结束、停止和结果记录，以及中断后补齐会话索引的恢复能力。
- 已生成的合法 AI 候选即使没有可定位变化，也能进入原有审阅页查看前后页面并明确采用或不用；空态原位说明，不再弹提示后挡在入口外。
- Agent 执行正文、消息块和摘要共用一个有界来源，修复诊断事件较多时尾部文字消失的问题；保留草稿入口、消息顺序和明确截断提示。
- 项目列表刷新减少对整个项目目录的重复扫描；打开同一项目时避免重复恢复，保存中断和待完成版本仍先恢复再显示。
- 历史编辑统一使用创建新版本的现行流程，移除已停用的旧激活命令；存量历史工作稿与旧回执仍支持重启、保存和重复确认，旧客户端不能再创建新的激活回执。
- 普通保存完成且恢复目录删除已持久化后，退役对应恢复事务；无法证明持久化时继续保留，历史版本和采用回执不参与清理。

- 修复同项目另一份工作文件仍在运行时，路径重绑误清除后台运行，以及旧提交结果核对误清除另一文档正在准备的运行；任务保留最初来源工作文件身份，同一路径开始新轮后旧轮也不再覆盖新轮。最近运行恢复现在只接受完整且自证的工作区身份，并保留经核对 Candidate 的稳定采用标识；托管桌面以 activePath 与 operation-specific active effect 原子记录切换结果，Recent 排名不再冒充已提交 effect，pending 回执还持久化前序 active effect 与单调 generation，因而同一路径 ABA 不能伪装成精确前序崩溃恢复；托管桌面已提交但本地无法证明的切换会保留同一回执并标记为待核对，不再伪装成普通拒绝或发布半个项目状态。

- 统一内置 HTTP Agent 的附件与输入/输出预算检查；文本附件只计入输入，完整输出按冻结 HTML 估计。执行使用预检时的模型能力，并在发送前重新核对所有冻结文件；未知模型能力不伪装成已验证额度。

- 项目切换统一由文档工作流核验本次离开边界，保留恢复保护和旧画面可离开行为；过期文档或来源替换不能复用先前的检查结果。

- 评论位置统一由一份源码目标维护，卡片与画布位置按需生成；保留旧草稿、历史和冻结要求的兼容格式与扩展信息。

- AI 侧栏草稿、实时说明与项目规则输入由各自区域更新，避免每次输入刷新整个工作台；文档切换仍隔离消息与草稿，关闭仍等待原有保存收口。

- 普通 HTML 导入和重开在同一次打开操作中完成，队列会等待画布与回执收口；并发导入同一原稿会继续已有项目，失败重试不重复建项目。原稿默认保留，删除仍须明确同意。

- 每个项目现在只有一份“当前稿”。左侧依次显示长期规则、当前稿和默认折叠的历史版本；V1、V2、V3……全部只读，包括最新版本。新项目保留原 HTML 文件名，保存新版本或采纳 AI 不再生成多份可编辑版本文件。
- 新增独立的“保存为新版本”，本地编辑也能主动留下历史。导出当前 HTML 可勾选“同时保存为新版本”，每次打开菜单默认关闭；无变化、取消或导出失败不会增加版本号。HTML 导出保留完整源码，不包含评论或项目包，默认使用 Downloads 或最近成功的外部目录，结果可直接显示文件。
- 升级时保留用户实际正在编辑的稿件、原文件名、评论和附件。“找回此前的稿件…”可恢复旧工作稿或替换前内容；恢复会建立新版本并保留当前稿，不改写已有历史。AI 采纳前的本地修改同样保留。
- Finder 中已删除或移走的非活动项目，在确认目录缺席后从普通列表隐藏；权限、读取或身份异常仍显示为不可用。当前打开项目消失时保留内容和恢复/导出出口，后台不会重新创建旧项目文件夹。

- 修复中文组词、内部文字恢复与历史操作后格式化节点失去编辑能力的问题，保留对页面脚本伪造节点的保护。
- 修复含模板内容的复杂 HTML 格式化时不必要的画布重建；重新载入成功提示现在核对可编辑状态，静态恢复解除旧只读降级。
- 修复撤销换页后键盘焦点留在旧 iframe 导致重做无响应；同内容重新加载等待新画面完成，不再取消正在恢复的图表。
- 连续撤销/重做按用户操作顺序处理，后到的重做不再被正在保存的撤销吞掉；切换文件或出现独立编辑后不重放旧请求。
- 格式按钮只统计实际选中的字符；已是相同格式的有效请求保持编辑会话，不再让文字退出编辑。
- 撤销重做后的页面可继续编辑，不再因后台等待保存回执而拒绝格式修改；等待中的旧撤销不会覆盖后来输入的内容。
- 统一顶部通知样式，移除可编辑静态页面的常驻黄色提示；增加全目录真实 HTML Electron 验收入口。

- 应用图标换成新的紫色 S 品牌标：Dock、Finder 和安装包使用同一份图标，favicon 与应用内品牌图同步更新。
- 项目重启、重挂载后不再因为设备号或文件编号变化而不可用。工作副本使用稳定项目身份、内容校验和隐藏文件绑定恢复位置；旧项目自动迁移，不改 HTML、不新增版本。文件缺失、外部变化和重复身份只影响对应项目，侧栏仍可浏览版本；原文件仍在隐藏绑定中时可恢复到登记位置。保存和 Promotion 的中断恢复也使用同一套内容证据。
- 连续编辑遇到上次保存正在清理恢复日志时，新内容会继续自动写入，不再停在等待保存；动态内容降级到静态页面后仍保持相同行为。

- 设置页的 AI 服务列出内置 AI、Qoder 和 Codex 三行，可以全部收起；浏览或展开某行不改变默认服务。展开区不再重复服务名称。API Key 使用“连接 / 更换 API Key”，官方账号认证才叫登录。更多菜单区分断开（保留凭据）和移除 API Key。断开或移除会停止该服务相关任务；确认区显示处理中，失败不会报成功，断开后仍可移除已记住的 Key。记住 API Key 失败时保持连接表单，标明仅本次可用；Custom 会一并记住 Model ID。侧栏可选择服务并原位打开同一接入面板；接通后才把该服务设为默认，设置页接通备用服务不会改默认。Key 失效直达更换表单，修复后按新执行身份重新发送，不会对另一文件误发。断开的默认服务不会被静默换成另一家。普通设置页不再套用模态 Tab 循环。 Candidate / source-gate 会列出 DeepSeek、Qoder、Codex 的真实协议未验收项，CI 绿色不能当成供应商已验收。
- 正式安装包可直接选择 DeepSeek 默认模型，无需 Beta 开关。源页连接表单默认只填 API Key，验证成功后才替换当前连接；可选“记住 API Key”使用系统安全存储，失败不明文降级。
- 源页可作为默认 AI 服务并在重启后恢复；无效的本机 Qoder CLI 不再挡住健康的受管安装；Codex 按锁定 ACP 契约读取 `modelId`，不再把显示名当成机器 ID，也无法识别的目录不会伪装成 `codex:default`。安装取消完成后可以再次安装，不会停在“正在取消”。
- AI 服务的安装、登录等待和显式断开共用同一份接入状态：设置页与诊断看到相同的操作代次；关闭面板再打开会恢复进行中的安装；显式断开后后台扫描不会自动重新启用。
- Qoder 与 Codex 的登录改走官方 CLI，由主进程打开允许名单内的 https 登录页；新用户不必复制命令。登录身份由后台独占，授权成功后动作会正常结束，不会把诊断就绪误判成过期。打不开时可以重新打开登录页。cli-login / ChatGPT 账号可退出后重新登录；环境变量凭据会标明来源，应用不会宣称已注销全局 Token。
- Agent 设置页现在只做无副作用、selection-keyed 的四项连接诊断，正式发送时才预检并冻结模型配置；Custom 接口不再假设存在 `/models`，Codex 诊断会验证 ACP 协议。受管安装期间可直接取消。DeepSeek 改为 SSE 增量接收，HTTP 与 ACP 都只在连续 45 分钟无有效协议数据时中断；运行区只显示等待时间、已接收大小和当前可执行操作。Agent 失败会立即替换“处理中”，并将技术重试安全性与认证、模型、厂商、限流或安装恢复动作分开，不生成半成品 Candidate；历史对话按日期与轮次分组。
- 源 HTML 写入失败不再锁死整个工作台。源页独立跟踪磁盘已确认 Hash、当前工作 HTML Hash、Canvas Hash 和保护 Hash；只有后三者精确一致才放行可逆导航，`failed/conflict` 和原文件 Hash 保持真实。Main 恢复日志支持同文档路径 CAS rebase、Main/local 合并恢复、单 in-flight + latest pending 写入合并、成功保存后 CAS 退役，并在目录不可用或单记录损坏时降级而不阻止启动。得到精确恢复或导出凭证后可切换标签、关闭文档和退出；活动标签先保护再关闭，标签布局 best-effort，桌面关闭最多自动重试一次并释放精确冻结。失败横幅占用工作区自身布局，可展开和复制诊断。本项不把 Draft、`PROJECT.md`、附件或 AI 不可逆提交重分类为 HTML 保护凭证。
- 多个 HTML 标签现在会保留受内存预算约束的只读页面缓存：最近页面可先显示、再在后台核对最新源文件，切换时不再反复空白重载。AI 候选就绪后会预热审阅；未命中缓存时也先显示修改前后页面，再补变化标注。采纳后在新版本安全提交时立即回到新 HTML，最终编辑画布与项目资料继续后台准备。
- 工作台改为统一的浏览器式外壳：全局项目侧栏占据产品完整左侧并可从系统红黄绿按钮旁
  收起或展开；标签页、模式切换、审阅工具、项目、文件夹/默认浏览器动作与 AI 入口对齐在
  两条紧凑顶栏中。新标签页去掉白色卡片并优先“查看现有项目”，文件标题、HTML 品牌块和
  打开“+”不再重复占用工具栏；审阅工具在编辑/预览时原位禁用，进入审阅后原位启用。
- AI 审阅聚焦到可准确解释的“文字”和“元素”两类变化。工具栏现在只有“全部 / 文字 / 元素”；元素新增与删除都只标最外层元素，整块新增或删除里的文字不再重复打点。
- 审阅现在以稳定源码 ID 可靠报告元素移动、属性、内联样式及 CSS/Script 源码变化；ID 被删除、替换或错误迁移时明确显示为删除加新增，移动子树仍会逐个识别后代文字及元素增删。CSS 最终影响、排版、换行和 Canvas/SVG 运行态视觉差异仍不推断；主进程截图、PNG/像素判定、Runtime DOM 对账和冻结图表脚本不会恢复。
- 现在能看到“更新了什么”。“关于源页”的更新卡常驻一条“查看更新内容”，无论
  当前是已是最新、发现新版本还是已下载待重启，都能直接打开该版本的更新说明；
  页面没有打开时在同一张卡下方说明原因。以前这个位置只能跳到仓库首页，
  用户无处得知一个版本修了什么。
- 正式 Release 的说明正文改为 `CHANGELOG.md` 中该版本的小节，不再是自动生成的
  英文 Pull Request 标题列表，并附上该 tag 上完整 CHANGELOG 的固定链接，跳版本
  升级的用户也能补齐中间的变更。缺少或空白的版本小节会在创建 tag 之前就中止
  发布，不会再发出一个没有可读说明的版本。

- Filename “打开本地HTML” and “在默认浏览器中打开” hover/focus hints now
  sit horizontally centered above their icons instead of the top-right.
- AI 审阅里，删除文字恢复为穿过原字的红色横虚线，新增文字在每个字下叠一层小绿点；两者都不再改作者颜色、字号或行距。绿点不再使用会撑开行高的 CSS 着重号。
- Canvas hover and click now share one pointer hit: pointing at child
  content selects that small target, pointing at a filled module's own
  padding or gap selects the module, and a completely empty module is not
  selectable. The hover pill sits inside the outlined hit box, so clicking
  that caption selects the advertised target. Deselect still uses Escape,
  the header, the comment-rail blank, and the page root. There is no
  Preview-mode hover state.
- 移除了首次打开本地 HTML 时出现的“快速开始”浮层；现有的画布 Hover 提示、直接编辑、
  评论与发送 AI 流程保持不变。

- Importing HTML no longer reports a failure for work that already succeeded. If
  the project Registry lock could not be cleaned up afterwards — for example
  because its coordination file was damaged by an external write — the import was
  reported as failed even though the project had been fully created, and the
  error text named the lock file instead of anything the user did. Cleanup
  failures are now silent and the leftover lock is reclaimed automatically.

- The exact-legacy-V4 project Registry migration and its dedicated lock are
  removed. The shape it migrated existed only on the development branch for
  about six hours and was never part of a released PageRoot, so no installed
  version can produce it. An unrecognized Registry now fails closed and keeps
  its exact bytes, which is the path every other unknown shape already took;
  managed HTML, Versions, Drafts, comments and attachments are untouched.

- A project Registry lock left behind by an interrupted PageRoot process no
  longer blocks importing HTML forever. Previously only one residue shape (a
  single intact owner marker naming a dead process) could be reclaimed, so a
  crash between creating the lock and writing its owner, a crash between the two
  retire renames, or a damaged owner file made “打开外部 HTML” fail permanently
  with no in-app recovery — restarting did not help. Any lock whose ownership
  cannot be resolved is now reclaimed automatically once it is older than a
  grace period, while a lock still owned by a live process is never reclaimed.
  The busy message no longer claims that another PageRoot process is running.
- Preview sessions now refresh in place for the same Edit sibling-asset
  source path, and a full session map evicts the least-recently-accessed idle
  session instead of the oldest insert. Repeated saves and Preview toggles
  keep the live Edit/Preview resource base instead of dropping it after eight
  sessions.
- Browser encoding-error “重新选择” now reopens the HTML picker in the same
  click, then switches to the next UTF-8 HTML. The current page is not drained
  before the chooser appears, so the hidden file input keeps the user gesture
  Chromium requires. In-memory HTML now records its Hash so the next file can
  pass the canvas switch fence.
- Opening an unbound local HTML now asks before importing. A registered v4
  project still opens directly. Re-opening the same retained original returns
  to that project's current local edit with a short “already imported”
  confirmation, never a second project. First import copies into PageRoot,
  keeps the original by default, and only moves it to Trash after the new
  Canvas is verified. Sibling images, CSS and scripts stay beside the original
  and continue to load in Preview and Edit from that directory. The previous
  silent import toast is gone. If the file changes while the confirmation is
  open, import is refused with “文件在确认期间被修改，没有导入.”
- Finder 在同一受管项目目录内改名当前 HTML 或同父目录的项目文件夹后，应用按唯一稳定身份同步新路径、活动记录和监听目标；HTML 改名不等于项目改名，不新增 Version。文件标识变化不单独导致不可用，重复身份和不安全路径仍停止写入；同目录保存 `PROJECT.md` 等旁路写入不会提前保存未还原的规则修改。

- Fixed the edit Canvas shaking continuously at window widths where the source
  iframe would gain or lose a vertical scrollbar. The shared page scroll stage
  now owns page-level vertical scrolling, while Canvas measures fractional
  natural content height before rounding so a sub-pixel overflow cannot reopen
  the scrollbar feedback loop. Nested authored scroll containers are unchanged.
- New projects now start with an empty `PROJECT.md` instead of generic preset
  sentences. Generated AI handoffs keep stable scope, file and completion
  boundaries in `AI_RULES.md`, while `PROMPT.md` contains only current-run
  identity, paths, attachments and commands, removing duplicated instructions.
- Simplified AI review text highlighting into two independent layers. Exact
  deletions now retain character-level red dashed strike-throughs, exact
  additions use one solid green dot below each added character, and both sides
  share a low-emphasis purple scope frame. Layout alone promotes phrase frames
  to one clean line rectangle at three changed phrase groups or 60% evidence
  span, then to one paragraph rectangle when at least 75% of three or more
  visual lines are promoted. The scope frame and dim-mask hole share identical
  geometry and always contain the character evidence; the former density,
  stable-sentence and shaped-outline decisions have been removed.
- Fixed formal macOS packages omitting the signed `app-update.yml` provider
  configuration, which made every update check appear unavailable even when
  GitHub Release metadata was healthy. Candidate assembly now generates the
  stable channel before signing, includes it in the signed-App checkpoint, and
  rejects missing or drifted provider/cache settings in both dry-run and final
  artifact verification. Existing 0.9.8 installations need one final manual
  update to a patched release before automatic updates can resume.

## [0.9.8] - 2026-08-11

- Fixed a Draft revision-reconciliation feedback loop that could issue a
  second aggregate write after a successful rebase and drop an acknowledged
  direct-edit event. Mutable Draft events now use their dedicated compatibility
  ingress and capture synchronous Version authority when assigned; rebased
  comments, edit events and deletion tombstones advance exactly one Draft
  revision and remain intact after restart.
- AI Attempt 输出现在保留用户原始文件名并附加系统分配的 `V1.x` 后缀，例如
  `市场概览-V1.9.html`。Prompt 明确给出每轮唯一的绝对输出路径，AI 不再把
  冻结输入的 `index.html` 误当成输出文件名；已冻结的旧 Attempt 仍可按原
  `output/index.html` 合同完成。
- Add a credential-free Release Dry Run for Pull Requests that change packaging,
  release metadata, Electron or packaged Bridge paths. Two independent macOS
  jobs now assemble and checkpoint an explicitly unsigned non-release App, then restore it in
  a clean checkout, rebuild the renderer oracle, revalidate telemetry/build
  metadata and launch-check the product name, version and Bundle ID. The
  checkpoint is always `releaseEligible: false`, uses only a synthetic public
  telemetry token, and cannot enter the signed/notarized Candidate or
  publication lanes.
- Fixed formal AI review missing chart palette, data, or configuration changes
  when the changed script did not directly name the rendered chart host. A
  source-empty chart directly covered by a saved local comment target, plus
  pairable charts in the target's nearest multi-chart group (including when the
  target is a caption or heading beside the charts), is now compared before
  ordinary runtime candidates. Global comments, charts outside that group, and
  other un-commented regions retain the strict host-reference gate and bounded
  budget. Comment scope remains analyzer-only: scope attributes are removed
  before either review document is serialized. Every source-resolved local
  target is instead represented only in a private initial-bootstrap binding:
  an element path plus a narrow static fingerprint, never a temporary DOM
  attribute. The desktop preview session serves that binding only to the
  parser-blocking first bootstrap request, then replaces it with an unbound
  fallback for later author-initiated reads. The trusted review host delivers
  comment targets only to the before frame via a challenged private port.
  Comment bodies, comment keys, source-node IDs and locator maps never enter
  document bytes or a later fetchable bootstrap response. A unique source `id`,
  `data-*`, `name`, or `aria-label` locator is only a safe fallback when the
  private binding is unavailable—never a mutable sibling ordinal. Missing,
  ambiguous, replaced or disconnected targets, and unavailable private
  transport, omit the marker rather than guessing a neighboring element. The
  bootstrap consumes both private-channel challenges in its first capture
  listener, before authored capture listeners can observe or forge either port.
  When comment scope, rather than a direct changed-script
  reference, admits a host and its first before/after comparison differs,
  PageRoot now reloads the same isolated pair once and requires each side's
  fingerprint to match its own fresh run. One-shot `Math.random()`/`Date.now()`
  initialization, a failed replay, or a replay mismatch keeps the existing
  static result; directly causal hosts and comment-scoped hosts with no initial
  difference do not pay for the extra run.
- Hardened runtime-chart candidate binding so host keys, source-box baselines
  and element locators are never serialized as authored-page attributes. The
  parser-blocking first bootstrap response alone receives opaque private
  bindings; the managed preview immediately consumes it and serves only an
  unbound fallback source to later reads. It retains the exact element/key/
  baseline mapping only in closed runtime state. A stale path may resolve only
  to one matching private fingerprint; an ambiguity, replacement or
  disconnection invalidates the complete supplemental batch, so authored CSS
  or scripts cannot use candidate metadata to manufacture a visual difference.
  A confirmation pair receives fresh preview sessions so its own first
  bootstrap response can safely carry its one-shot bindings.

## [0.9.7] - 2026-08-07

- Let macOS applications such as Qoder Work offer PageRoot as an alternate
  HTML editor. Selecting it now opens the exact current `.html` or `.htm`
  source in PageRoot whether the app is closed or already running, while
  preserving the user's current edits before switching projects. Rapid external
  open requests and ordinary local project opens now share one durable order,
  cannot leave PageRoot displaying an older file after a newer request has
  become active, and keep the Canvas frozen while external activation is still
  in flight. A failed later external request now keeps the last successfully
  opened file visible and durable. A deferred external open now waits for an
  observed switch blocker to clear, or for an explicit retry, so Canvas
  recovery cannot create an automatic retry loop. Every already accepted local
  or external result now enters a renderer FIFO and re-fences immediately
  before it is published, so an older result cannot unlock the Canvas and let a
  later queued open discard a newer user edit. A delayed startup catch-up can
  no longer replace a newer live external-open request in the renderer. If a
  cold-start file has moved or cannot be read, PageRoot now shows a stable
  product error code and message instead of exposing the local path or raw
  filesystem exception. Closing, restarting, or installing an update now waits
  for an external HTML switch to finish safely instead of interrupting it,
  including when the current project is still loading or has a read error. A
  new external open that arrives mid-close now cancels the uncommitted close or
  is safely handed to the next launch after shutdown commits.
- Update the shared `js-yaml` dependency closure to 4.3.1, removing the
  high-severity parsing advisory without changing the packaged runtime shape.
- Bring the review-first AI workflow into the public README, built-in welcome
  project, About dialog and first-open guide. The new user-facing story shows
  before and after side by side, explains copy, structure and visual change
  labels in plain language, and makes clear that users choose which version to
  open after reviewing; no AI result silently replaces the current HTML.

## [0.9.6] - 2026-08-06

- Stop Canvas text undo/redo from blanking and jumping the page. Bridge-verified
  changes confined to the active editable island now adopt canonical children,
  source-node identities, caret and viewport in the existing iframe; any failed
  proof still falls back to a fresh verified frame.
- Make frozen user comments easier to discover in AI review with a larger,
  always-purple “评” marker and white label. The marker remains anchored to
  the original comment target, and hovering still opens the existing read-only
  comment-detail bubble.
- Separate exact AI-review copy evidence from the frame users read. Nearby
  fragments now form bounded phrase or line rectangles, tiny edits gain a
  line-local readable width, stable sentences stay separate, and dense
  multi-line rewrites become one smallest-owner “段落改写” frame instead of a
  jagged union outline. Each semantic group carries one label. Removed copy
  keeps its red dashed strike and red dashed frame; added copy keeps its green
  dashed frame without an underline or background treatment.
- Detect stable script-generated HTML, SVG and Canvas chart changes inside
  uniquely paired source-empty hosts during AI review. Existing static frames
  remain authoritative and are never duplicated. A changed script must directly
  reference the host's distinctive identity; sharing a section is insufficient.
  The owned first script binds its DOM, computed-style, Canvas, scheduling, and
  text-normalization/digest readers before authored code runs, then resolves only
  a complete exact host-key set declared by frozen
  source analysis and records which parser-created element first claimed each
  key. Unknown claims are ignored; a missing, duplicated, transferred or
  replaced declared host, or any capture fault, silently keeps the existing
  static review.
  The bounded capture includes the host's own painted box, fully transparent
  host state and directly mutated size as well as generated descendants. It
  prunes every zero-opacity host or descendant subtree, including SVG wrapper
  groups, so hidden child churn
  cannot become a false positive while a visible subtree becoming transparent
  remains a real change. It caches evidence across
  asymmetric slow frame loads, gives managed frames 1.5s to register, starts
  its unchanged 500ms comparison budget only after both review frames load, and
  ignores unpainted geometry, page-flow shifts,
  identical final output, animation, incomplete or late analysis. Accepted
  chart facts commit with the initial review projection rather than appearing
  after interaction. Runtime evidence is enabled only on the managed desktop
  preview transport. If authored code tries to replace that subframe before its
  first load completes, the main process blocks it and reloads the same volatile session once as a scriptless
  copy that retains only the owned bootstrap; review then keeps the
  authoritative static result without adding a notice. A managed-session
  failure or frame that never finishes loading takes the same bounded static
  path; late runtime evidence cannot reopen the decision. Inline/browser
  review is static-only.
- Stop treating AI-authored script changes as an adoption failure. Candidate
  assessment now checks document usability and coarse continuity only; retired
  executable-surface fields in historical records are verified, normalized out
  of current status, and never rewritten or exposed as a present-day warning.
  Genuine assessment read errors also show an accurate failure instead of
  being mislabeled as a timeout.
- Keep AI review text frames aligned to semantic punctuation and word ranges.
  Replacing “品均基本持平” with “单品效率整体稳定，增幅仅+0.10%” now
  marks the complete old and new phrases instead of treating their accidental
  shared “品” character as unchanged or splitting the green frame. Short Chinese
  replacements remain pairable, while distant edits in long punctuation-free
  copy no longer pull the unchanged text between them into one oversized frame.
- Make visual-review frames follow the element that owns the changed paint or
  layout. Whole-card background, border, radius, shadow, size and layout
  changes now keep one complete component frame and matching mask hole, while
  logical block sizing follows the same rule. Inherited copy styling now uses
  the rendered text ranges instead of its container box, and neighboring cards
  cannot merge merely because they are close together.
- Show script-generated Canvas, SVG/HTML charts and dynamic table bodies
  automatically in desktop Edit as one source-Hash-bound read-only bitmap
  projection. The bitmap remains pointer-transparent so comments target the
  original HTML host, while source save, review diff, versions and AI input
  continue to use the complete original HTML without PageRoot projection data.
- Give developer test packages a distinct `PageRoot Developer Preview` app
  identity and deterministic versions derived from the latest formal tag; for
  example, the first two committed previews after `0.9.5` are `0.9.69991` and
  `0.9.69992`, with the exact source commit appended to the full preview
  version so divergent branches cannot share an app or DMG identity.
- Require every formal or developer installer handoff to include an exact
  package-content report with artifact Hash, source range, all associated Pull
  Requests, their live status and one-line purpose, plus direct commits without
  a Pull Request.
- Treat an unqualified latest-package request as current `origin/main` plus all
  applicable, non-excluded PR heads; compose unmerged work on a temporary
  integration branch and keep any such installer Developer Preview-only.
- Update Next.js and its ESLint configuration to 16.3.0, and refresh compatible
  transitive build dependencies so the dependency audit has no active security
  exceptions.
- Keep the desktop workspace Bridge startup pending while macOS is waiting for
  Documents-folder authorization, then resume the same launch automatically
  once the service reports ready instead of showing a false 12-second timeout.
- Restrict desktop interactive preview to declared local assets, including
  assets reachable from inline CSS and module imports, and reject dotfiles,
  undeclared sibling files, escaping symlinks and `file:` resource bases.
- Preserve the AI-Agent cancellation warning after reopening a processing
  Request whose prior clipboard handoff can no longer be proven.
- Fixed project and generated-Version switching so project identity, source
  path, Version authority, HTML bytes and Hash publish together; edit/preview
  canvases now acknowledge the same generation, safe-save status cannot reuse
  stale content, and the “+” project picker automatically repairs one clean
  projection mismatch instead of silently doing nothing.
- Reconciled safe close against the exact frozen HTML bytes so stale Canvas
  Hash or revision projections no longer contradict a “Safely saved” status.
  Matching authoritative bytes now repair the projection silently; confirmed
  external divergence or invalid source integrity stays fail-closed with an
  in-app recovery path. Renderer-owned blockers return to that path without a
  duplicate macOS alert, while missing, timed-out or faulty close coordination
  still uses the native fallback.
- Replaced subtree-exact AI acceptance with a simpler candidate check: complete
  visible HTML is the content requirement, while coarse page continuity routes
  uncertain results into mandatory side-by-side review instead of falsely
  failing broad but valid edits.
- Localized terminal AI errors, fixed long error text overlapping the process
  timeline, reduced duplicate terminal actions to one “Return to editing”
  action, and added a restart-safe “Previous run” entry for reopening the last
  error or no-change outcome.
- Made AI results review-first: ready results now offer a highlighted
  side-by-side review and a secondary direct-open action, with full-page
  change filters, synchronized navigation, and a reversible return-before-AI
  confirmation before the same audited activation path is used.
- Rebuilt the formal AI review workspace around independent page, change
  filter, context visibility, navigation, page-runtime, scrolling and zoom
  state. Page and filter buttons now remain selected independently, map
  navigation no longer changes review display, and single- and dual-page views
  fill the available Canvas with only minimal framing gaps.
- Unified Canvas comments and formal review on one Tab-discovery contract,
  including explicit and strict indexed page controls. Review now coordinates
  both pages through one presentation epoch, removes stale frames immediately,
  keeps dimming continuous while different-height Tabs settle, and converges
  linked vertical scrolling instead of jumping. Every semantic change group
  carries one short label, and its final readable rectangles provide the mask
  holes without a separate dimming geometry. Frozen user comments also
  appear only on the before page as a persistent read-only “评” marker with a
  hover-only bubble.
- Reworked linked review scrolling around a single input owner and a cached,
  monotonic semantic map. The active page now keeps native scrolling and
  momentum while the follower applies only the newest target per frame;
  rapid reversals and side switches invalidate stale work, unequal page
  boundaries no longer pull the longer page to its end, and scroll events no
  longer rebuild overlays or remeasure comment targets. Page-overview jumps
  now invalidate the active gesture before returning both panes to the top,
  and bounded comment coordinates remain available in very long documents.
- Unified review frames and dimming on one typed change footprint. Copy uses
  leaf-level exact ranges and high-confidence pairing instead of tag/position
  guesses. Connected frames merge without crossing columns, contained ancestor
  frames are removed, and the context mask now punches transparent holes from
  those exact final rectangles so frame interiors remain clear. Added copy uses
  green frames, removed copy red, structure blue and visual changes purple;
  repeated short copy and inserted structures no longer create unrelated text
  or visual frames. Before/after controls now use paired stable identities and
  mirror Tabs, disclosures, buttons and form state in both directions even
  while scrolling is independent; unsupported matches degrade silently.
- Made review open directly on the first change in synchronized dual-page All
  mode with 18% context. Added copy keeps the page's authored styling and uses
  one merged dashed frame; removed copy keeps its deletion treatment, while the
  final frame rectangle—not incidental DOM ancestry—defines the fully clear
  region for each Copy/Structure/Visual projection.
  The content map opens to the right of its handle, distinguishes changed rows,
  and dismisses on outside interaction. Linked review now mirrors authored
  page actions and form state, not only Tabs. Return confirmation locates the
  exact candidate HTML, while acceptance keeps review covering the live editor
  until the candidate is rendered, eliminating the waiting-page flash.
- End Canvas selection and native text editing when the user clicks elsewhere
  in the page or App—including blank space in the top bar or comment rail—by
  committing the current checkpoint and removing the edit toolbar and selection
  together. Selection-bound toolbar, comment-card and composer actions remain
  stable long enough to complete their intended operation.
## [0.9.5] - 2026-07-31

- Run desktop interactive previews in a short-lived isolated document so
  authored scripts, relative assets, Tab controls, SVG, Canvas and dynamic
  tables work without weakening the PageRoot renderer CSP.
- Make “Edit” return to the source-backed Tab selected in preview while keeping
  the normal script-disabled editable-island canvas, source bytes and existing
  native-action interception authoritative.
- Keep script-rendered Canvas charts and dynamic table rows visible in Edit as
  bounded, non-editable projections without copying them into source HTML.
- Keep current-tab comments aligned with the Canvas, render Tab comment counts
  as the existing floating violet `评N` marker, and remove redundant current-Tab
  metadata from the comment header. Other-Tab comments now expand as neutral
  saved-comment cards inside that header. Unsaved comments now stay at their
  page position, use one persistent current-Tab shortcut or a tagged card in
  the appropriate other-Tab group, and keep stable document order through
  focus, expansion and Tab changes until explicitly saved or deleted.
- Keep comment-card geometry fixed while actions appear, strengthen the focused
  boundary, align an explicitly selected card by translating the unchanged
  queue, and route wheel input over the rail through the shared page before
  restoring comments hidden above the top edge. Dense comments are now clipped
  at the Canvas page bottom instead of stretching a short HTML page; continued
  wheel input at that bottom pulls the remaining queue into view.
- Treat saved-comment text and attachment edits as one recoverable transaction:
  unchanged edits cancel automatically on Tab changes, while changed but
  unconfirmed edits remain available from an “unsaved modification” shortcut.
- Allow direct text edits beside preserved nested lists and `<wbr>` boundaries
  while keeping those authored structures byte-safe and non-editable.
- Added a concise AI Agent warning before ending a copied run, restored editing
  with a clear manual-stop reminder, and made late official finalization return
  a non-retryable cancelled result without creating a new Version.
- Save an in-place filename edit when the user clicks blank title-bar space,
  matching the existing Enter and click-away behavior without changing file
  identity or version history.
- Let edit mode reveal source-backed Tab panels, including strict explicit-ID
  and constant-number indexed report Tabs, plus native details and local
  disclosure regions from the selection toolbar or Option-click, while links,
  forms, popups, drawers and authored scripts remain inert.
- Keep the HTML identity icon centered on the two-line file summary in all
  three no-update, `New!` and `New! 重启更新` states; the update label overlays
  the icon independently without shifting the title-bar layout.
- Added persistent, source-exact undo and redo for Canvas text, style, safe
  structure and sibling-order edits through the existing macOS Edit menu and
  keyboard shortcuts, including continuation after reopening a project.
- Kept comment, project-rule and other focused text inputs on their native
  field-local undo history without adding a Canvas toolbar action or extending
  product-level undo to cards, attachments and other project operations.
- Restored the active Canvas text host and caret without a visible intermediate
  reload, kept comment anchors stable through undo/redo, and prevented late
  Chinese-composition input from reappearing after project-rule restore.
- Simplified About PageRoot by removing redundant platform, license, telemetry
  and update-channel labels while preserving the current version, architecture,
  update action, repository link and local user notice.
- Made project identity ID-first across comments, attachments, history, AI
  handoff and rapid project switching; equivalent local paths are canonicalized,
  stale project callbacks and unrelated same-path replacements fail closed,
  project-rule saves retain complete identity, and internal identifiers or paths
  are no longer surfaced as user-facing recovery messages.
- Refactored Workbench state into explicit project, document, comment, history,
  version and AI-run sessions, extracted presentation and Canvas modules, and
  retired the unused V1 editing path while keeping the V2 source-patch contract.
- Added governed task worktree audit, synchronization and retirement commands
  so active changes remain visible and protected throughout parallel work, with
  merged retirement proof bound to the exact current branch head.
- Aligned developer-preview and formal-candidate CI evidence validation with
  their preflight, signing, notarization, checkpoint and final-artifact stages
  so packaging cannot stop because of an unsupported stage name.
- Rebuilt the deterministic renderer comparison input in the candidate's fresh
  final-artifact job before revalidating the restored notarized App, while
  keeping the signed checkpoint App immutable.
- Restored the exact embedded build provenance and telemetry configuration from
  that checkpoint before fresh-job payload verification, without regenerating
  configuration or exposing its project token to final packaging.

## [0.9.4] - 2026-07-29

- Increased the workbench header height and bottom breathing room so the
  two-line file summary and all primary actions remain inside the title bar.
- Added compact filename actions for opening another local HTML and opening
  the current known HTML in the system default browser, with small hover and
  keyboard-focus tooltips that do not change header geometry.
- Made default-browser launch wait for the exact current edit revision to be
  safely written, and added fail-closed executable coverage for malformed,
  unknown, unsafe and unauthorized launch requests.

## [0.9.3] - 2026-07-29

- Added an always-visible, bolder plus action beside the current filename that
  opens the local HTML picker through the existing safe project-switch flow,
  while keeping the rename pencil hover-only and independently clickable.

## [0.9.2] - 2026-07-29

- Reframed the first-run welcome project and bilingual GitHub homepage around
  agent-agnostic local handoff, with Claude Code, Codex, WorkBuddy, Qoder and
  other filesystem-capable AI agents presented as compatible choices.
- Added concise AI Agent collaboration positioning to About PageRoot, replaced
  its duplicate update-schedule footer with a fixed local user notice entry,
  and packaged the complete statement and disclaimer with the macOS app.
- Added default-on, pseudonymous product telemetry for module use, project
  flows, edits, saves, faults, notifications and interruptions, with a strict
  no-content allowlist, local batching and an in-product usage-data notice.
- Redesigned the four-stage Qoder handoff flow with aligned numbered cards,
  stage-specific icons and explicit status pills, while moving the divider-free
  footer actions closer to the content.

## [0.9.1] - 2026-07-28

- Upgrade complete 0.9.0 project records additively on first start while
  retaining their existing UUID directories and every historical artifact.
- Clarified generated AI handoff files with PageRoot branding, plain-language
  sections, explicit run identities and clearer default project rules while
  preserving the existing frozen JSON protocol.
- Increased saved-comment text and edit text to 14px, collapsed comment tools
  until hover, keyboard focus or editing, and simplified normal and editing
  cards to one boundary with a compact divider-free action row.
- Name project-record folders from the HTML filename, project creation time and
  a short identity suffix, while retaining the full `projectId` as internal
  metadata.
- Keep Finder's regular `.DS_Store` metadata inert inside live AI Attempt
  folders, and mark an AI return only after the mandatory completion signal
  has actually appeared.
- Added stable-only macOS update checks with user-started differential
  ZIP/blockmap downloads, a restart confirmation, and the existing safe editor
  drain before installation.
- Added four-hour update checks while the app remains open, plus a redesigned
  About PageRoot dialog with manual update checking and the official GitHub
  repository link.
- Kept update status to one right-aligned red italic `New!` label above the
  Qoder handoff button, with no Canvas completion banner, progress animation or
  extra header icon.
- Replaced ad-hoc distribution with fail-closed Developer ID signing, Hardened
  Runtime, Apple notarization and candidate verification of both DMG and updater
  assets while retaining the legacy manifest for one-time migration.
- Added safe in-place filename editing for the current HTML: double-click the
  saved title, edit only its stem, and keep the same file bytes, Project,
  Document and Version history through collision checks and crash recovery.

## [0.9.0] - 2026-07-28

- Promoted the editable-island editor from the isolated V2 comparison build to
  the official PageRoot application, installer and GitHub update channel.
- Replaced the production native-text state machine with one controlled editable
  island route: outside bytes stay exact, while the edited island may be
  minimally normalized for visual, semantic and structural safety.
- Added deterministic start/middle/end insertion, grapheme deletion, line
  breaks, plain-text paste, frozen-selection IME replay and left-style boundary
  inheritance across paragraphs, headings, links, buttons, lists, tables,
  preformatted text, vertical writing and immutable embedded atoms.
- Kept edit warnings visible at the application viewport while the HTML page is
  scrolled, and added exhaustive synthetic plus opt-in real-complex-page edit
  censuses with machine-readable success/failure reports.

## [0.8.10] - 2026-07-27

- Allow ordinary typing at editable paragraph starts and ends, inline-style boundaries and link boundaries while preserving the intended neighboring style and exact source whitespace.
- Prevent links and authored controls from navigating while they are being edited, and keep final visible punctuation deletion source-exact.
- Simplify the Canvas comment surface by removing duplicate global-target copy and user-facing undo/redo history.
- Keep dotted PageRoot versions intact in exported HTML filenames.
- Make stale comment-draft reconciliation plus clean close/reopen a mandatory packaged-App release proof, while replacing repeated high-volume UI setup with lower-cost invariant coverage.

## [0.8.9] - 2026-07-26

- Treat already acknowledged deletion tombstones as durable Bridge authority when comparing draft content, so unchanged close and restart drains no longer create redundant operation IDs or advance the draft revision.

## [0.8.8] - 2026-07-26

- Unified project, document, draft, run and close ownership behind typed application services so the renderer and Bridge can no longer advance different identities or revisions.
- Reconcile stale or uncertain comment-draft writes against the authoritative Bridge draft, preserve deletions with durable tombstones, and avoid creating a new draft revision when close or project switch only verifies unchanged content.
- Rebase stale draft operations with stable operation IDs, replay them exactly once, reject impossible revision jumps, and recover the one valid artifact-ahead crash window without resurrecting deleted comments.
- Route close, project switch, Request submission and history boundaries through one drain coordinator; Electron close now waits for the exact source and draft generations while browser `beforeunload` remains browser-only.
- Retain Bridge-unavailable recovery until the Workbench listener acknowledges readiness, then replay it after renderer reloads instead of losing the only recovery action.
- Keep the packaged `parse5`/`entities` runtime on one verified dependency version and reject nested or incomplete Bridge dependency closures before building an installer.
- Keep only one unsaved comment at a time, reopen the processing panel when entering an active run, and preserve the Canvas scroll position when selecting commented content.
- Automatically normalize persisted whole-page comments across restarts so legacy records no longer block Qoder submission or require users to reselect “全局评论”.
- Make global notifications opt-in, automatically recover transient reads and unknown AI outcomes, and keep file, canvas, rule, attachment, and processing feedback in context instead of asking users to repeat failed actions.
- Replace raw scope-code warnings with concise before/after summaries and an explicit “采用这些额外变化” decision.
- Remove the product-level 100-comment cap while retaining virtualized rendering for large review rounds.
- Restored full-fidelity rendering for the frozen HTML preview and made preview/history return bars auto-collapse into a discoverable 2px edge that reopens on hover, focus or click.
- Added architecture contracts, a state-ownership registry, engineering standards, an ADR and executable CI checks that reject direct view-level Bridge/storage writes, duplicate lifecycle authority and uncoordinated drain paths.

## [0.8.7] - 2026-07-24

- Updated the exact App bundle allowlist and its fixture to verify the managed welcome-page module and logo that were added in 0.8.6, allowing a new immutable patch release without moving the failed 0.8.6 tag.

## [0.8.6] - 2026-07-24

- Refined “项目资料” into clear project-rule and Finder record actions, added a safer rules editor with loading/read-only/unsaved states, and prepares project records when the panel is opened.
- Restored the automatic GitHub update result as a compact `Update` action above “发送至 Qoder”; it opens the fixed latest-release page and never downloads silently.
- Isolated Qoder clipboard feedback, Request submission, cancellation, validation waiver, conflict resolution, result activation, and status polling by project and run identity.
- Prevented rapid duplicate submits from creating more than one Request and kept clipboard failures recoverable without disabling other projects.
- Hardened rapid switching and close recovery by rebuilding a missing autosave job from the authoritative in-memory revision and preventing a retired project's failure callback from contaminating the current project.
- Added a non-cancelling close action to the processing panel and made closed drawer overlays stop intercepting the canvas immediately.
- Canonicalized equivalent local paths such as `/var` and `/private/var`, kept one current source identity, and made consecutive generated versions survive relaunch without duplicate-document lockouts.
- Aligned AI supplement instruction identities across recording, sealing, scope validation and history, while allowing only exact before/after values explicitly authorized by an active supplement.
- Added compound-value comment targeting plus a 100-comment hard cap, shared markers and virtualized comment rendering for dense review rounds.
- Unified global and Canvas recovery feedback into one persistent, actionable `NoticeBar`, including safe file, attachment and blocked-edit recovery.
- Reduced repeated release validation by binding the full PR gate to an exact Git Tree Hash, using a fast post-merge smoke, and reusing fresh matching source evidence for installer-only release verification.
- Provision the first-run welcome page as a persistent ordinary HTML project with its own initial workspace, so edits, comments and QoderWork handoff work before users import another file.

## [0.8.5] - 2026-07-23

- Published the 0.8.4 source feature set from a new immutable release tag after the earlier artifact run stopped before publication.
- Updated the packaged-runtime release gate to exercise the current keyboard export path instead of a retired always-visible action.

## [0.8.4] - 2026-07-23

- Expanded source-preserving native text editing to more safely mapped text hosts.
- Added source-owned hard breaks, plain-text multiline paste, and simple paragraph or list-item splitting with undo and redo coverage.
- Reduced repeated DOM scans and draft copying on the native editing hot path.
- Redesigned the review workspace, project/version panels, comment tools, AI handoff state, and built-in welcome page.
- Added paired canvas/comment focus, dense-comment layout, full-bleed edit and preview surfaces, and a compact processing view without an outer scrollbar.
- Reserved the source tag; no installer assets were published after the packaged-runtime gate stopped before publication.

## [0.8.3] - 2026-07-23

- Opened the PageRoot source repository under Apache-2.0.
- Established repository governance, CI, release provenance and reproducible release assets.
- Prevented the packager from publishing before the complete artifact gate succeeds.

## [0.8.2] - 2026-07-23

- Completed the source-preserving native DOM editing path and automated persistence safeguards.
- Added deterministic browser, Electron, AI closed-loop and packaged-artifact gates.
- Added manual GitHub release update checks and PageRoot-branded macOS artifacts.
- Reserved the source tag; no installer assets were published after the release pipeline stopped before publication.

## [0.7.4] - 2026-07-20

- Published the first public macOS release in this repository under the earlier YuanYe artifact name.

[Unreleased]: https://github.com/Charleyli925/Stemmio/compare/v0.9.6...HEAD
[0.9.6]: https://github.com/Charleyli925/PageRoot/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/Charleyli925/PageRoot/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/Charleyli925/PageRoot/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/Charleyli925/PageRoot/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/Charleyli925/PageRoot/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Charleyli925/PageRoot/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Charleyli925/PageRoot/compare/v0.8.10...v0.9.0
[0.8.10]: https://github.com/Charleyli925/PageRoot/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/Charleyli925/PageRoot/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/Charleyli925/PageRoot/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/Charleyli925/PageRoot/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/Charleyli925/PageRoot/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/Charleyli925/PageRoot/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/Charleyli925/PageRoot/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Charleyli925/PageRoot/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Charleyli925/PageRoot/compare/v0.7.4...v0.8.2
[0.7.4]: https://github.com/Charleyli925/PageRoot/releases/tag/v0.7.4
