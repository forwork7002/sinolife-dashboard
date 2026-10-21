import json, collections
B=json.load(open('baza.json'))
G={'NEW':['C10:NEW','C10:UC_79XRT6'],'CADENCE':['C10:FINAL_INVOICE','C10:UC_FEENT1','C10:UC_1TH09B','C10:UC_8VIZ08','C10:UC_4OTGKV'],
   'ACTIVE':['C10:UC_W94F10','C10:PREPAYMENT_INVOIC','C10:UC_KYP1SE','C10:WON'],'LOST':['C10:UC_S5YE1H','C10:UC_SDQ5HF','C10:UC_WWD9W7','C10:LOSE']}
g_of={s:k for k,v in G.items() for s in v}
allc=set(); openc=set(); grp=collections.defaultdict(set); gopen=collections.defaultdict(set); stage=collections.defaultdict(set); noc=0
for r in B:
    c=r.get('CONTACT_ID')
    if not c: noc+=1; continue
    g=g_of.get(r['STAGE_ID'],'UNMAPPED'); allc.add(c); grp[g].add(c); stage[r['STAGE_ID']].add(c)
    if r.get('STAGE_SEMANTIC_ID')=='P': openc.add(c); gopen[g].add(c)
print(f"БАЗА: bitimlar {len(B)} (kontaktsiz {noc})  mijozlar {len(allc)}  ishlanayotgan (ochiq) {len(openc)}")
for k in ['NEW','CADENCE','ACTIVE','LOST','UNMAPPED']:
    if grp[k]: print(f"  {k:9} {len(grp[k]):6}  ochiq {len(gopen[k])}   " + ', '.join(f"{s.split(':')[1]}={len(stage[s])}" for s in G.get(k,sorted(s for s in stage if g_of.get(s,'UNMAPPED')==k)) if stage[s]))
