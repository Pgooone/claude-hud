---
description: Configure HUD display options (layout, language, presets, display elements) while preserving advanced manual overrides
allowed-tools: Read, Write, AskUserQuestion
---

# Configure Claude HUD

**FIRST**: Use the Read tool to load `~/.claude/plugins/claude-hud/config.json` if it exists.

Store current values and note whether config exists (determines which flow to use).

**LANGUAGE**: Every question below has an EN (English) and ZH (简体中文) variant.
Set `LANG_HUD` from the loaded config: `language` is `en` (or missing) → use EN;
`zh-Hans` / `zh-Hant` / `zh` / `zh-TW` → use ZH. Show the variant matching
`LANG_HUD` for each AskUserQuestion below; technical prose stays English.

## Core Features (on by default)

These default to ON and are what most users keep. They ARE configurable
(`display.showModel`, `display.showContextBar`), but the guided flow keeps them
enabled — toggle them by editing `config.json` directly if needed:
- Model name `[Opus]`
- Context bar `████░░░░░░ 45%`

Advanced settings such as `colors.*`, `pathLevels`, `maxWidth`, `forceMaxWidth`,
`elementOrder`, `projectLineOrder`, `display.mergeGroups`, `display.timeFormat`, `display.contextValue`,
`display.modelFormat`, `display.modelOverride`, `display.modelSource`, `display.showProvider`,
`display.providerName`, `display.autocompactBuffer`,
`display.autoCompactWindow`, `display.promptCacheTtlSeconds`,
`display.usageThreshold`, `display.sevenDayThreshold`,
`display.environmentThreshold`, `display.contextWarningThreshold`,
`display.contextCriticalThreshold`, `display.advisorOverride`,
`display.showAuth`, `display.showAuthUser`, `display.authUserLength`, and the
`display.externalUsage*` keys, plus `jjStatus.showDirty` and
`jjStatus.showConflicts`, are preserved when saving but are not edited by this
guided flow.

---

## Two Flows Based on Config State

### Flow A: New User (no config)
Questions: **Layout → Preset → Language → Turn Off → Turn On → Custom Line**

### Flow B: Update Config (config exists)
Questions: **Turn Off → Turn On → Git Style → Layout/Reset → Language → Custom Line** (6 questions max)

---

## Flow A: New User (6 Questions)

### Q1: Layout
- header: "Layout" / "布局"
- question: EN: "Choose your HUD layout:" | ZH: "选择 HUD 布局："
- multiSelect: false
- options:
  - EN: "Expanded (Recommended)" - Split into semantic lines (identity, project, environment, usage) | ZH: "Expanded（推荐）—— 语义分行的多行布局"
  - EN: "Compact" - Everything on one line | ZH: "Compact —— 单行紧凑布局"
  - EN: "Compact + Separators" - One line with separator before activity | ZH: "Compact + 分隔符 —— 活动区前带分隔线的单行布局"

### Q2: Preset
- header: "Preset" / "预设"
- question: EN: "Choose a starting configuration:" | ZH: "选择起始配置："
- multiSelect: false
- options:
  - EN: "Full" - Everything enabled (Recommended) | ZH: "Full —— 全部开启（推荐）"
  - EN: "Essential" - Activity + git, minimal info | ZH: "Essential —— 活动 + git，信息精简"
  - EN: "Minimal" - Core only (model, context bar) | ZH: "Minimal —— 仅核心（模型、上下文条）"

### Q3: Language
- header: "Language" / "语言"
- question: EN: "Choose your HUD label language:" | ZH: "选择 HUD 标签语言："
- multiSelect: false
- options:
  - EN: "English (Recommended)" - Default, simplest onboarding path | ZH: "English（推荐）—— 默认，最简上手路径"
  - "简体中文" - EN: Show HUD labels and status text in Simplified Chinese | ZH: 显示简体中文标签
  - "繁體中文" - EN: Show HUD labels and status text in Traditional Chinese | ZH: 显示繁體中文标签

Save as `language: "en"`, `language: "zh-Hans"`, or `language: "zh-Hant"`.

### Q4: Turn Off (based on chosen preset)
- header: "Turn Off" / "关闭"
- question: EN: "Disable any of these? (enabled by your preset)" | ZH: "要关闭哪些？（当前由预设开启）"
- multiSelect: true
- options: **ONLY items that are ON in the chosen preset** (max 4)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Project name" - my-project path display
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Git status" - git:(main*) branch indicator
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Output speed" - out: 42.1 tok/s
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format
  - "Session duration" - ⏱️ 5m
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)
  - "Plancost 额度显示" - EN: Third-party plan usage/balance (Kimi/DeepSeek/GLM), needs API keys | ZH: 第三方套餐额度/余额显示（Kimi/DeepSeek/GLM），需填 key

