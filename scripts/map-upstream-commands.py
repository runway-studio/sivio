#!/usr/bin/env python3
"""Classify observed IPC entry points; field-level and manual UI audit remains separate."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
rows=json.loads((root/'build/reports/upstream-command-inventory.json').read_text())
cc={
'auth':'F14','balance':'F13','codex_oauth':'F14','coding_plan':'F13','config':'F15',
'copilot':'F14','custom_icon':'F03','deeplink':'F28','env':'F15','failover':'F18',
'global_proxy':'F32','hermes':'F15','import_export':'F29','lightweight':'F02',
'mcp':'F08','misc':'F04','model_fetch':'F05','omo':'F15','openclaw':'F15','pi':'F15',
'plugin':'F15','profile':'F11','prompt':'F10','provider':'F05','proxy':'F16',
's3_sync':'F30','session_manager':'F12','settings':'F03','skill':'F09','stream_check':'F18',
'subscription':'F13','usage':'F13','webdav_sync':'F30','workspace':'F10','xai_oauth':'F14',
'lib':'F02','tray':'F02'}
cv={'commands':'F04','app':'F04','backup':'F29','clash':'F24','lightweight':'F02',
'listener':'F24','network':'F22','profile':'F19','proxy':'F21','runtime':'F20',
'save_profile':'F20','service':'F23','system':'F34','verge':'F24','webdav':'F30'}
for r in rows:
    file=Path(r['file']);name=r['command'];stem=file.stem;source=r['source']
    r['featureIds']=[];r['exclusion']=None
    if r['file']=='scripts/perf/app.rs':r['exclusion']='Upstream performance instrumentation; not a macOS user capability.'
    elif stem=='uwp':r['exclusion']='Windows-only UWP operation.'
    else:
        feature=(cc if source=='cc-switch' else cv).get(stem)
        if '/media_unlock_checker/' in r['file']:feature='F27'
        if not feature:raise RuntimeError('Unclassified entry '+str(r))
        if source=='cc-switch':
            if stem=='provider' and ('Usage' in name):feature='F13'
            if stem=='provider' and name=='test_api_endpoints':feature='F18'
            if stem=='proxy' and any(x in name for x in ['health','circuit_breaker']):feature='F18'
            if stem=='proxy' and 'stack' in name:feature='F17'
            if stem=='proxy' and 'pricing' in name:feature='F13'
            if stem=='proxy' and any(x in name for x in ['codex','rectifier']):feature='F15'
            if stem=='misc' and any(x in name for x in ['tool_','provider_terminal']):feature='F07'
            if stem=='misc' and 'migration' in name:feature='F28'
            if stem=='misc' and name=='set_window_theme':feature='F03'
            if stem=='settings' and 'codex' in name:feature='F15'
            if stem=='settings' and 'auto_launch' in name:feature='F02'
            if stem=='settings' and any(x in name for x in ['update','log_config']):feature='F04'
            if stem=='settings' and any(x in name for x in ['rectifier','optimizer']):feature='F15'
            if stem=='settings' and 'config_dir_override' in name:feature='F31'
            if stem=='config' and name=='reveal_app_log_file':feature='F04'
        else:
            if stem=='clash' and any(x in name for x in ['core','clash_info']):feature='F26'
            if stem=='clash' and name=='test_delay':feature='F21'
            if stem=='clash' and name=='get_clash_logs':feature='F25'
            if stem=='clash' and 'clash_mode' in name:feature='F21'
            if stem=='clash' and name=='copy_clash_env':feature='F22'
            if stem=='profile' and name=='enhance_profiles':feature='F20'
            if stem=='runtime' and 'proxy_chain' in name:feature='F21'
            if stem=='app' and 'icon' in name:feature='F03'
        r['featureIds']=[feature]
        if (stem in ['settings','verge'] and name in ['get_settings','save_settings','get_verge_config','patch_verge_config']):
            r['featureIds']=['F02','F03','F04','F15','F22','F23','F24','F30','F31']
    r['reviewStatus']='entry-point classified; argument fields and UI reachability not yet exhaustively audited'
report={'scope':'IPC entry point classification only; does not certify full T01 operation coverage or implementation',
        'classified':sum(bool(r['featureIds']) for r in rows),'excluded':sum(bool(r['exclusion']) for r in rows),'entries':rows}
(root/'build/reports/upstream-operation-map.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print({k:report[k] for k in ['classified','excluded']})
