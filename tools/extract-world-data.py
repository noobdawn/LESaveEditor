"""Extract selected world-editing facts and bilingual names from the current game.

Only numeric rules and short display names are published. No saves are read.
Faction reputation is the remainder within the current rank; cumulative totals
skip the initial rank-0 -> rank-1 entry, as in Faction.get_TotalReputation.
"""
import argparse
import json
from pathlib import Path
import sys

BUILD = '8dfd6929fe2d10f2e77b7ed4c8e6910f49b2736b'
TIMELINES = ['UndeadAbom', 'OsprixWithLance', 'VoidRahyeh', 'FrostLich', 'Lagon',
             'UndeadVsVoid', 'Dragons', 'Gaspar', 'Heorot', 'Volcano']
FACTIONS = ['Factions_CircleofFortuneName', 'Factions_MerchantGuildName',
            'Factions_ForgottenKnightsName', 'Faction_Weaver_Title']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', type=Path, required=True)
    parser.add_argument('--library-dir', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.library_dir:
        sys.path.insert(0, str(args.library_dir.resolve()))
    import UnityPy
    game = args.game_dir.resolve()
    output = args.out.resolve()
    if output == game or game in output.parents:
        raise ValueError('Output must be outside the game installation')
    data = game / 'Last Epoch_Data'
    if (data/'build_hash.txt').read_text().strip() != BUILD:
        raise ValueError('Review native faction logic and timeline limits for this game build first')
    asset_root = data/'StreamingAssets/aa/StandaloneWindows64'

    def tables(filename, names):
        found = {}
        for obj in UnityPy.load(str(asset_root/filename)).objects:
            if obj.type.name == 'MonoBehaviour' and obj.peek_name() in names:
                tree = obj.read_typetree(check_read=True)
                found[tree['m_Name']] = tree
        if set(found) != set(names):
            raise ValueError(f'Missing localization tables: {set(names)-set(found)}')
        return found

    shared = tables('localization-assets-shared_assets_all.bundle', ['Common Shared Data', 'UI Shared Data'])
    labels = {}
    for lang, filename in [('en', 'localization-string-tables-english(en)_assets_all.bundle'),
                           ('zh', 'localization-string-tables-chinese(simplified)(zh)_assets_all.bundle')]:
        localized = tables(filename, [f'Common_{lang}', f'UI_{lang}'])
        labels[lang] = {}
        for table in ['Common', 'UI']:
            keys = {entry['m_Id']: entry['m_Key'] for entry in shared[table+' Shared Data']['m_Entries']}
            labels[lang].update({keys[entry['m_Id']]: entry['m_Localized']
                                 for entry in localized[f'{table}_{lang}']['m_TableData'] if entry['m_Id'] in keys})

    def label(key):
        result = {lang: values[key] for lang, values in labels.items()}
        if not all(result.values()):
            raise ValueError(f'Missing translation: {key}')
        return result

    timelines, factions = {}, {}
    for obj in UnityPy.load(str(data/'StreamingAssets/LEAssetBundles/PermaLoad.bundle')).objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        name = obj.peek_name() or ''
        if not name.endswith('Timeline') and not name.startswith('Faction Data '):
            continue
        tree = obj.read_typetree(check_read=True)
        if 'timelineID' in tree and 'difficulties' in tree and 1 <= tree['timelineID'] <= 10:
            timeline_id = tree['timelineID']
            timelines[str(timeline_id)] = {
                'name': label('TimelineID_'+TIMELINES[timeline_id-1]),
                'difficulties': [{
                    'level': difficulty['level'], 'maxStability': difficulty['maxStability'],
                    'minCorruption': difficulty['minimumCorruption'],
                    'maxCorruption': difficulty['maximumCorruption'] if difficulty['hasMaxCorruption'] else 2147483647,
                } for difficulty in tree['difficulties']],
            }
        elif 'factionID' in tree:
            faction_id = tree['factionID']
            requirements = [entry['reputationRequired'] for entry in tree['reputationReqForNextRanks']]
            factions[str(faction_id)] = {
                'name': label(FACTIONS[faction_id]), 'maxRank': len(requirements),
                'reputationPerRank': requirements,
                'rankFromHarbingerProgress': faction_id == 2,
            }
    if len(timelines) != 10 or len(factions) != 4:
        raise ValueError('Unexpected world catalog size; inspect the game assets')
    result = {'gameBuildHash': BUILD, 'gameVersion': '1.5.2.1', 'timelines': timelines, 'factions': factions}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print('Extracted 10 bilingual timelines and 4 faction reputation tables')


if __name__ == '__main__':
    main()