### Q5: Turn On (based on chosen preset)
- header: "Turn On" / "开启"
- question: EN: "Enable any of these? (disabled by your preset)" | ZH: "要开启哪些？（当前由预设关闭）"
- multiSelect: true
- options: **ONLY items that are OFF in the chosen preset** (max 4)
  - (same list as above, filtered to OFF items)

**Note:** If preset has all items ON (Full), Q5 shows "Nothing to enable - Full preset has everything!"
If preset has all items OFF (Minimal), Q4 shows "Nothing to disable - Minimal preset is already minimal!"

### Q6: Custom Line (optional)
- header: "Custom Line" / "自定义短语"
- question: EN: "Add a custom phrase to display in the HUD? (e.g. a motto, max 80 chars)" | ZH: "要在 HUD 中显示自定义短语吗？（如座右铭，最多 80 字符）"
- multiSelect: false
- options:
  - EN: "Skip" - No custom line | ZH: "跳过 —— 不设置"
  - EN: "Enter custom text" - Ask user for their phrase via AskUserQuestion (free text input) | ZH: "输入自定义文本 —— 通过 AskUserQuestion 输入"

If user chooses "Enter custom text", use AskUserQuestion to get their text. Save as `display.customLine` in config.

### Q7: Plancost 额度显示
- header: "Plancost" / "套餐额度"
- question: EN: "Configure the plancost segment (Kimi/DeepSeek/GLM usage or balance)?" | ZH: "配置 plancost 额度段（Kimi/DeepSeek/GLM 套餐或余额）？"
- multiSelect: false
- options:
  - EN: "Skip" - Leave plancost disabled (do not write plancost keys) | ZH: "跳过 —— 不启用 plancost"
  - EN: "Enable and configure" - Run the plancost wizard (below) | ZH: "启用并配置 —— 运行 plancost 向导"

**If user chose "Enable and configure"**: run the wizard below; write `plancost.enabled: true` and the collected settings into `~/.claude/plugins/claude-hud/config.json`.

---

## Flow B: Update Config (6 Questions)

### Q1: Turn Off
- header: "Turn Off" / "关闭"
- question: EN: "What do you want to DISABLE? (currently enabled)" | ZH: "要关闭哪些？（当前已开启的）"
- multiSelect: true
- options: **ONLY items currently ON** (max 4, prioritize Activity first)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Project name" - my-project path display
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Git status" - git:(main*) branch indicator
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)
  - "Usage bar style" - ██░░ 25% visual bar (only if usageBarEnabled is true)
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)
  - "Plancost 额度显示" - EN: Turn off third-party plan usage/balance display (`plancost.enabled: false`) | ZH: 关闭第三方套餐额度/余额显示

If more than 4 items ON, show Activity items (Tools, Agents, Todos, Project, Git) first.
Info items (Counts, Tokens, Usage, Speed, Duration) can be turned off via "Reset to Minimal" in Q4.

### Q2: Turn On
- header: "Turn On" / "开启"
- question: EN: "What do you want to ENABLE? (currently disabled)" | ZH: "要开启哪些？（当前已关闭的）"
- multiSelect: true
- options: **ONLY items currently OFF** (max 4)
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Output speed" - out: 42.1 tok/s
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Usage bar style" - ██░░ 25% visual bar (only if usageBarEnabled is false)
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Session duration" - ⏱️ 5m
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)
  - "Plancost 额度显示" - EN: Third-party plan usage/balance (Kimi/DeepSeek/GLM), needs API keys (see Q7) | ZH: 第三方套餐额度/余额显示（Kimi/DeepSeek/GLM），需填 key（见 Q7）

### Q3: Git Style (only if Git is currently enabled)
- header: "Git Style" / "Git 样式"
- question: EN: "How much git info to show?" | ZH: "要显示多少 Git 信息？"
- multiSelect: false
- options:
  - EN: "Branch only" - git:(main) | ZH: "仅分支"
  - EN: "Branch + dirty" - git:(main*) shows uncommitted changes | ZH: "分支 + 未提交标记"
  - EN: "Full details" - git:(main* ↑2 ↓1) includes ahead/behind | ZH: "完整详情（含 ahead/behind）"
  - EN: "File stats" - git:(main* !2 +1 ?3) Starship-compatible format | ZH: "文件统计（Starship 格式）"

