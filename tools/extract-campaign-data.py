"""Extract numeric campaign/waypoint rules from Last Epoch 1.5.2.1.

Requires UnityPy. Reads game files only; never reads or writes character saves.
The world-map bundle was resolved through PanelSystemAssetsProvider's
WorldMapPanel soft reference and LEAssetBundles/Catalog.bin for this build.
Only identifiers and numeric rules are exported, without quest text or artwork.
Native rules reviewed in GameAssembly.dll (RVA for this exact build):
SavedQuestHelper.LoadQuestsFromList 0x28855E0 (step/replacement loading),
StatefulQuest.getState 0x14CF3D0 (state comes from current step),
StatefulQuestList.getPassivePointsFromQuestRewards 0x14CBBD0 (cap 15),
StatefulQuestList.getIdolUnlockFromQuestRewards 0x14CB020 (cap 8),
LocalTreeData.calculatePassivePointsEarnt 0x16C16B0 (clamp(level-2+rewards)),
CharacterDataExtensions.GetInitialScene 0x1C5FA30 (saved login scene).
These rules must be reviewed again on updates.
"""
import argparse
import json
from pathlib import Path
import struct
import sys

BUILD = '8dfd6929fe2d10f2e77b7ed4c8e6910f49b2736b'
MAP_BUNDLE = 'assets_5aa78568bec82d5c.bundle'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', type=Path, required=True)
    parser.add_argument('--library-dir', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.library_dir:
        sys.path.insert(0, str(args.library_dir.resolve()))
    import UnityPy
    game, output = args.game_dir.resolve(), args.out.resolve()
    if output == game or game in output.parents:
        raise ValueError('Output must be outside the game installation')
    data = game/'Last Epoch_Data'
    if (data/'build_hash.txt').read_text().strip() != BUILD:
        raise ValueError('Review quest, reward, map and spawn logic for this build first')
    bundles = data/'StreamingAssets/LEAssetBundles'
    env = UnityPy.load(str(bundles/'PermaLoad.bundle'))
    objects = {obj.path_id: obj for obj in env.objects}

    def named(name):
        return next(obj.read_typetree(check_read=True) for obj in env.objects
                    if obj.type.name == 'MonoBehaviour' and obj.peek_name() == name)

    master, scenes = named('MasterQuestList'), named('SceneList')

    def references(key):
        return {ref['m_PathID']: objects[ref['m_PathID']].read_typetree(check_read=True)
                for ref in master[key]}

    quests, steps, objectives = references('quests'), references('questSteps'), references('objectives')
    by_id = {quest['id']: quest for quest in quests.values()}
    step_rules = {}
    for path, step in steps.items():
        if step['quest']['m_PathID'] not in quests:
            continue  # Unregistered legacy/development quests are not loaded.
        current, seen = step, set()
        while current['replacementStep']['m_PathID']:
            target = current['replacementStep']['m_PathID']
            if target in seen or target not in steps:
                raise ValueError('Unknown or circular quest step replacement')
            seen.add(target)
            candidate = steps[target]
            if candidate['quest'] != step['quest']:
                break
            current = candidate
        step_rules[str(step['id'])] = [quests[step['quest']['m_PathID']]['id'], current['questStateDuringThisStep']]
    result_quests = {}
    for quest in quests.values():
        campaign = (quest['questType'] == 0 and 0 <= quest['chapter'] <= 9
                    and quest['playerVisible'] and not quest['testQuest']
                    and (not quest['ignoreForQuestAchievement'] or quest['id'] in [167, 168]))
        rule = {'type': quest['questType'], 'passivePoints': quest['passivePointsReward'],
                'idolUnlocks': quest['idolUnlockReward']}
        if campaign:
            choices = [steps[ref['m_PathID']] for ref in quest['steps']
                       if steps[ref['m_PathID']]['questStateDuringThisStep'] == 2
                       and steps[ref['m_PathID']]['questBranchDuringThisStep'] == 0]
            if len(choices) != 1:
                raise ValueError(f'Review completion branches for quest {quest["id"]}')
            # Campaign completion can be gated by individual objectives as well
            # as the final step. Include only this quest's successful branch.
            completed_objectives = sorted({objectives[obj['m_PathID']]['id']
                                          for ref in quest['steps']
                                          if steps[ref['m_PathID']]['questBranchDuringThisStep'] == 0
                                          and steps[ref['m_PathID']]['questStateDuringThisStep'] in [1, 2]
                                          for obj in steps[ref['m_PathID']]['objectives']})
            rule.update(campaign=True, step=choices[0]['id'], branch=0, objectives=completed_objectives)
        result_quests[str(quest['id'])] = rule
    script_env = UnityPy.load(str(bundles/'monoscripts.bundle'))
    scripts = {obj.path_id: obj.read_typetree(check_read=True)['m_ClassName']
               for obj in script_env.objects if obj.type.name == 'MonoScript'}
    scene_names = {scene['Name'] for scene in scenes['sceneDetailsCollection']}
    waypoint_scenes = set()
    for obj in UnityPy.load(str(bundles/MAP_BUNDLE)).objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        script = struct.unpack_from('<q', obj.get_raw_data(), 20)[0]
        if scripts.get(script) != 'UIWaypointStandard':
            continue
        waypoint = obj.read_typetree(check_read=True)
        # Timeline islands all target MonolithHub; their own gates remain intact.
        # The offline game has no Merchant's Guild/Bazaar. Keep unknown existing
        # save entries, but never introduce obsolete or unavailable destinations.
        if (not waypoint['noWaypointInScene'] and waypoint['sceneName'] in scene_names
                and waypoint['sceneName'] != 'Bazaar'):
            waypoint_scenes.add(waypoint['sceneName'])
    campaign_count = sum(rule.get('campaign', False) for rule in result_quests.values())
    if campaign_count != 76 or 'MonolithHub' not in waypoint_scenes or not {124, 151}.issubset(by_id):
        raise ValueError('Unexpected campaign catalog; inspect current assets')
    result = {'gameBuildHash': BUILD, 'gameVersion': '1.5.2.1', 'maximumPassiveRewards': 15,
              'maximumIdolUnlocks': 8, 'passiveLevelOffset': 2, 'spawnScene': 'MonolithHub',
              'waypoints': sorted(waypoint_scenes), 'quests': result_quests, 'steps': step_rules}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')
    print(f'Extracted {campaign_count} campaign quests and {len(waypoint_scenes)} offline waypoint destinations')


if __name__ == '__main__':
    main()
