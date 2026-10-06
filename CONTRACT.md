# AYCHO Web —— 三份并行开发的接口契约 v1（冻结）

> 任何一份（A/B/C）都**不得修改**本文件约定的名称、事件名、挂载点、类名前缀。
> 违反契约 = 合并失败。

## 0. 目录与归属

```
aycho-web/
├── index.html              ← A 独占（B/C 禁止创建或修改）
├── css/
│   ├── tokens.css          ← A 独占（设计变量，全员只读）
│   ├── base.css            ← A
│   ├── shell.css           ← A（左栏 / 顶栏 / 布局）
│   ├── auth.css            ← A（登录页）
│   ├── chat.css            ← A（主页 / 对话页 / 输入框）
│   ├── panel-right.css     ← B（右侧边栏 5 面板，类名前缀 rb-）
│   ├── settings.css        ← C（设置中心，类名前缀 st-）
│   └── overlay.css         ← C（分享 / 预览 / 元素选择，类名前缀 ov-）
├── js/
│   ├── store.js            ← A 独占（状态 + 总线 + 注册表）
│   ├── utils.js            ← A 独占（DOM/格式化/下载/toast/图标）
│   ├── boot.js             ← A
│   ├── auth.js  shell.js  chat.js                ← A
│   ├── rb-index.js rb-terminal.js rb-artifacts.js rb-files.js rb-browser.js rb-ide.js   ← B
│   ├── st-settings.js st-api.js st-skills.js st-mcp.js st-memory.js st-general.js       ← C
│   └── ov-share.js ov-preview.js ov-picker.js    ← C
├── assets/                 ← A（图标 / 开屏动画 SVG）
├── server/                 ← B 独占（真实 pty 终端后端，Node，可选）
└── DEPLOY.md               ← C（域名与免费部署指南）
```

**硬规则：只允许创建/修改「归你」的文件。他人文件做到只读引用。**

## 1. 全局命名空间

- 唯一全局变量：`window.AYCHO`（其余一律 IIFE 内部私有）。
- 每个 JS 文件首行注释格式：
  `/* AYCHO module: <name> | owner: <A|B|C> | contract: v1 */`
- 所有模块必须写在 IIFE 内，且以 `window.AYCHO = window.AYCHO || {}` 开头（防止加载顺序问题）。
- **禁止外部 CDN 依赖**（离线可用），唯一例外：B 的终端面板允许 CDN 引 `xterm`，但必须提供无 xterm 时的降级自绘终端。

## 2. 状态与总线（由 store.js 提供，只读使用）

```js
AYCHO.store.get()                 // 全量 state
AYCHO.store.get('ui.rightOpen')   // 点路径
AYCHO.store.set('ui.rightOpen', true)
AYCHO.store.set({ ui: { rightTab: 'ide' } })   // 顶层浅合并
AYCHO.store.subscribe(e => {})    // 返回取消函数

AYCHO.bus.on(evt, fn) -> off
AYCHO.bus.emit(evt, payload)
AYCHO.bus.once(evt, fn)
```

### state 结构（冻结字段，可自行扩展子字段，不可改名）

```js
{
  authed:false, user:{name,email,avatar}, passwordStrength:0,
  conversations:[{id,title,createdAt,updatedAt,agentIds:[]}], activeConversationId:null,
  messages:{ [convId]: [ Message ] }, streaming:false,
  providers:[{id,name,baseUrl,keyRef,models:[{id,label,enabled}]}],
  activeModelId:null, reasoning:3, thinking:true,
  agents:[{id,name,desc,color,modelId,builtin}], activeAgentIds:[],
  skills:[{id,name,desc,builtin,enabled,source}],
  mcps:[{id,name,desc,enabled,tools:[]}],
  memories:[{id,text,tags:[],createdAt,convId}],
  artifacts:[{id,name,path,kind,mime,content,url,sharedAt,shareUrl,createdAt}],
  activeArtifactId:null,
  projectFiles:[{id,path,kind,content,updatedAt}],
  share:{enabled:false,slug:null,url:null,items:[]},
  ui:{leftOpen:true,rightOpen:false,rightTab:'terminal',
      view:'home',            // home | chat | settings | share
      settingsTab:'user',     // user | api | skills | mcp | memory | general | advanced
      composerMenu:null, installMenu:false},
  settings:{general:{...}, advanced:{...}}
}
```

### Message 结构（冻结）