**Skip Q3 if Git is OFF** - proceed to Q4.

### Q4: Layout/Reset
- header: "Layout/Reset" / "布局/重置"
- question: EN: "Change layout or reset to preset?" | ZH: "更改布局或重置为预设？"
- multiSelect: false
- options:
  - EN: "Keep current" - No layout/preset changes (current: Expanded/Compact/Compact + Separators) | ZH: "保持当前 —— 不改变布局/预设"
  - EN: "Switch to Expanded" - Split into semantic lines (if not current) | ZH: "切换到 Expanded —— 语义分行"
  - EN: "Switch to Compact" - Everything on one line (if not current) | ZH: "切换到 Compact —— 单行"
  - EN: "Reset to Full" - Enable everything | ZH: "重置为 Full —— 全部开启"
  - EN: "Reset to Essential" - Activity + git only | ZH: "重置为 Essential —— 仅活动 + git"

### Q5: Language
- header: "Language" / "语言"
- question: EN: "Update HUD label language? (current: '{English, 简体中文, or 繁體中文}')" | ZH: "更新 HUD 标签语言？（当前：'{English, 简体中文, or 繁體中文}'）"
- multiSelect: false
- options:
  - EN: "Keep current" - No change | ZH: "保持当前"
  - EN: "English (Recommended)" - Use English HUD labels | ZH: "English（推荐）—— 英文标签"
  - EN: "简体中文" - Use Simplified Chinese HUD labels | ZH: "简体中文标签"
  - EN: "繁體中文" - Use Traditional Chinese HUD labels | ZH: "繁體中文标签"

If user chooses "Keep current", leave `language` unchanged.
If user chooses "English (Recommended)", save `language: "en"`.
If user chooses "简体中文", save `language: "zh-Hans"`.
If user chooses "繁體中文", save `language: "zh-Hant"`.

### Q6: Custom Line (optional)
- header: "Custom Line" / "自定义短语"
- question: EN: "Update your custom phrase? (currently: '{current customLine or none}')" | ZH: "更新自定义短语？（当前：'{current customLine or none}'）"
- multiSelect: false
- options:
  - EN: "Keep current" - No change (skip if no customLine set) | ZH: "保持当前"
  - EN: "Enter custom text" - Set or update custom phrase (max 80 chars) | ZH: "输入自定义文本（最多 80 字符）"
  - EN: "Remove" - Clear the custom line (only show if customLine is currently set) | ZH: "移除 —— 清除自定义短语"

If user chooses "Enter custom text", use AskUserQuestion to get their text. Save as `display.customLine` in config.
If user chooses "Remove", set `display.customLine` to `""` in config.

### Q7: Plancost 额度显示
- header: "Plancost" / "套餐额度"
- question: EN: "Update plancost settings? (currently: {enabled ? 'enabled (' + displayMode + ')' : 'disabled'})" | ZH: "更新 plancost 设置？（当前：{enabled ? '已启用（' + displayMode + '）' : '未启用'}）"
- multiSelect: false
- options:
  - EN: "Keep current" - No change | ZH: "保持当前"
  - EN: "Edit providers" - Add/update/remove provider keys and model prefixes (run the wizard below) | ZH: "编辑供应商 —— 增改删 key 和模型前缀"
  - EN: "Switch display mode" - Toggle between auto (按模型) and all (全部显示) — ask which with AskUserQuestion | ZH: "切换显示模式 —— auto/all 二选一"
  - EN: "Change position" - Re-run the position question (see wizard step 4 below) | ZH: "改位置 —— 重新选择段位置"
  - EN: "Disable plancost" - Set `plancost.enabled: false` (only when currently enabled) | ZH: "停用 plancost —— 设为 enabled: false"
  - EN: "Enable and configure" - Enable and run the wizard (only when currently disabled) | ZH: "启用并配置 —— 启用并运行向导"

---

## Plancost 设置向导（Q7 共用）

**安全红线（全程遵守）**：API key 只能通过文件写入 API（Write/Edit 工具 + JSON 序列化）写入 `~/.claude/plugins/claude-hud/config.json`。**严禁**把 key 放进 shell 命令行参数、echo 输出、settings.json 或任何命令字符串（防进程列表泄露）。写入后提醒用户 key 为明文存储。

