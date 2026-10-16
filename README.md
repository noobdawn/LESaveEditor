# LE Save Editor — Last Epoch 存档同步修改器

[在线使用](https://noobdawn.github.io/LESaveEditor/) · [源代码](https://github.com/noobdawn/LESaveEditor)

在 LastEpochTools 配装，将分享链接同步到离线角色存档，再按需修改世界线和阵营。网页在浏览器中处理文件，支持右上角中英文切换，无需 Python、油猴或后端。

当前数据基准：**游戏 1.5.2.1 / 内部版本 1.5.2.2，Steam build 25816319**。接受 1.5.x 配装，并按当前游戏目录验证物品、天赋与技能。

## 使用流程

1. **配装链接**：粘贴 LastEpochTools 的“保存／分享”链接。修改已有角色时，点击“我想修改自己的存档怎么办？”查看 GIF 教学，先将角色通过原站“导入”，调整后取得新链接。
2. **配装同步**：选择装备（含祭坛）、神像、祝福、被动天赋、技能专精与技能栏。**等级、职业和专精始终按配装同步**，没有关闭选项。可开启“词缀最大 Roll 值”和默认关闭的“速通至异界”（感叹号可悬停或聚焦查看说明）。
3. **上传存档**：先退出游戏并备份，再载入一个 `1CHARACTERSLOT_BETA_*` 角色文件；要修改阵营，同时载入界面提示的对应 `STASH_CYCLE_*` 仓库文件。
4. **世界编辑**：下拉选择存档已有的普通／强化世界线，填写稳定值和腐化值；可快捷增加 1000 稳定值或 50 腐化。下拉选择已有阵营，调整阶级与恩惠。
5. **修改预览**：检查角色、世界线、阵营变化，以及可展开的物品、天赋和技能明细。勾选“我已了解”后，分别下载修改过的角色与仓库文件。**下载为游戏原生文件，不打包。**

保持游戏关闭，将下载文件替换到原存档目录中的同名文件，保留原始备份，再进入离线角色检查。浏览器可能为重复下载添加 `(1)` 后缀，放回时须恢复页面列出的原文件名。

Windows 存档位置（上传和下载页也会显示）：

```text
%USERPROFILE%\AppData\LocalLow\Eleventh Hour Games\Last Epoch\Saves
```

选择文件只交给浏览器本机读取，存档不上传至服务器或 LastEpochTools。只有配装分享码用于请求公开接口。关闭或刷新会清空会话；仅语言偏好保存在本机。

## 世界编辑规则

- 世界线名称来自当前游戏中英文表；只编辑存档已有记录，不生成缺失或未开启的世界线。普通世界线腐化范围为 0–50，强化世界线最低为 100。稳定值上限按各世界线和难度读取，快捷增加会停在上限。
- 命运之环与商人公会上限 **12 阶**，最高阶累计声望门槛为 **2,051,300**；被编织者上限 **10 阶**，最高阶累计声望门槛为 **291,000**。每阶要求来自当前游戏的 `FactionData`，完整对应表可在界面展开查看。
- 存档 `reputation` 保存的是**本阶内进度**，不是累计声望。变更阶级会把本阶进度设为 0，同时更新角色和对应仓库；仅修改恩惠或保持同阶时保留原声望进度。
- 遗忘骑士团上限 **10 阶**，由先兆进度决定。变更阶级时同时更新已有的 `currentprogression`，保留已击败先兆记录；此阵营没有恩惠输入。
- 阵营修改需要同赛季、同硬核模式的仓库，且只修改角色与仓库共有的已验证记录。独狼模式仓库关联暂未验证，可仅上传角色同步配装和修改世界线。

## 速通至异界

此选项默认关闭。开启后，按当前游戏资源将第 1–10 章主线、支线及锻造教学（76 条任务）写入各自的完成步骤，同时补齐相应目标。解锁地图定义中的 107 个有效离线传送目的地，开启回城传送门，并将下次登录地点设为异界大厅（MonolithHub）。地图中的多条世界线入口共用大厅；解锁目的地不等于完成或解锁其所有难度。

任务奖励遵循游戏上限：15 点被动天赋、8 次神像栏解锁。被动总点数遵循原生公式：等级减 2 加任务奖励，下限为 0（100 级满任务为 113 点）。被动点只补新获得且未计入存档点数的部分，重复应用不重复奖励。神像栏由游戏读取已完成任务后恢复。等级仍按配装同步，不额外发放任务经验、金币或任务物品。

保留已完成任务的原始记录、未知任务与传送点、阵营选择、地下城任务、场景机关/一次性事件及所有已有异界进度；不复制其他角色的存档数据，不伪造异界回响或腐化。商人公会的 Bazaar 不作为新增离线传送目的地。已有世界线仍可在世界编辑页调整；全新角色的回响记录由游戏在开始异界内容时创建。

数据提取工具为 `tools/extract-campaign-data.py`，仅读取游戏目录，不读取用户存档。规则绑定当前 build hash，升级游戏后应重新核对原生任务加载、奖励上限、传送点和登录地点逻辑。当前完成代码与副本读写验证，仍需在游戏中验证登录、地图和任务显示。

## 同步边界

- 选中的装备、神像、祝福范围整体替换，原物品不移入背包。未选范围和背包保留。同时同步装备和神像时，配装未装备祭坛则切换为默认布局；只同步神像时按存档现有祭坛校验。
- “最大 Roll”只应用于本次同步的物品，包括固有、暗金、普通、封印及腐化词缀；保持词缀层级、传奇潜能和 Weaver 属性。关闭时使用配装数值，省略的 Roll 使用中间值。
- 支持当前游戏固定词缀池的暗金变体，包括 Unsated Rage；校验变体类型与数量，同时保留传奇附加词缀。只有变体时允许保留 LP。
- 新生成装备锻造潜能为 0，设为不可交易，并清除商人公会专属物品阵营要求，保留命运之环要求。支持已验证的腐化／毁坏标志、原初词缀与固定腐化暗金；未知功能及茧化等未验证结构会阻止同步。
- 织网者树保留存档原值，暂不导入。技能大于 20 级时仍依赖实际装备或天赋加成。天梯角色导出的基础技能等级与已分配加成点数分开处理；缺失树版本时仍先校验当前节点和前置要求，再写入当前版本。
- 职业变更必须同步被动天赋、技能专精和技能栏；天赋点按原存档与等级差验证。仅主动开启“速通至异界”时，先补齐新获得的任务被动点，再验证配装。
- 界面和世界线、阵营名称支持中英文；部分物品和技能专有名称使用英文游戏数据。
- 已验证当前游戏原生逻辑、存档副本无损读写、公开配装样例和浏览器下载流程。**尚未在游戏内载入生成存档验收。**

## Build 掉落过滤器

配装链接页提供“离线存档同步”和“构造过滤器”两个入口。存档同步保留原来的五步流程与浅色界面；过滤器不需要上传存档，按五步确认需求：

1. **需求暗金**：将 Build 暗金合并到同一清单，按需增删过渡暗金；套装独立列入高价值套装清单。
2. **高价值词缀**：确认装备上的附加词缀集合，排除暗金本体固有属性；独立调整神像需求。
3. **有效词缀**：生命、耐伤、护盾、属性、抗性、护甲、防御和功能八类通用词缀默认全选，可整类或逐项取消，也可搜索补充。高价值词缀同时计入有效数量，其余词缀不计分也不扣分。
4. **隐藏类型**：选择不使用的装备类型、神像形状或职业神像底材，可一键隐藏其他职业神像。暗金和套装先按各自分组处理；所选类型隐藏优先于四类普通装备与神像需求。
5. **分组与导出**：普通装备固定为核心词缀崇高装备、有效词缀崇高装备、考虑打造装备、开荒过渡装备四类，每类一条原生规则并覆盖全部装备类型。可调整显示、颜色和强调后下载 XML。神像、暗金、套装及资源保留独立分组。

全部 1,156 个词缀和 489 个暗金／套装提供官方简中与英文名称。四类装备固定筛选条件，高价值组默认更醒目；可调整显示、颜色与强调。

四类装备依次匹配：崇高且至少一条高价值 T6/T7；崇高且至少一条有效 T6/T7、共三条有效；至少两条有效 T5 及以上且包含高价值；至少一条高价值、共三条有效。T8 同样满足 T6 门槛。无效词缀和空槽不影响结果，未命中的普通装备默认隐藏。未知目标会阻止严格兜底隐藏；暗金相对稀有度不是直接掉率或市场价格。详细规则见 [Build 过滤器](Docs/11-build-loot-filter.md)。

过滤器样式只作用于该分支，不改变存档流程的全局主题。返回链接页、切换语言或回到同一 Build 时保留当前过滤器编辑；刷新页面会清空会话。XML 已进行结构与匹配逻辑验证，游戏内导入验收仍待进行。详见 [研究与数据](Docs/build-to-filter-research.md)。

## 本地运行与 GitHub Pages

使用 Node.js 24。Windows 可双击 `Start-Workshop.cmd`，保持启动窗口开启；或执行：

```sh
npm ci
npm run dev
```

测试与构建：

```sh
npm test
npm run build
```

构建输出位于 `dist/`，资源路径支持 GitHub 项目子目录。通过 HTTP 服务访问，不要直接打开 `index.html`。仓库 Pages 的 Source 选择 **GitHub Actions**；推送 `main` / `master` 后，工作流会先测试、构建，再部署。也可以手动运行部署工作流。

## 维护与来源

- `web/src/core/workflow.js`：五步会话、强制角色同步、确认与原生文件导出。
- `web/src/core/world.js` 与 `web/src/data/world-data.json`：世界线、阵营联动校验与本地化事实。
- `web/src/core/save.js`：EPOCH + JSON 无损读写，保留未知字段和大整数。
- `web/src/core/items.js`：当前第 6 版物品字节编码，外层 `formatVersion: 2`。
- `tools/`：游戏更新后的数据提取与复核工具，见 [维护说明](tools/README.md)。Python 仅用于维护。

旧 Python 客户端和油猴脚本已从当前源码移除，历史实现可在 Git 记录中查看。网页未镜像或执行原站前端脚本。LastEpochTools 与本项目相互独立；游戏、名称和数据归原权利人所有。见 [依赖及数据来源](THIRD_PARTY.md)。私人存档、游戏二进制和研究缓存不参与提交与发布。

## English

Enter a LastEpochTools share URL → select sync options → upload saves → edit timelines and factions → review and download. The tutorial link explains how to import an existing offline character into the original planner and generate a new share URL.

Character level, class and mastery always follow the build. Optional maximum rolls affect only synchronized items. Timeline and faction names use the installed game’s English and Chinese localization. Timeline values respect difficulty-specific caps; faction ranks update the matching character and stash together, using rank-local reputation rather than cumulative totals. Forgotten Knights also updates its existing Harbinger progression.

Review the changes, acknowledge them, then download each modified save separately with its native filename. No ZIP is produced. Saves stay in the browser. Close the game and back up originals before replacing files in `%USERPROFILE%\AppData\LocalLow\Eleventh Hour Games\Last Epoch\Saves`.

Baseline: game **1.5.2.1 / internal 1.5.2.2**. Generated saves have not yet been loaded in the game as an acceptance test. Use Node.js 24, `npm ci`, `npm test` and `npm run build`; the included GitHub Actions workflow publishes the static `dist/` output.
