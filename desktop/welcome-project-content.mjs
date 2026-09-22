export const WELCOME_PROJECT_NAME = "欢迎来到源页.html";
export const WELCOME_LOGO_RELATIVE_PATH = "brand-logo.png";

export const DEFAULT_PROJECT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>源页 · Stemmio</title>
  <style>
    :root {
      --paper: #fffdf8;
      --paper-deep: #f5f1e9;
      --ink: #1f2026;
      --muted: #686871;
      --line: #ddd8cf;
      --violet: #6550e8;
      --violet-soft: #eeeaff;
      --green: #39745a;
      --review-red: #d14b44;
      --review-green: #239b56;
      --review-blue: #1677c8;
      --review-violet: #6d5ce7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ebe8e1;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      width: min(1040px, calc(100% - 40px));
      margin: 28px auto;
      overflow: hidden;
      border: 1px solid rgba(63, 57, 48, .12);
      border-radius: 30px;
      background: var(--paper);
      box-shadow: 0 28px 80px rgba(46, 41, 32, .12);
    }
    .hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(260px, .72fr);
      gap: 54px;
      padding: 44px 50px 54px;
      overflow: hidden;
      color: #f8f6ff;
      background:
        radial-gradient(circle at 86% 2%, rgba(131, 104, 255, .38), transparent 34%),
        linear-gradient(135deg, #1c1b24 0%, #242036 58%, #30265a 100%);
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 68px;
    }
    .brand-lockup { display: flex; align-items: center; gap: 12px; }
    .brand-lockup img {
      width: 42px;
      height: 42px;
      border-radius: 13px;
      box-shadow: 0 10px 26px rgba(14, 10, 50, .34);
    }
    .brand-lockup strong { display: block; font-size: 15px; letter-spacing: .02em; }
    .brand-lockup small { display: block; margin-top: 2px; color: rgba(248, 246, 255, .55); font-size: 10px; letter-spacing: .12em; }
    .demo-badge {
      position: absolute;
      top: 44px;
      right: 50px;
      z-index: 2;
      padding: 7px 11px;
      border: 1px solid rgba(255, 255, 255, .18);
      border-radius: 999px;
      color: rgba(255, 255, 255, .72);
      background: rgba(255, 255, 255, .06);
      font-size: 10px;
      letter-spacing: .08em;
    }
    .eyebrow {
      margin: 0 0 18px;
      color: #bdb2ff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      max-width: 640px;
      margin: 0;
      font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
      font-size: clamp(46px, 5.8vw, 70px);
      font-weight: 400;
      line-height: .98;
      letter-spacing: -.06em;
      text-wrap: balance;
      font-feature-settings: "palt" 1;
    }
    h1 span { display: block; }
    h1 span + span {
      width: max-content;
      max-width: calc(100% - 34px);
      margin-top: 13px;
      margin-left: clamp(26px, 4.2vw, 56px);
      color: #c4b9ff;
      font-size: .91em;
      letter-spacing: -.055em;
      text-shadow: 0 16px 38px rgba(92, 70, 188, .18);
    }
    .intro {
      max-width: 620px;
      margin: 25px 0 0;
      color: rgba(248, 246, 255, .7);
      font-size: 15px;
      line-height: 1.9;
    }
    .hero-foot {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 30px;
    }
    .hero-foot span {
      padding: 8px 11px;
      border-radius: 999px;
      color: rgba(255, 255, 255, .72);
      background: rgba(255, 255, 255, .075);
      font-size: 10px;
    }
    .source-card {
      position: relative;
      z-index: 1;
      align-self: end;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 22px;
      background: rgba(255, 255, 255, .075);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08);
      backdrop-filter: blur(14px);
    }
    .source-card small { color: #bdb2ff; font-size: 10px; letter-spacing: .12em; }
    .source-card h2 { margin: 12px 0 9px; color: #fff; font-size: 22px; line-height: 1.35; }
    .source-card p { margin: 0; color: rgba(248, 246, 255, .62); font-size: 12px; line-height: 1.75; }
    .source-path {
      display: grid;
      gap: 8px;
      margin-top: 25px;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, .13);
    }
    .source-path span { display: flex; align-items: center; gap: 8px; color: rgba(255, 255, 255, .7); font-size: 10px; }
    .source-path i { width: 6px; height: 6px; border-radius: 50%; background: #8de0af; box-shadow: 0 0 0 4px rgba(141, 224, 175, .1); }
    .content { padding: 58px 50px 48px; }
    .section-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 28px;
      margin-bottom: 26px;
    }
    .section-heading small { color: var(--violet); font-size: 10px; font-weight: 750; letter-spacing: .14em; }
    .section-heading h2 { max-width: 570px; margin: 8px 0 0; font: 600 32px/1.28 "Songti SC", "STSong", serif; }
    .section-heading p { max-width: 330px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.75; }
    .promise-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-block: 1px solid var(--line); }
    .promise { min-height: 188px; padding: 28px 30px; border-bottom: 1px solid var(--line); }
    .promise:nth-child(odd) { padding-left: 0; }
    .promise:nth-child(even) { padding-right: 0; border-left: 1px solid var(--line); }
    .promise:nth-child(n + 3) { border-bottom: 0; }
    .promise-index { color: var(--violet); font: 700 10px/1 system-ui; letter-spacing: .12em; }
    .promise h3 { margin: 27px 0 10px; font-size: 18px; }
    .promise p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .review-showcase {
      display: grid;
      grid-template-columns: .8fr 1.55fr;
      gap: 38px;
      margin-top: 58px;
      padding: 38px;
      border: 1px solid #dedaf5;
      border-radius: 24px;
      background: linear-gradient(135deg, #faf9ff 0%, #f2f0ff 100%);
    }
    .review-copy { align-self: center; }
    .review-copy > small { color: var(--violet); font-size: 10px; font-weight: 750; letter-spacing: .14em; }
    .review-copy h2 { margin: 13px 0 15px; font: 600 29px/1.35 "Songti SC", "STSong", serif; }
    .review-copy > p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .review-points { display: grid; gap: 10px; margin-top: 24px; }
    .review-points span { display: grid; grid-template-columns: 24px 1fr; gap: 7px; color: #565561; font-size: 10px; line-height: 1.5; }
    .review-points b { color: var(--violet); font-size: 9px; letter-spacing: .08em; }
    .review-demo {
      min-width: 0;
      padding: 8px;
      border: 1px solid #dcdae5;
      border-radius: 15px;
      background: #ececf1;
      box-shadow: 0 18px 34px rgba(42, 36, 86, .1);
    }
    .review-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 7px;
      padding: 6px;
      border: 1px solid #e4e3ea;
      border-radius: 9px;
      background: rgba(255, 255, 255, .96);
    }
    .review-toolbar > div { display: flex; gap: 2px; padding: 2px; border-radius: 7px; background: #f1f1f5; }
    .review-toolbar span { padding: 5px 7px; border-radius: 5px; color: #81808a; font-size: 7px; font-weight: 650; white-space: nowrap; }
    .review-toolbar .mode-active { background: #fff; color: #4f47b8; box-shadow: 0 1px 4px rgba(20, 20, 36, .1); }
    .review-pages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; }
    .review-page { min-width: 0; overflow: hidden; border: 1px solid #d9dade; border-radius: 7px; background: #fff; }
    .review-page > header { height: 28px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border-bottom: 1px solid #ececf0; background: #fafafd; }
    .review-page > header i { width: 6px; height: 6px; border-radius: 50%; background: #9698a2; box-shadow: 0 0 0 3px rgba(150, 152, 162, .09); }
    .review-page.review-after > header i { background: #6258d6; box-shadow: 0 0 0 3px rgba(98, 88, 214, .1); }
    .review-page > header strong { color: #3c3c45; font-size: 8px; }
    .review-page > header small { color: #9999a2; font-size: 7px; }
    .review-sheet { position: relative; min-height: 225px; padding: 24px 18px 20px; overflow: hidden; }
    .review-kicker { color: #9b9aa4; font-size: 7px; font-weight: 750; letter-spacing: .12em; }
    .review-sheet h3 { margin: 8px 0 15px; color: #7a7981; font: 600 15px/1.35 "Songti SC", "STSong", serif; }
    .review-frame {
      position: relative;
      margin: 0 0 14px;
      padding: 9px 10px;
      border: 2px dashed currentColor;
      border-radius: 6px;
      background: #fff;
      font-size: 9px;
      line-height: 1.65;
    }
    .review-frame em {
      position: absolute;
      right: 0;
      bottom: calc(100% + 4px);
      padding: 3px 6px;
      border: 1px solid rgba(98, 88, 214, .2);
      border-radius: 5px;
      background: rgba(255, 255, 255, .96);
      color: #514ba9;
      box-shadow: 0 3px 9px rgba(30, 25, 70, .1);
      font-size: 7px;
      font-style: normal;
      font-weight: 700;
      white-space: nowrap;
    }
    .review-frame.removed { color: var(--review-red); text-decoration: line-through dashed; text-decoration-thickness: 1px; }
    .review-frame.added { color: #3d3c43; border-color: var(--review-green); }
    .review-card { padding: 12px; border: 2px dashed var(--review-violet); border-radius: 8px; color: #65646d; background: #fbfaff; font-size: 8px; line-height: 1.55; }
    .review-before .review-card { border-color: #d8d7df; opacity: .46; }
    .review-comment {
      position: absolute;
      right: 13px;
      bottom: 13px;
      width: 25px;
      height: 25px;
      display: grid;
      place-items: center;
      border: 2px solid rgba(255, 255, 255, .94);
      border-radius: 12px;
      background: #6258d6;
      box-shadow: 0 6px 16px rgba(47, 41, 111, .28);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }
    .review-legend { display: flex; flex-wrap: wrap; gap: 9px 12px; padding: 8px 5px 0; color: #767580; font-size: 7px; }
    .review-legend span { display: inline-flex; align-items: center; gap: 4px; }
    .review-legend i { width: 9px; height: 7px; border: 1px dashed currentColor; border-radius: 2px; }
    .review-legend .copy-before { color: var(--review-red); }
    .review-legend .copy-after { color: var(--review-green); }
    .review-legend .structure { color: var(--review-blue); }
    .review-legend .visual { color: var(--review-violet); }
    .workflow {
      display: grid;
      grid-template-columns: .78fr 1.6fr;
      gap: 52px;
      margin-top: 58px;
      padding: 42px;
      border-radius: 24px;
      background: var(--paper-deep);
    }
    .workflow-copy small { color: var(--green); font-size: 10px; font-weight: 750; letter-spacing: .14em; }
    .workflow-copy h2 { margin: 12px 0 14px; font: 600 29px/1.35 "Songti SC", "STSong", serif; }
    .workflow-copy p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .steps { display: grid; gap: 0; }
    .step {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 14px;
      padding: 18px 0;
      border-bottom: 1px solid #d8d2c7;
    }
    .step:first-child { padding-top: 0; }
    .step:last-child { padding-bottom: 0; border-bottom: 0; }
    .step b { color: var(--violet); font: 700 11px/1.6 system-ui; }
    .step strong { display: block; margin-bottom: 5px; font-size: 14px; }
    .step span { display: block; color: var(--muted); font-size: 11px; line-height: 1.65; }
    .notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-top: 34px;
      padding: 20px 22px;
      border: 1px solid #d9d2f5;
      border-radius: 17px;
      background: #f7f4ff;
    }
    .notice strong { display: block; margin-bottom: 5px; color: #3f35a4; font-size: 13px; }
    .notice span { display: block; color: #706c7d; font-size: 11px; line-height: 1.6; }
    .notice em { flex: none; color: #4e43c6; font-size: 11px; font-style: normal; font-weight: 700; }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 23px 50px 25px;
      border-top: 1px solid var(--line);
      color: #8a888e;
      font-size: 10px;
      letter-spacing: .06em;
    }
    @media (max-width: 760px) {
      .page { width: 100%; margin: 0; border: 0; border-radius: 0; }
      .hero { grid-template-columns: 1fr; gap: 40px; padding: 30px 24px 40px; }
      .demo-badge { top: 30px; right: 24px; }
      .brand-row { margin-bottom: 48px; }
      h1 { font-size: clamp(38px, 10.6vw, 46px); }
      h1 span + span { max-width: calc(100% - 18px); margin-left: 18px; }
      .content { padding: 42px 24px 36px; }
      .section-heading { display: block; }
      .section-heading p { margin-top: 14px; }
      .promise-grid { grid-template-columns: 1fr; }
      .promise,
      .promise:nth-child(odd),
      .promise:nth-child(even) { min-height: 0; padding: 24px 0; border-left: 0; border-bottom: 1px solid var(--line); }
      .promise:last-child { border-bottom: 0; }
      .promise h3 { margin-top: 20px; }
      .review-showcase { grid-template-columns: 1fr; gap: 30px; padding: 30px 24px; }
      .workflow { grid-template-columns: 1fr; gap: 30px; padding: 30px 24px; }
      .notice { align-items: flex-start; flex-direction: column; }
      footer { padding: 20px 24px; }
    }
    @media (max-width: 520px) {
      .review-toolbar { align-items: flex-start; flex-direction: column; }
      .review-pages { grid-template-columns: 1fr; }
      .review-sheet { min-height: 205px; }
    }
  </style>
</head>
<body>
  <article class="page">
    <header class="hero">
      <span class="demo-badge">内置介绍页</span>
      <div>
        <div class="brand-row">
          <div class="brand-lockup">
            <img src="./${WELCOME_LOGO_RELATIVE_PATH}" alt="源页 Logo" />
            <div><strong>源页</strong><small>STEMMIO</small></div>
          </div>
        </div>
        <p class="eyebrow">Visual HTML × AI Agents</p>
        <h1><span>所见，即可落笔。</span><span>所改，止于所选。</span></h1>
        <p class="intro">在真实 HTML 上直接修改；需要 AI 帮忙时，选中页面内容并留下评论，在 AI 面板选择并连接你信任的 Agent。结果回来后，源页把修改前后并排呈现、逐处标出变化；看清之后，再由你决定是否采用。</p>
        <div class="hero-foot"><span>可视化直接编辑</span><span>AI Agent 无缝交接</span><span>修改前后对照审阅</span></div>
      </div>
      <aside class="source-card">
        <small>REVIEW BEFORE ADOPT</small>
        <h2>AI 改完，不用凭感觉验收。</h2>
        <p>源页会把修改前与 AI 修改后并排放在真实页面中，让文案、结构与视觉变化一眼可见。</p>
        <div class="source-path">
          <span><i></i>不同变化分类标出，不用逐行找代码</span>
          <span><i></i>双页同步查看，原评论仍留在原位置</span>
          <span><i></i>查看修改之后，再由你决定采用或不用这次</span>
        </div>
      </aside>
    </header>

    <div class="content">
      <section>
        <div class="section-heading">
          <div><small>CORE EXPERIENCE</small><h2>让人与 AI Agent 自然接力。</h2></div>
          <p>不用在源码里找标签，也不必盲猜 AI 改了什么。你指出意图、审阅结果，源页负责守住源码与版本边界。</p>
        </div>
        <div class="promise-grid">
          <article class="promise"><span class="promise-index">01 / TYPE</span><h3>顺畅的文本编辑</h3><p>安全可编辑的文字，双击就能把光标放到点击位置。输入、删除、选择、粘贴和中文输入法都沿用熟悉的原生体验。</p></article>
          <article class="promise"><span class="promise-index">02 / TARGET</span><h3>指哪改哪的局部修改</h3><p>选中标题就只改标题，选中正文就只改正文。修改以最小源码 Patch 写回，其余 HTML 结构和格式保持不动。</p></article>
          <article class="promise"><span class="promise-index">03 / HANDOFF</span><h3>AI Agent 拿到完整上下文</h3><p>页面目标、评论、图片、文件、项目规则和冻结 HTML 会组成一项本地任务，不用再复制代码或重复说明位置。</p></article>
          <article class="promise"><span class="promise-index">04 / REVIEW</span><h3>看清变化，再决定采用</h3><p>修改前与 AI 修改后并排审阅，文案、结构和视觉变化分别标出；点击“查看修改”后，再选择“采用修改”或“不用这次”。</p></article>
        </div>
      </section>

      <section class="review-showcase">
        <div class="review-copy">
          <small>AI RESULT REVIEW</small>
          <h2>AI 改了什么，先看清，再决定。</h2>
          <p>结果不会自动替换当前页面。审阅从第一处变化开始，把真正需要你判断的地方从整张页面里提出来。</p>
          <div class="review-points">
            <span><b>01</b>文案、结构、视觉变化集中标出</span>
            <span><b>02</b>双页同步滚动，原评论原位可见</span>
            <span><b>03</b>查看修改后，选择采用或不用这次</span>
          </div>
        </div>
        <div class="review-demo" aria-label="修改前与 AI 修改后的双页审阅示意">
          <div class="review-toolbar">
            <div><span class="mode-active">双页</span><span>左页</span><span>右页</span></div>
            <div><span class="mode-active">变化 7 处</span><span>同步滚动</span><span>适应画布</span></div>
          </div>
          <div class="review-pages">
            <article class="review-page review-before">
              <header><i></i><strong>修改前</strong><small>原始 HTML</small></header>
              <div class="review-sheet">
                <span class="review-kicker">产品介绍</span>
                <h3>让 AI 帮你改完页面。</h3>
                <p class="review-frame removed"><em>文案改写</em>结果生成后，直接打开最新版本。</p>
                <div class="review-card">关键模块保持原来的视觉层级。</div>
                <span class="review-comment">评</span>
              </div>
            </article>
            <article class="review-page review-after">
              <header><i></i><strong>AI 修改后</strong><small>候选 HTML</small></header>
              <div class="review-sheet">
                <span class="review-kicker">产品介绍</span>
                <h3>让 AI 修改，也让你看清。</h3>
                <p class="review-frame added"><em>新增文案</em>结果生成后，先对照审阅，再决定是否打开。</p>
                <div class="review-card">关键模块调整了层级、间距与视觉重点。</div>
              </div>
            </article>
          </div>
          <div class="review-legend"><span class="copy-before"><i></i>修改前文案</span><span class="copy-after"><i></i>AI 新文案</span><span class="structure"><i></i>结构变化</span><span class="visual"><i></i>视觉变化</span></div>
        </div>
      </section>

      <section class="workflow">
        <div class="workflow-copy"><small>AI AGENT WORKFLOW</small><h2>你指出。<br />AI Agent 执行。<br />你审阅后决定。</h2><p>Claude Code、Codex、WorkBuddy、Qoder，以及其他能读取本地文件并执行命令的 AI Agent 都可以使用。</p></div>
        <div class="steps">
          <div class="step"><b>01</b><div><strong>在页面上选择和说明</strong><span>直接修改简单内容；复杂要求则锚定到页面、模块或文字，并附上图片和文件。</span></div></div>
          <div class="step"><b>02</b><div><strong>在 AI 面板选择并连接 Agent</strong><span>准确 HTML、目标、评论、附件和项目规则会组成这一轮任务；受管 Agent 与“复制任务”都可以使用。</span></div></div>
          <div class="step"><b>03</b><div><strong>冻结本轮，再交给 Agent</strong><span>发送前源页会冻结当前内容与评论；Agent 只能按这份明确任务读取、修改并返回候选结果。</span></div></div>
          <div class="step"><b>04</b><div><strong>查看修改，明确决定</strong><span>源页先校验并独立保留结果；点击“查看修改”，对照前后页面后选择“采用修改”或“不用这次”。</span></div></div>
        </div>
      </section>

      <aside class="notice">
        <div><strong>这张欢迎页本身，就是一次完整的 AI Agent 协作与审阅入口。</strong><span>双击即可直接编辑；需要 AI 帮忙时，选中内容并留下评论，在 AI 面板选择并连接 Agent。AI 返回后，点击“查看修改”，确认后选择“采用修改”或“不用这次”。</span></div>
        <em>从左侧栏打开或切换 HTML</em>
      </aside>
    </div>

    <footer><span>源页 · Stemmio</span><span>Visual intent in context. AI changes under review.</span></footer>
  </article>
</body>
</html>`;

export const BLANK_PROJECT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>未命名页面</title>
  <style>
    * { box-sizing:border-box; }
    body { margin:0; background:#f2f0ea; color:#202126; font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; }
    main { width:min(820px,calc(100% - 32px)); min-height:720px; margin:32px auto; padding:64px; background:#fffdf8; }
    h1 { margin:0 0 16px; font-size:40px; line-height:1.2; }
    p { color:#626268; }
  </style>
</head>
<body>
  <main>
    <h1>未命名页面</h1>
    <p>双击这段文字开始编辑，或选择内容后添加评论交给 AI Agent。</p>
  </main>
</body>
</html>`;