```js
{
  id, role:'user'|'assistant'|'tool',
  text:'',                 // 正文（支持极简 markdown：# 标题 / **粗体** / `code` / ```块 / - 列表 / [文本](链接)）
  createdAt,
  agentId:null|string,     // 由哪个子 Agent 产出（主 AI 为 null）
  modelId, reasoning, thinking,
  status:'pending'|'streaming'|'done'|'stopped'|'error',
  steps:[{ id, title, cmd, output, status:'running'|'done'|'error', startedAt, endedAt }],  // 可展开的“正在执行什么指令”
  artifacts:[artifactRef],
  diff:null|{ path, before, after }   // 文件修改对比
}
```

### 事件名（冻结，不得新增同义事件）

```
auth:login {user}         auth:logout
chat:new {conv}           chat:select {id}        chat:deleted {id}      chat:title {id,title}
chat:send {convId,text,attachments,agentIds,modelId,reasoning,thinking}
msg:append {convId,msg}   msg:stream {convId,msgId,delta}   msg:update {convId,msg}
msg:done {convId,msgId}   msg:tool {convId,msgId,tool}      msg:stop {convId}
panel:open {tab}          panel:close             panel:tab {tab}
model:change {modelId}    reasoning:change {level} thinking:toggle {on}
providers:change          agents:change           skills:change          mcps:change
artifact:add {artifact}   artifact:select {id}    artifact:remove {id}
artifact:share {id}       artifact:unshare {id}   artifact:download {id}
file:open {file}          file:save {file}
terminal:run {cmd}        terminal:out {data}     browser:navigate {url}
share:create {slug}       share:stop
settings:open {tab}       settings:close          toast {text,type}
state:change {path,value} registry:add {kind,id,def}  registry:remove {kind,id}
```

## 3. 注册 API（挂载点约定）

```js
AYCHO.register('right-panel', 'terminal', {
  title:'终端', icon:'terminal', order:10,
  mount(container){ /* 自己构建 DOM，绑事件 */ },
  unmount(){ /* 解绑 */ }
});
```

- `kind` 取值：`right-panel`（B）、`settings-panel`（C）、`artifact-viewer`（B）、`install-item`（C）、`command`（任意）。
- 右侧边栏由 **B** 的 `rb-index.js` 渲染容器；A 只提供挂载点 `<aside id="ax-rightbar">` 与开关按钮。
- 设置中心由 **C** 的 `st-settings.js` 渲染到 A 提供的 `<div id="ax-settings-host">` 全屏层。

## 4. A 提供的 index.html 挂载点（B/C 只读使用）

```html
<aside id="ax-leftbar"></aside>          <!-- A 渲染 -->
<header id="ax-topbar"></header>         <!-- A 渲染 -->
<main id="ax-stage"></main>              <!-- A 渲染（home / chat） -->
<aside id="ax-rightbar"></aside>         <!-- B 渲染 -->
<div id="ax-overlay-host"></div>         <!-- C 渲染（分享/预览/元素选择） -->
<div id="ax-settings-host"></div>        <!-- C 渲染 -->
<div id="ax-toasts"></div>               <!-- A 提供，U.toast 写入 -->
```

CSS/JS 引入顺序（index.html 内已固定）：

```
tokens → base → shell → auth → chat → panel-right(B) → settings(C) → overlay(C)
utils → store → icons(inline) → auth → shell → chat → boot
→ rb-*.js (B, 在 boot 之后) → st-*.js / ov-*.js (C, 在 boot 之后)
```

## 5. 设计规范（来自 emilkowalski/skills 的 emil-design-eng）

1. **缓动**：进入用 `ease-out`（`--ax-ease-out`），退出用 `ease-in`（`--ax-ease-in`）；**永远不要**对 enter 动画用 ease-in。
2. **时长**：微交互 120–200ms；面板/抽屉 200–320ms；入场 500ms 上限。悬停反馈 < 150ms。
3. **只动 GPU 友好属性**：`transform` / `opacity` / `filter`；禁止动 `width/height/top/left`（必要时用 `clip-path` 或 `grid-template-rows` 技巧）。
4. **轮廓用半透明描边 + 阴影**，禁止 `border: 1px solid #333` 这类实心硬边；阴影要分层（近处小黑影 + 远处大模糊影 + 顶部 1px 内高光）。
5. **有 origin 的动画**：弹出层从触发按钮方向生长（`transform-origin` 指向触发点），不要从中心炸开。
6. **打断可续**：悬停/按下用 transition（可被打断），不要用 animation（会跳）。
7. **焦点可见**：`:focus-visible` 必须有 2px 描边，禁止 `outline:none`。
8. **触屏**：命中区 ≥ 44×44；`touch-action: manipulation`；`-webkit-tap-highlight-color: transparent`；移动端输入框 `font-size ≥ 16px` 防缩放。
9. **键盘**：所有弹层支持 `Esc` 关闭、`↑↓` 选择、`Enter` 确认（A/B/C 各自的层自己实现）。
10. **滚动**：内部滚动容器加 `overscroll-behavior: contain`；长列表用 `content-visibility:auto`。
11. **不要动画 `box-shadow`/`background-color` 大范围**，用叠加一层 `::after` 的 opacity 过渡。
12. **空状态/加载**必须真实存在（骨架屏 `ax-skel`、空状态 `ax-empty`），不要留白。

## 6. 类名前缀隔离（强制）

| 归属 | 前缀 | 示例 |
|---|---|---|
| A | `ax-` | `.ax-btn`, `.ax-leftbar` |
| B | `rb-` | `.rb-panel`, `.rb-term` |
| C | `st-` / `ov-` | `.st-row`, `.ov-preview` |

禁止跨前缀命名；禁止写全局元素选择器（`div{}`）——只能作用于自己的前缀容器内部。

## 7. 文案与语言

- 所有面向用户文案使用**简体中文**；代码标识符用英文。
- 术语：终端 / 产出物 / 项目文件 / 浏览器 / IDE / 技能 / 记忆 / 模型服务商 / 推理等级 / 思考模式。

## 8. 交付自检（每份提交前必须走一遍）

- [ ] 双击 `index.html`（file://）能直接打开，无控制台报错。
- [ ] 断网可用（无外部请求）。
- [ ] 1440×900 与 390×844 两种视口下不溢出、不重叠。
- [ ] 我的模块在**别人没加载**的情况下不报错（用 `AYCHO.registry.get` 判空）。
- [ ] 所有样式走 `var(--ax-*, fallback)`，tokens.css 缺失时也不崩。