**官方登录检测（启用场景）**：当从"未启用"切换到"启用"时，先按 setup.md Step 4.6.0 的判定逻辑检测 Anthropic 官方 OAuth（读 `~/.claude/settings.json` env + `~/.claude.json` oauthAccount）；若判定为 OFFICIAL_OAUTH，AskUserQuestion（双语）提示："已检测到官方 coding plan（usage 段已显示官方额度），是否还要启用第三方 plancost？" → 仍启用 / 跳过。中转/API key/Bedrock 等场景不提示。

1. **逐家询问**（Kimi → DeepSeek → 智谱 GLM，AskUserQuestion 双语，每家独立）：
   - EN: "Enable {provider} plancost display?" | ZH: "启用 {provider} 的 plancost 额度显示？"
   - EN: "Enter key and enable" | ZH: "填写 key 并启用"（选 Other 输入 key）；EN: "Skip" | ZH: "跳过"（保留现有 key 时用 "Keep current" 选项）
   - key 格式：Kimi `sk-kimi-...`；DeepSeek `sk-...`；GLM `{id}.{secret}` 不含 `sk-` 前缀
2. **模型前缀**：默认建议 Kimi `["k3","kimi"]`、DeepSeek `["deepseek"]`、GLM `["glm","chatglm"]`，用户可 Other 输入自定义（逗号分隔）
3. **显示模式**：EN: "auto（按模型）" | ZH: "auto（推荐）按当前主对话模型自动切换" / EN: "all" | ZH: "all 同时显示全部"
4. **排布位置**：EN: "After cost (default)" | ZH: "费用之后（默认，不写 projectLineOrder）" / EN: "After model" | ZH: "模型名之后（`["model","plancost"]`）" / EN: "First" | ZH: "行首（`["plancost"]`）" / EN: "Last" | ZH: "行尾（完整 11 项顺序）"
5. **写入 config.json**：`plancost` 块与现有键合并写入（只写用户选中的键），格式：
   ```json
   { "plancost": { "enabled": true, "displayMode": "auto",
     "providers": { "kimi": { "apiKey": "...", "models": ["k3","kimi"] } } } }
   ```

---

## Preset Definitions

**Full** (everything ON):
- Activity: Tools ON, Skills ON, MCP ON, Agents ON, Todos ON
- Info: Added Dirs ON, Counts ON, Tokens ON, Usage ON, Reset Label ON, Cost ON, Duration ON, Session Name ON, Session Tokens ON, Reasoning Level ON, Output Style ON, Memory ON, Prompt Cache ON, CC Version ON, Compactions ON, Advisor ON
- Git: ON (with dirty indicator, no ahead/behind)
- Jujutsu: ON (opted in, with dirty and conflict indicators)

**Essential** (activity + git):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration ON, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)
- Jujutsu: OFF

**Minimal** (core only — this is the default):
- Activity: Tools OFF, Agents OFF, Todos OFF
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration OFF, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)
- Jujutsu: OFF

---

## Layout Mapping

| Option | Config |
|--------|--------|
| Expanded | `lineLayout: "expanded", showSeparators: false` |
| Compact | `lineLayout: "compact", showSeparators: false` |
| Compact + Separators | `lineLayout: "compact", showSeparators: true` |

---

## Language Mapping

| Option | Config |
|--------|--------|
| English (Recommended) | `language: "en"` |
| 简体中文 | `language: "zh-Hans"` |
| 繁體中文 | `language: "zh-Hant"` |

---

## Git Style Mapping

