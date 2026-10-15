# 当前游戏数据维护

网页运行只需要静态文件。这里的 Python 脚本供开发者在游戏更新后重新核对数据，最终用户不需要安装 Python。

## 世界线与阵营编辑

`extract-world-data.py` 从同一安装的 `PermaLoad.bundle` 提取 10 条世界线的普通／强化稳定值及腐化边界、4 个阵营的逐阶声望要求；从 Addressables 的 Common、UI 中英文字符串表只选取相关名称。当前构建哈希不匹配时拒绝生成。

```powershell
python tools/extract-world-data.py --game-dir 'E:\SteamLibrary\steamapps\common\Last Epoch' --library-dir '.local/research/pylibs' --out '.local/research/world-data.json'
```

复核后替换 `web/src/data/world-data.json`。声望规则除资产数值外，已读取同一构建原生方法：`Faction.get_TotalReputation`（RVA `0x20CB0A0`）跳过第 0 项加入要求，再累计已完成各阶，加上保存的本阶进度；`Faction.LoadFactionStashData`（`0x20C9990`）分别读取 rank、reputation、favor。因此选择新阶级时保存 rank 与本阶 reputation=0，不能把累计声望写进 reputation。

遗忘骑士团重写了 rank 属性：`ForgottenKnights.get_Rank`（`0x20CDB00`）读取 `HarbingersProgress.CurrentProgression`；setter（`0x20CDB30`）设置同一进度。仓库的 `factionSpecific.currentprogression` 会在 `LoadFactionSpecificStashData`（`0x20CD3E0`）载入时恢复，所以修改该阵营阶级必须同时更新已有进度字段。工具不会创建缺失字段或补写先兆击败名单。

这些地址及规则仅对应当前构建。更新游戏后须重新核对，不能只替换数值表。

## 天赋、技能与分享链接

`extract-planner-data.py` 从安装目录中的 `PermaLoad.bundle` 读取当前天赋节点、前置条件、职业技能和解锁要求。技能经验表来自同一安装版本的 Cpp2IL `DiffableCs/LE/_PrivateImplementationDetails_.cs`。需要 Python 和 UnityPy；`--library-dir` 可指定已有的本地依赖目录。

先使用 Cpp2IL 对同一游戏安装生成 `diffable-cs` 输出，再运行：

```powershell
python tools/extract-planner-data.py --game-dir 'E:\SteamLibrary\steamapps\common\Last Epoch' --diffable-cs '.local/research/game-cs/DiffableCs/LE' --library-dir '.local/research/pylibs' --out '.local/research/planner-game-data.js'
```

脚本只读取游戏资产，不访问存档，也不会修改游戏安装。输出包含精简的功能数据和一个独立的来源记录。先在 `.local` 比较输出，复核游戏版本和原生逻辑后，再将 JavaScript 数据替换到 `web/src/data/planner-game-data.js`。不要将原始游戏资源、游戏程序集或私人存档提交到仓库。

目前适配游戏显示版本 `1.5.2.1`、内部版本 `1.5.2.2`，安装构建哈希为 `8dfd6929fe2d10f2e77b7ed4c8e6910f49b2736b`。来源记录中的原生方法地址只适用于这一构建。关键规则已读取当前程序验证：旧天赋版本会触发游戏清空分配，因此只有通过当前节点上限和前置条件校验后，才更新保存的树版本；前置条件采用 OR；未选专精只开放解锁要求不超过 22 点的部分；技能经验等级上限为 20，额外等级由实际装备和天赋决定。

重新提取数据不等于验证了新版存档格式。更新版本后还必须复核这些规则、技能经验表的用途、物品编码和保存结构，运行测试，再使用备份副本在游戏内验收。脚本对布局变化会报错，不会猜测替代字段。

分享链接从 `https://www.lastepochtools.com/api/public/build_data/<分享码>` 读取；接口数据结构没有版本稳定性承诺。`tests/fixtures/planner-om6w3Ypq.json` 是用户提供的公开配装样例，CI 会把它写入合成角色并验证物品编码和技能树。默认测试不需要真实存档：

```powershell
npm test
```

如需只读测试自己的备份角色，可以额外设置下列变量。当前公开样例是侍祭／死灵法师，测试需要对应职业且有足够任务天赋点的备份角色；脚本只在内存应用并序列化，不写回该文件。

```powershell
$env:LE_LOCAL_CHARACTER_FIXTURE = '.local/fixtures/1CHARACTERSLOT_BETA_5'
node --test --test-isolation=none tests/planner.test.js
```

`--test-isolation=none` 是受限 Windows 环境禁止子进程时的运行方式。网站运行和普通 CI 不依赖该选项。

