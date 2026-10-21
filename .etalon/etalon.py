import json, collections
from datetime import datetime, timedelta, timezone
TZ = timezone(timedelta(hours=5))
won = json.load(open('won_revenue.json'))
def ts(s): return datetime.fromisoformat(s).astimezone(TZ) if s else None
rows=[]
nocontact=0; noclose=0
for r in won:
    c = r.get('CONTACT_ID')
    cl = ts(r.get('CLOSEDATE')) or ts(r.get('DATE_MODIFY'))
    amt = float(r.get('OPPORTUNITY') or 0)
    if not c: nocontact+=1; continue
    rows.append((c, cl, amt, r['CATEGORY_ID']))
print('WON revenue deals', len(won), 'without contact', nocontact, 'currencies', collections.Counter(r.get('CURRENCY_ID') for r in won))
first = {}
for c,cl,a,_ in rows:
    m=(cl.year,cl.month)
    if c not in first or m<first[c]: first[c]=m
def ms(m, f): return (m[0]-f[0])*12+(m[1]-f[1])
size=collections.Counter(first.values())
firstret={}
rev0=revL=0.0
cell=collections.defaultdict(lambda: [set(),0,0.0])
for c,cl,a,_ in rows:
    f=first[c]; k=ms((cl.year,cl.month),f)
    if k>0: firstret[c]=min(firstret.get(c,99),k); revL+=a
    else: rev0+=a
    x=cell[(f,k)]; x[0].add(c); x[1]+=1; x[2]+=a
returned=collections.Counter(first[c] for c in firstret)
tot=len(first); ret=len(firstret)
print(f'Jami mijozlar {tot}  Qaytgan {ret} ({ret/tot*100:.1f}%)  Takroriy tushum ulushi {revL/(rev0+revL)*100:.1f}%  (birinchi {rev0:,.0f} / keyingi {revL:,.0f})')
print('\ncohort  size  returned  ret%   +1    +2    +3  (unique buyers per offset)')
out=[]
for f in sorted(size)[-19:]:
    line=[f'{f[0]}-{f[1]:02d}', size[f], returned[f], round(returned[f]/size[f]*100,1)]
    line += [len(cell[(f,k)][0]) if (f,k) in cell else 0 for k in (1,2,3)]
    print('  '.join(str(x) for x in line))
    out.append(line)
json.dump({'total':tot,'returned':ret,'rev0':rev0,'revL':revL,'rows':out},open('etalon_cohort.json','w'))