| Option | Config |
|--------|--------|
| Branch only | `gitStatus: { enabled: true, showDirty: false, showAheadBehind: false, showFileStats: false }` |
| Branch + dirty | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false }` |
| Full details | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: true, showFileStats: false }` |
| File stats | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: true }` |

---

## Element Mapping

| Element | Config Key |
|---------|------------|
| Model name | `display.showModel` |
| Context bar | `display.showContextBar` |
| Tools activity | `display.showTools` |
| Skills activity | `display.showSkills` |
| MCP status | `display.showMcp` |
| Agents status | `display.showAgents` |
| Todo progress | `display.showTodos` |
| Project name | `display.showProject` |
| Added directories | `display.showAddedDirs` (layout via `display.addedDirsLayout`) |
| Git status | `gitStatus.enabled` |
| Jujutsu status | `jjStatus.enabled` |
| Config counts | `display.showConfigCounts` |
| Token breakdown | `display.showTokenBreakdown` |
| Output speed | `display.showSpeed` |
| Session cost | `display.showCost` |
| Routed provider cost | `display.showRoutedCost` |
| Usage limits | `display.showUsage` |
| Usage bar style | `display.usageBarEnabled` |
| Compact usage | `display.usageCompact` |
| Usage value | `display.usageValue` |
| Usage reset label | `display.showResetLabel` |
| Session name | `display.showSessionName` |
| Auth method | `display.showAuth` (plan label, e.g. "Claude Max 20x", own segment at end of first line) |
| Auth user | `display.showAuthUser` (login account, truncated to `display.authUserLength` chars, 0 = full) |
| Session duration | `display.showDuration` |
| Session tokens | `display.showSessionTokens` |
| Session start date | `display.showSessionStartDate` |
| Last response time | `display.showLastResponseAt` |
| Compaction count | `display.showCompactions` |
| Reasoning level | `display.showEffortLevel` |
| Output style | `display.showOutputStyle` |
| Memory usage | `display.showMemoryUsage` |
| Prompt cache | `display.showPromptCache` (TTL via `display.promptCacheTtlSeconds`) |
| Claude Code version | `display.showClaudeCodeVersion` |
| Advisor model | `display.showAdvisor` (override via `display.advisorOverride`) |
| Custom line | `display.customLine` |
| Custom line position | `display.customLinePosition` |

**Defaults to ON (configurable booleans, kept enabled by the guided flow):**
- `display.showModel` (default `true`)
- `display.showContextBar` (default `true`)

---

## Usage Style Mapping

| Option | Config | Example |
|--------|--------|---------|
| Bar style | `usageBarEnabled: true` | `Usage ██░░ 25% (resets in 1h 30m)` |
| Text style | `usageBarEnabled: false` | `Usage 5h 25% (resets in 1h 30m)` |
| Compact | `usageCompact: true` | `5h: 25% (1h 30m)` — no "Usage" label, shorter reset format |

`usageCompact` takes precedence over `usageBarEnabled` when both are set. Compact mode always uses the text format (no bar).

**Note**: Usage style only applies when `display.showUsage: true`. When 7d usage >= 80%, it also shows with the same style.
Set `display.usageValue: "remaining"` manually to show remaining quota percentages while keeping warning thresholds based on used quota.

---

## Processing Logic

### For New Users (Flow A):
1. Apply chosen preset as base
2. Apply chosen language
3. Apply Turn Off selections (set those items to OFF)
4. Apply Turn On selections (set those items to ON)
5. Apply chosen layout

### For Returning Users (Flow B):
1. Start from current config
2. Apply Turn Off selections (set to OFF, including usageBarEnabled if selected)
3. Apply Turn On selections (set to ON, including usageBarEnabled if selected)
4. Apply Git Style selection (if shown)
5. If "Reset to [preset]" selected, override with preset values
6. If layout change selected, apply it
7. If language change selected, apply it

---

## Before Writing - Validate & Preview

**GUARDS - Do NOT write config if:**
- User cancels (Esc) → say "Configuration cancelled."
- No changes from current config → say "No changes needed - config unchanged."

**Show preview before saving:**

1. **Summary of changes:**
```
Layout: Compact → Expanded
Language: English → 中文
Git style: Branch + dirty
Changes:
  - Usage limits: OFF → ON
  - Config counts: ON → OFF
```

2. **Preview of HUD (Expanded layout):**
```
[Opus | Pro] │ my-project git:(main*)
Context ████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
◐ Edit: file.ts | ✓ Read ×3
▸ Fix auth bug (2/5)
```

**Preview of HUD (Compact layout):**
```
[Opus | Pro] ████░░░░░ 45% | my-project git:(main*) | 5h: 25% | ⏱️ 5m
◐ Edit: file.ts | ✓ Read ×3
▸ Fix auth bug (2/5)
```

3. **Confirm**: "Save these changes?"

---

## Write Configuration

Write to `~/.claude/plugins/claude-hud/config.json`.

Merge with existing config, preserving:
- `pathLevels` (not in configure flow)
- `display.usageThreshold` (advanced config)
- `display.environmentThreshold` (advanced config)
- `display.contextWarningThreshold` (advanced config)
- `display.contextCriticalThreshold` (advanced config)
- `colors` (advanced manual palette overrides)

**Migration note**: Old configs with `layout: "default"` or `layout: "separators"` are automatically migrated to the new `lineLayout` + `showSeparators` format on load.

---

## After Writing

Say: "Configuration saved! The HUD will reflect your changes immediately."
