import json, collections, statistics
from datetime import datetime, timedelta, timezone
TZ = timezone(timedelta(hours=5))
def ts(s): return datetime.fromisoformat(s).astimezone(TZ) if s else None
deals = json.load(open('won_revenue.json')) + json.load(open('nonwon_revenue.json'))
now = datetime(2026,9,25,11,0,tzinfo=TZ)
start = datetime(2026,6,28,tzinfo=TZ); end = datetime(2026,9,26,tzinfo=TZ)
D=[]
for r in deals:
    won = r.get('STAGE_SEMANTIC_ID','S')=='S' if 'STAGE_SEMANTIC_ID' in r else True
    D.append(dict(id=int(r['ID']), c=r.get('CONTACT_ID') or None, cr=ts(r['DATE_CREATE']), won=won,
      cl=(ts(r.get('CLOSEDATE')) or ts(r.get('DATE_MODIFY'))), amt=float(r.get('OPPORTUNITY') or 0), src=r.get('SOURCE_ID') or ''))
print('revenue deals', len(D), 'WON', sum(d['won'] for d in D))
byc=collections.defaultdict(list)
for d in D:
    if d['c']: byc[d['c']].append(d)
# flow
new=set(); retn=set(); act=set(); newwon=set(); fr=rr=0.0; srcnew=collections.Counter()
for c,L in byc.items():
    L.sort(key=lambda d:(d['cr'], d['src']=='' , d['id']))
    first=L[0]['cr']
    for i,d in enumerate(L):
        if start<=d['cr']<end:
            act.add(c)
            (new if first>=start else retn).add(c)
            if first>=start and d['won']: newwon.add(c)
            if d['won']:
                if i==0: fr+=d['amt']
                else: rr+=d['amt']
            if i==0: srcnew[d['src']]+=1
print(f"\nMIJOZLAR OQIMI (90 kun {start.date()}..{(end-timedelta(days=1)).date()}): Yangi {len(new)}  Qaytgan {len(retn)}  Faol {len(act)}  Yangi(WON) {len(newwon)}  Takroriy xarid tushumi {rr/(fr+rr)*100:.1f}%  (birinchi {fr:,.0f} / takroriy {rr:,.0f})")
# states
st=collections.Counter()
for c,L in byc.items():
    last=max(d['cr'] for d in L)
    st['ACTIVE' if last>=now-timedelta(days=60) else 'AT_RISK' if last>=now-timedelta(days=150) else 'LOST']+=1
print(f"MIJOZLAR HOLATI: jami {len(byc)}  faol {st['ACTIVE']}  xavfda {st['AT_RISK']}  yo'qotilgan {st['LOST']}")
# sources
names={'CALL':'Входящий','UC_AA84D0':'Входящий zextra','UC_CKXAZS':'Входящий collagen','WEB':'Веб-сайт','REPEAT_SALE':'Ген лид','UC_MXY08O':'Instagram','UC_8NZNYM':'Телеграмм','CALLBACK':'Facebook & Messenger','WEBFORM':'CRM-форма','RC_GENERATOR':'База клиент','BOOKING':'Youtube','UC_5JW4YK':'Сммщик sinolifeuz','UC_1X1J24':'sinolifeuz','UC_FW4VXY':'Ecommerce','STORE':'Tik-tok','UC_0FMQ5Q':'sinolife_otziv','':'(manbasiz)'}
mat=collections.Counter(); rep=collections.Counter()
for c,L in byc.items():
    f=L[0]
    if f['cr']<now-timedelta(days=90):
        mat[f['src']]+=1
        if len(L)>1: rep[f['src']]+=1
print('\nMANBA: yangi (90 kun) | qaytish% (90 kundan eski mijozlar)')
for s,n in srcnew.most_common(12):
    print(f"  {names.get(s,s):22} {n:5}  {rep[s]/mat[s]*100 if mat[s] else float('nan'):5.1f}% (n={mat[s]})")
# concentration
W=[d for d in D if d['won'] and d['cl']]
rev=collections.Counter(); nullrev=0
for d in W:
    if start<=d['cl']<end:
        if d['c']: rev[d['c']]+=d['amt']
        else: nullrev+=d['amt']
v=sorted(rev.values(),reverse=True); T=sum(v)
cum=0; n80=None
for i,x in enumerate(v):
    cum+=x
    if cum*100>=T*80: n80=i+1; break
print(f"\nKONTSENTRATSIYA: tushumli mijozlar {len(v)}  Top-10 ulushi {sum(v[:10])/T*100:.2f}%  80% tushumni beruvchilar {n80}")
wins=collections.defaultdict(list)
for d in W:
    if d['c']: wins[d['c']].append((d['cl'],d['id']))
gaps=[];coh=rep90=0
for c,L in wins.items():
    L.sort(); f=L[0][0]; s=L[1][0] if len(L)>1 else None
    if s and start<=s<end: gaps.append((s-f).total_seconds()/86400)
    if start-timedelta(days=90)<=f<end-timedelta(days=90):
        coh+=1
        if s and s<=f+timedelta(days=90): rep90+=1
gaps.sort()
import numpy as np
print(f"Takroriy xarid oralig'i: mediana {np.percentile(gaps,50):.1f} kun, p90 {np.percentile(gaps,90):.1f} (juftlar {len(gaps)})  90 kunda qaytish {rep90}/{coh} = {rep90/coh*100:.1f}%")