暂未验证的织网者树写入会明确拒绝；高于 20 的技能等级会提示装备与天赋依赖，不伪造超过上限的基础经验等级。

## 装备与词缀名称

`extract-equipment-labels.py` 使用 `extract-game-data.py` 已核验的 `MasterItemsList.json`、`UniqueList.json`、`MasterAffixesList.json` 和 `extraction.json`，生成 `web/src/data/equipment-labels.js`。仅抽取英文名称，优先使用游戏的显示名称字段；没有中文本地化数据时不猜译。未命名的占位条目不输出，由界面显示数字编号。

```powershell
python tools/extract-equipment-labels.py --data-dir '.local/research/game-data' --out 'web/src/data/equipment-labels.js'
```

模块默认导出 `bases`（键为 `baseTypeID:subTypeID`）、`uniques`（键为 `uniqueID`）、`affixes`（键为 `affixId`）和 `baseTypes`（键为 `baseTypeID`），所有值都是名称字符串。生成文件头包含原游戏构建哈希。当前数据有 922 个装备/神像/祝福底材名称、489 个独特物品名称、1156 个词缀名称和 41 个大类名称。

## 物品、神像祭坛与资源目录

以下命令在仓库根目录的 PowerShell 执行，使用本次验证的安装路径。游戏安装在其他位置时，统一替换所有 `--game-dir`、`--force-binary-path` 和 `--force-metadata-path` 中的路径。所有输出先放在被 Git 忽略的 `.local`，三个提取脚本均不读取存档。

### 准备同一游戏构建的程序集

