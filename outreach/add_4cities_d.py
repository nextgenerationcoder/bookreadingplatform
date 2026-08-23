import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

data = {
'Braunschweig': [
    ('Braunschweig','Reformhaus','Reiner Marx Reformhaus (Heidberg-EKZ)','Weimarstr. 2, 38124 Braunschweig','+49 531 693090','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent, single location in Heidberg shopping center.'),
],
'Chemnitz': [
    ('Chemnitz','Reformhaus','Reformhaus Winkler (Inh. Birgit Winkler)','Moritzstr. 24, 09111 Chemnitz','+49 371 6761653','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent (also listed as "Reform-Drogerie Winkler").'),
    ('Chemnitz','Reformhaus','Reformhaus Naturlounge','Im Neefepark 3, 09116 Chemnitz','+49 371 8579033','TBD','https://www.naturlounge.de/','service@naturlounge.de','Found','Independent, also runs an online shop.'),
    ('Chemnitz','Reformhaus','Reformhaus Naturquell (Inh. Ute Süß)','Thomas-Mann-Platz 1, 09130 Chemnitz','+49 371 424293','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent; also has a branch at ECE Sachsenallee shopping center.'),
],
'Kiel': [
    ('Kiel','Reformhaus','Reformhaus Hintz GmbH & Co. KG','Grasweg 35 (HQ) / Holtenauer Str. 60 / Blücherplatz 15 / Holstentörn, Kiel','+49 431 88807250','TBD','https://www.reformhaus-hintz.de/','info@reformhaushintz.de','Found','Family-owned since 1943, 3-4 locations but ALL within Kiel only (not a multi-city chain) — treated as independent local business; single HQ contact covers all branches.'),
    ('Kiel','Reformhaus','Reformhaus Engelhardt (Elmschenhagen)','Elmschenhagen, Kiel (exact address TBD)','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-engelhardt-elmschenhagen','Contact via vita-nova.de (same Engelhardt/Vita Nova chain contact reused from Hamburg)','Excluded (chain)','Same Vita Nova/Engelhardt multi-city chain already excluded in Hamburg.'),
],
'Aachen': [
    ('Aachen','Reformhaus','Reformhaus Heift (Henrik & Natja Heift)','Reihstr. 21, 52062 Aachen-Burtscheid','+49 241 34024','TBD','TBD — no dedicated website found','mail@reformhausheift.de','Found','Family-owned since 1970s, Aachen-only (2 branches: Reihstr. + Elisengalerie) — despite "Vita Nova" cooperative marketing affiliation, this is a single-city independent business, not a multi-city chain.'),
    ('Aachen','Reformhaus','Reformhaus C. Lauer-Völkel','Trierer Str. 790, 52078 Aachen-Brand','+49 241 526245','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent, single location.'),
],
}

for sheetname, rows in data.items():
    ws = wb.create_sheet(sheetname)
    ws.append(headers)
    for r in rows:
        ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('done', list(data.keys()))
