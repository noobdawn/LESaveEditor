# 速通至终局

此选项属于离线存档同步分支，默认关闭。先开启“速通至异界”才能选择；取消前者会同时取消后者。必须上传角色及匹配的同赛季、同硬核状态仓库，独狼仓库关联继续拒绝。修改只发生在浏览器内的副本，最终分别下载角色与仓库；不会直接写入游戏存档目录。

## 修改范围

- 战役仍先于配装应用，沿用一级角色任务预算 14 点、同步到 100 级后总预算 113 点的规则。角色等级始终跟随配装，不因终局速通另加等级。
- 为十条世界线追加缺失的强化记录，稳定度 1600、腐化 300。已有强化记录只修改这两个值，保留地图、回响、选项和其他记录。已有普通世界线稳定度按各自上限设置（500–1000），腐化 50；不创建普通世界线记录。教程或未知世界线保留。
- 角色与仓库都补齐普通通关、分支 0 和普通／强化解锁记录。不会伪造强化通关、回响击杀总数、祝福或地下城通关记录。历史最高腐化只补到至少 300，不降低已有更高纪录。
- 完成仓库内先驱者阶段任务 136–145；遗忘骑士团角色／仓库阶级设为 10，仓库 `currentprogression=10`，十条世界线的先驱者击败计数至少为 1，最高先驱者腐化至少 300。保留已有较高计数和其他阵营数据。新角色不增加阿伯罗斯击杀，任务 146 及最终 Boss 保留供玩家挑战。
- 以下 14 种资源在仓库中**各设为 99**。已有超过 99 的数量也会改为 99；已有物品身份和包装保留，缺失资源使用独立 v6 资源格式创建，不使用装备编码器。

| 资源 | 类别与 ID |
| --- | --- |
| 竞技场钥匙 | keysList · 104:0 |
| 记忆的竞技场钥匙 | keysList · 104:3 |
| 时空圣殿钥匙 | keysList · 104:4 |
| 无光深林钥匙 | keysList · 104:5 |
| 魂火堡垒钥匙 | keysList · 104:6 |
| 先驱者之眼 | keysList · 104:7 |
| 传送门护符 | keysList · 104:13 |
| 鳞片护符 | keysList · 104:14 |
| 时空楔石 | keysList · 104:22 |
| 沙漏碎片 | keysList · 104:23 |
| 永恒门扉 | wovenEchoesList · 107:18 |
| 崩塌视界 | wovenEchoesList · 107:29 |
| 消逝边缘 | wovenEchoesList · 107:30 |
| 半神登临 | wovenEchoesList · 107:47 |

## 实现与来源

[endgame.js](../web/src/core/endgame.js) 对两份文档执行事务式修改；[workflow.js](../web/src/core/workflow.js) 强制选项依赖并在配装校验成功后调用。每次同步都从原始上传文件重算，关闭选项后旧结果失效，不累计资源。预览展示世界线、先驱者进度和逐种资源数量，上传页把仓库标为必需。

[endgame-data.json](../web/src/data/endgame-data.json) 由 [extract-endgame-data.py](../tools/extract-endgame-data.py) 从游戏 `MasterItemsList`、`MasterQuestList` 和同版本简中／英文字符串表生成，保留来源哈希。脚本不读取私人存档。基准仍是 1.5.2.1 / 内部 1.5.2.2，构建 `8dfd6929fe2d10f2e77b7ed4c8e6910f49b2736b`；变更构建必须重新核对原生行为。

```powershell
python tools/extract-endgame-data.py --game-dir 'E:/SteamLibrary/steamapps/common/Last Epoch' --library-dir '<UnityPy 目录>' --out web/src/data/endgame-data.json
```

同构建原生核对：`SavedMonolithRun.LoadRun` RVA `0x1C558C0` 对不多于一个已存岛屿的回响调用 `EchoWeb.initialiseNewWeb`（`0x12BE080`），传入存档腐化值，因此新记录使用空网络让游戏生成。`HarbingersProgress.AterrothUnlocked`（`0x20D0220`）检查击败先驱者的世界线字典至少有十项，不能只改阵营 rank。资源 104 保存单字节 subtype；107 保存双字节 subtype。

参考角色与其匹配仓库仅作本地只读核对，不提交原存档、个人战斗快照或整份回响地图。测试使用合成角色；私有验证通过环境变量 `LE_ENDGAME_CHARACTER_FIXTURE`、`LE_ENDGAME_STASH_FIXTURE` 显式开启。

验证覆盖一级角色、十条强化世界线、14 种资源、已有地图和未知数据保留、重复应用、缺少／错误仓库、异常字段整批拒绝、完整同步及下载。代码验证不能替代游戏内载入：需要使用备份副本验收强化入口、回响生成、先驱者／阿伯罗斯入口及门票消耗。