本次验证环境为 Windows x64、Python 3.14、UnityPy 1.25.4、TypeTreeGeneratorAPI 0.0.10，以及 [Cpp2IL 2022.1.0-pre-release.21](https://github.com/SamboyCoding/Cpp2IL/releases/tag/2022.1.0-pre-release.21)。该 Cpp2IL 版本支持当前游戏使用的 IL2CPP metadata v39；旧版提取器不能据此推断当前布局。将该发布页的 Windows x64 可执行文件保存为 `.local/research/Cpp2IL.exe`，然后准备 Python 依赖并核对工具：

```powershell
New-Item -ItemType Directory -Force -Path '.local/research' | Out-Null
python -m pip install --target '.local/research/pylibs' 'UnityPy==1.25.4' 'TypeTreeGeneratorAPI==0.0.10'
Get-FileHash '.local/research/Cpp2IL.exe' -Algorithm SHA256
```

本次使用的 `Cpp2IL.exe` SHA-256 为 `663fb432433b4371fd1ee0ebc321a8fff2a9aac5ac4230c843f9e03ddee4e04c`。工具、DLL 输出和原始资源不随网站发布。

下面两条命令必须使用同一次安装中的 `GameAssembly.dll` 和 `global-metadata.dat`。当前 Unity 版本为 `6000.4.8f1`；游戏更新后须从新安装或启动日志确认新值，不能继续强制使用旧值。第一条生成类型恢复所需的空方法程序集，第二条生成前述天赋提取及原生方法定位所需的 C# 类型、字段和地址信息：

```powershell
& '.local/research/Cpp2IL.exe' --force-binary-path 'E:\SteamLibrary\steamapps\common\Last Epoch\GameAssembly.dll' --force-metadata-path 'E:\SteamLibrary\steamapps\common\Last Epoch\Last Epoch_Data\il2cpp_data\Metadata\global-metadata.dat' --force-unity-version '6000.4.8f1' --output-as dll_empty --use-processor attributeinjector --output-to '.local/research/game-assemblies'
& '.local/research/Cpp2IL.exe' --force-binary-path 'E:\SteamLibrary\steamapps\common\Last Epoch\GameAssembly.dll' --force-metadata-path 'E:\SteamLibrary\steamapps\common\Last Epoch\Last Epoch_Data\il2cpp_data\Metadata\global-metadata.dat' --force-unity-version '6000.4.8f1' --output-as diffable-cs --use-processor attributeinjector --output-to '.local/research/game-cs'
```

`game-assemblies` 必须保留 Cpp2IL 生成的全部 DLL，包括 `LE.dll` 及其依赖，不能仅复制一个 DLL。`dll_empty` 和 `diffable-cs` 都不恢复实际方法体；序列化逻辑仍须根据方法地址读取同一构建的原生机器码验证。

### 提取原始类型数据，再生成网页目录

`extract-game-data.py` 的必填参数是 `--game-dir`、`--assemblies`、`--out`。它读取该安装的 `Last Epoch_Data/resources.assets`、`Last Epoch_Data/StreamingAssets/LEAssetBundles/PermaLoad.bundle`、`Last Epoch_Data/build_hash.txt`，结合上一步的程序集恢复缺少类型树的对象。`--library-dir` 在使用上述隔离依赖目录时必须传入；依赖安装到当前 Python 环境时可以省略。

```powershell
python tools/extract-game-data.py --game-dir 'E:\SteamLibrary\steamapps\common\Last Epoch' --assemblies '.local/research/game-assemblies' --out '.local/research/game-data' --library-dir '.local/research/pylibs'
```

成功后应输出 `UniqueList.json`、`MasterItemsList.json`、`MasterAffixesList.json`、`IdolsContainerGridDataList.json`、`GlobalTreeData.json` 和 `extraction.json`，另有恢复类型树的 `.schema.json`。对象读取启用 `check_read=True`，要求准确消费整个对象的字节。`extraction.json` 记录 Unity 版本、游戏构建哈希及读取对象名单。这些原始文件只留在本机。

`extract-item-catalog.py` 只使用 Python 标准库，必填参数为 `--input` 和 `--output`。输入目录必须包含上述物品、词缀、暗金、祭坛 JSON 和 `extraction.json`：

```powershell
python tools/extract-item-catalog.py --input '.local/research/game-data' --output '.local/research/game-item-data.json'
```

当前输出包含 42 类装备、489 件暗金、1,156 个词缀，以及默认布局和 13 种祭坛的格子矩阵，供 `web/src/core/game-item-data.json` 使用。脚本会检查当前已验证的游戏构建哈希；新构建会报错。必须先复核原生编码和新数据，再更新脚本中的构建哈希及版本，不能直接取消检查来生成“已支持”的新版数据。祭坛矩阵也会检查固定记录结构、终止标记和数量。

`extract-save-catalog.py` 的必填参数是 `--game-dir`、`--game-data`、`--out`，同样支持 `--library-dir`。它使用同一批 `MasterItemsList.json`、`MasterAffixesList.json`，并读取同一安装的 `PermaLoad.bundle` 中的阵营数据：

```powershell
python tools/extract-save-catalog.py --game-dir 'E:\SteamLibrary\steamapps\common\Last Epoch' --game-data '.local/research/game-data' --out '.local/research/save-resource-data.js' --library-dir '.local/research/pylibs'
```

当前输出含 1,156 个词缀名称、140 个资源名称、4 个阵营及其等级上限，供 `web/src/data/save-resource-data.js` 使用。该脚本记录安装构建哈希，但不验证输入 JSON 的构建来源，因此每次必须先运行 `extract-game-data.py`，不能混用旧 JSON 与新安装。名称来自游戏资源，提取步骤本身不会生成额外翻译。

比较 `.local/research` 内的新目录与网页现有目录，完成版本及编码复核后，再替换这两个网页数据文件并运行 `npm test`。开发过程中不要把游戏二进制、完整资源、程序集、私人存档或原始提取结果加入提交。

### 暗金变体

`extract-item-catalog.py` 同时抽取 `dropsSpecificLegendaryAffixes` 物品的 `droppableLegendaryAffixes` 与数量。当前 Unsated Rage（477）、Withstand the Elements（479）、Frostborn Solitude（486）使用 `SpecialAffixType.FakeUniqueMod = 7`；Exulis（469）使用指定池中的 `SpecialAffixType.Corrupted = 6`，按资产的预腐化标志与原配装提供的词缀编码，不能把它们误当作 FakeUniqueMod。

LET 把 Unsated Rage 的单个变体放在 `sealedAffix`。这不是游戏普通物品的封印标志，须验证它属于该暗金的固定池，随后作为普通三字节词缀记录编码；变体与传奇附加词缀均保留。根据当前原生 `GenerateItems.GenerateAffixes`（RVA `0x11C0530`，`0x11C0CD7–0x11C0CF7`）及其筛选方法（`0x11F21D0`），仅 `specialAffixType != 7` 的词缀会使暗金成为传奇并清除 LP。因此只有变体时仍保留暗金稀有度与 LP；存在普通传奇词缀时使用传奇稀有度。`RollAffixes`（`0x11C5E90`）调用 `ItemAffix` 构造器时使用 `SealedAffixType.None`；不能把这个变体伪装为 T8 原初封印或腐化封印。

### 当前物品格式的验证范围

当前保存的物品外层 `formatVersion` 为 2，物品字节数组的 `data[0]` 为 6；这两个版本号含义不同。编码器独立实现于 `web/src/core/items.js`，没有复制 LastEpochTools 的整站脚本。分享 ID 通过类型前缀及标准 LZ-string 解压读取，再由本机提取的当前游戏目录验证对应关系。

本构建核对了原生 `ItemData.RebuildID`（RVA `0x1205e80`）、`setValuesFromSerialisation`（`0x12127e0`）及 `loadAffixFromSerialisation`（`0x1211380`）。补充核对阵营限制：`RebuildID` 的 `0x1206373–0x12063A4` 将物品所需阵营（0 命运之环／1 商人公会）放入 `data[8]` 的 bit 6、所需阶级放入低 4 位；`setValuesFromSerialisation` 的 `0x1212DDF–0x1212EE7` 对应读取阶级、腐化、毁坏、阵营与不可交易标志。LET 从存档导入后产生的 `faction: [阵营编号, 阶级]` 按此编码保留，阶级上限使用同构建阵营数据，不丢弃物品限制。

已确认四字节物品身份、三字节隐含数值、八字节暗金数值、词缀等级与 ID 的打包、普通封印/腐化标志、Weaver 字段及赠礼尾部。C# 类型文件用于定位这些地址，方法行为依据实际原生代码核对。

验证包括 101 件当前本地备份物品“解码→重新编码”逐字节一致、公开样例 33 件装备/神像/祝福导入，以及合成固定字节样例、未知字段拒绝、缺失分区拒绝、祭坛格子和无损大整数保留测试：

```powershell
node --test --test-isolation=none tests/items.test.js tests/planner.test.js
```

物品测试会在存在 `.local/fixtures/1CHARACTERSLOT_BETA_5` 时额外只读检查 `.local/fixtures` 中的备份文件；缺少私人备份时跳过该项，公共测试仍可运行。101 件是本次验证样本数量，不表示覆盖了游戏所有特殊物品。

尚未启动游戏完成修改后存档的实际载入验收。未知序列化版本及未验证的新增物品字段会拒绝转换；未选择修改区域中的未知物品保留原数据。已验证的腐化／毁坏标志、原初词缀以及上述固定池暗金现可生成；茧化、没有已验证固定池的预腐化暗金及未知封印结构仍拒绝生成。祭坛校验永久禁用格及重叠，不自动授予任务解锁格。未指定数值使用 LET 默认中间值（字节 128），新物品锻造潜能为 0，不自动改成满值。正式采用新版格式前仍需使用额外备份在对应游戏版本内验收。

## 天梯前 20 位兼容性验证

`verify-ladder-builds.mjs` 使用从天梯角色页“在构建模拟器中查看”的 DOM 获取的分享码清单，逐人运行正常 Roll 和最大 Roll 两种完整工作流。角色文件只在本机内存应用、预览、导出和重新读取，不写回原文件，不发送给网络。检查身份、天赋技能分配、物品数量／ID／层级／Roll、原初／腐化布局、重复身份、商人公会限制清除，以及背包和世界数据保持不变。公开数据缓存与结果放在 `.local` 或指定的私人输出目录，不提交整份角色配装数据。

```powershell
node tools/verify-ladder-builds.mjs --manifest '.local/ladder-top20-builds.json' --character '.local/fixtures/1CHARACTERSLOT_BETA_5' --cache '.local/ladder-20' --out '.local/ladder-report'
```

清单包含 `profiles` 数组，字段为 `rank`（1–20）、`name`、`className`、`characterUrl`、`buildId`、`plannerUrl`，并记录 `capturedAt`、`source`、赛季、模式与榜单类型。默认复用缓存；加 `--refresh` 才重新请求公开接口。输出 JSON 和 CSV，明确区分 PASS、转换失败和原站数据不可用，不把未获取到配装的角色计为通过。

当前原生物品额外核对：`data[8]` bit 4 腐化、bit 5 毁坏；`data[1]` bit 7 复制来源。普通物品按“普通封印、腐化封印、原初、普通词缀”排序；传奇的腐化封印在末尾，`data[22]` bit 7 标识，与未腐化传奇的剩余 Weaver 位不同（`RebuildID` 的 `0x1206973–0x12069FB`，读取位于 `0x1213231–0x12132A1` 和 `0x1213A47–0x1213A6D`）。原初由词缀 T8 标记读取（`loadAffixFromSerialisation`, `0x1211380`）。生成离线物品始终设置不可交易，并清除 MG 阵营／阶级要求；低层编码器与只读反向映射仍可保留原生位以完成字节核对。

天梯 `fromSaveFile=2` 数据省略树版本，且技能 `level` 保存基础经验等级（通常 20），节点分配包含实际装备／天赋额外等级。导入前仍验证当前游戏节点与前置条件；基础经验按至多 20 级写入，分配保留、额外等级依赖游戏重算。普通手动配装的“分配点数超过声明等级”仍拒绝。
