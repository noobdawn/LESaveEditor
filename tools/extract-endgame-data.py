"""Extract endgame skip identifiers from the pinned game; never reads player saves.

Requires UnityPy (optionally --library-dir). Publishes only short names, numeric
quest rules, and source hashes. Resource encoding and empty web initialization
must be reviewed in native code whenever the build changes.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

BUILD = '8dfd6929fe2d10f2e77b7ed4c8e6910f49b2736b'
KEY_IDS = [7, 0, 3, 22, 23, 4, 5, 6, 13, 14]
WOVEN_NAMES = ['崩塌视界', '消逝边缘', '半神登临', '永恒门扉']


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--game-dir', type=Path, required=True)
    p.add_argument('--library-dir', type=Path)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    game = args.game_dir.resolve()
    if (game/'Last Epoch_Data/build_hash.txt').read_text().strip() != BUILD:
        raise ValueError('Review endgame rules for this build first')
    if game == args.out.resolve() or game in args.out.resolve().parents:
        raise ValueError('Output must be outside the game installation')
    spec = importlib.util.spec_from_file_location('rarity', Path(__file__).with_name('extract-filter-rarity.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    localization = module.read_localization(game, args.library_dir)
    import UnityPy
    bundle = game/'Last Epoch_Data/StreamingAssets/LEAssetBundles/PermaLoad.bundle'
    env = UnityPy.load(str(bundle))
    objects = {obj.path_id: obj for obj in env.objects}

    def named(name):
        return next(obj.read_typetree(check_read=True) for obj in env.objects
                    if obj.type.name == 'MonoBehaviour' and obj.peek_name() == name)

    items = named('MasterItemsList')
    resources = []
    for base in items['nonEquippableItems']:
        bid = base['baseTypeID']
        if bid not in [104, 107]:
            continue
        for item in base['subItems']:
            sid = item['subTypeID']
            name = module.localized_name(localization, 'Item_Names', f'Item_SubType_Name_{bid}_{sid}', item.get('displayName') or item['name'])
            if (bid == 104 and sid in KEY_IDS) or (bid == 107 and name['zh'] in WOVEN_NAMES):
                resources.append({'baseTypeId': bid, 'subTypeId': sid, 'name': name,
                                  'collection': 'keysList' if bid == 104 else 'wovenEchoesList'})
    if len(resources) != 14:
        raise ValueError(f'Expected 14 resources, found {resources}')
    master = named('MasterQuestList')

    def refs(key):
        return {ref['m_PathID']: objects[ref['m_PathID']].read_typetree(check_read=True) for ref in master[key]}

    quests, steps, objectives = refs('quests'), refs('questSteps'), refs('objectives')
    rules = {}
    for quest in quests.values():
        if quest['id'] not in range(136, 146):
            continue
        selected = [steps[ref['m_PathID']] for ref in quest['steps']]
        final = [step for step in selected if step['questStateDuringThisStep'] == 2 and step['questBranchDuringThisStep'] == 0]
        if quest['questType'] != 2 or len(final) != 1:
            raise ValueError('Review Harbinger quest completion')
        ids = sorted({objectives[ref['m_PathID']]['id'] for step in selected
                      if step['questBranchDuringThisStep'] == 0 and step['questStateDuringThisStep'] in [1, 2]
                      for ref in step['objectives']})
        rules[str(quest['id'])] = {'step': final[0]['id'], 'branch': 0, 'objectives': ids}
    if len(rules) != 10:
        raise ValueError('Expected ten Harbinger quests')
    result = {'gameBuildHash': BUILD, 'gameVersion': '1.5.2.1',
              'source': {'bundleSha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
                         'localization': localization['source']},
              'resources': resources, 'harbingerQuests': rules}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(resources, ensure_ascii=False))


if __name__ == '__main__':
    main()
