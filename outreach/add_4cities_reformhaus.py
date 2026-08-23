import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

data = {
'Duisburg': [
    ('Duisburg','Reformhaus','Reformhaus Pro Natura','Oststr. 121, 47057 Duisburg-Neudorf-Nord','+49 203 352527','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent.'),
    ('Duisburg','Reformhaus','Reformhaus Jilek','Kaiser-Friedrich-Str. 12, 47169 Duisburg-Marxloh','+49 203 402395','TBD','http://www.reformhaus-duisburg.de','TBD — no public email found; phone contact only','Not started','Independent (Inh. Marco Bliersbach, trading as "Elisabeth Jilek").'),
    ('Duisburg','Reformhaus','Reformhaus - Apotheke Am Golfplatz','Weißdornstr. 23-25, 47269 Duisburg-Großenbaum','TBD','TBD','TBD — no dedicated website found','TBD — no public email found','Not started','Independent, combined with a pharmacy at same address — verify exact relationship.'),
],
'Bochum': [
    ('Bochum','Reformhaus','Reformhaus Heckert','Brenscheder Str. 53, 44799 Bochum-Wiemelhausen','+49 234 770771','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent (also listed as "Gesundes & Genuss Ulrich Heckert").'),
],
'Wuppertal': [
    ('Wuppertal','Reformhaus','Reformhaus Kaubisch (Wuppertal, original)','Wuppertal (exact address TBD)','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-kaubisch-wuppertal','info@reformhaus-kaubisch.de (same Vita Nova/Kaubisch chain contact used in Essen/Düsseldorf)','Excluded (chain)','This is the founding 100-year-old Kaubisch family shop (3rd generation, Simon Kaubisch) that the wider Kaubisch/Vita Nova chain expanded from — but since the brand now operates as one multi-city company (Essen, Düsseldorf, Oberhausen, etc.), treating consistently as chain/centralized purchasing.'),
    ('Wuppertal','Reformhaus','Reformhaus Niggemann GmbH','Höhne 15, 42275 Wuppertal-Barmen','+49 202 596441','TBD','TBD — no dedicated website found','info@reformhaus-niggemann.de','Found','Independent, single location.'),
    ('Wuppertal','Reformhaus','Ronsdorfer Reform- u. Diäthaus (Inh. Monika Dreseler)','Lüttringhauser Str. 5, 42369 Wuppertal-Ronsdorf','+49 202 465368','TBD','TBD — no dedicated website found','TBD — no public email found; phone contact only','Not started','Independent, single location.'),
],
'Bielefeld': [
    ('Bielefeld','Reformhaus','Reformhaus (Ebken/Bella Vita) Neustädter Straße','Neustädter Str. 20, 33602 Bielefeld-Mitte','+49 521 171947','TBD','https://reformhaus.de/blogs/reformhaus-ebken/rh_ebken_neustadter_str','info@ebken.de (same Ebken chain contact reused from Bremen)','Excluded (chain)','Part of Reformhaus Ebken chain (already used in Bremen).'),
    ('Bielefeld','Reformhaus','Reformhaus (Apfelstraße)','Apfelstr. 8, 33613 Bielefeld-Innenstadt','+49 521 97173110','TBD','TBD — no dedicated website found; ownership/chain affiliation unconfirmed','TBD','Not started','Chain affiliation not yet confirmed — verify by phone before treating as independent lead.'),
],
}

for sheetname, rows in data.items():
    ws = wb.create_sheet(sheetname)
    ws.append(headers)
    for r in rows:
        ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('done', list(data.keys()))
